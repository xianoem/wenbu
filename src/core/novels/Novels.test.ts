import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, Path, Predicate, Schema, Stream } from 'effect'
import { LanguageModel, type Prompt, type Response } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import {
  AddNovelTerm,
  AskAnswer,
  AddTerm,
  CreateGlossary,
  NovelsError,
  NovelsRpc,
  PickGlossaries,
  UpdateNovelTerm,
  UpdateTerm,
} from '#contract/Novels'
import { GlossaryStore } from '../glossary/GlossaryStore'
import { LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { NovelInsightStore } from './NovelInsightStore'
import { NovelsRpcLive, ScanPause } from './Novels'
import { NovelStore } from './NovelStore'
import { PageFetcher } from './PageFetcher'

const isAnswer = Schema.is(AskAnswer)

const fixtureOf = (site: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return yield* fs.readFileString(path.join(import.meta.dirname, '__fixtures__', site, name))
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie)

const fixture = (name: string) => fixtureOf('101kks', name)

const usage = {
  inputTokens: { uncached: 100, total: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: undefined, reasoning: undefined },
}

const userText = (prompt: Prompt.Prompt) =>
  prompt.content
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      Predicate.isString(message.content)
        ? [message.content]
        : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .join('\n')

const toolResults = (prompt: Prompt.Prompt) =>
  prompt.content.flatMap((message) =>
    message.role === 'tool'
      ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.result] : []))
      : [],
  )

const echoModel = LanguageModel.make({
  generateText: (options) =>
    Effect.sync((): Array<Response.PartEncoded> => {
      const found = toolResults(options.prompt)

      if (found.length === 0) {
        return [
          { type: 'tool-call', id: 'c1', name: 'search_text', params: { words: ['丁松言'] } },
          { type: 'finish', reason: 'tool-calls', usage, response: undefined },
        ]
      }

      const chapter = /ch(\d+)/.exec(String(found))?.[1] ?? '0'

      return [
        { type: 'text', text: `Yes, Ding Songyan wakes before dawn. [ch${chapter}]` },
        { type: 'finish', reason: 'stop', usage, response: undefined },
      ]
    }),
  streamText: (options) => {
    const lines = userText(options.prompt)
      .split('\n')
      .flatMap((line) => {
        const match = /^(\d+|T)\|(.*)$/.exec(line)

        if (match === null) {
          return []
        }

        const text = match[2]?.includes('丁松言') === true ? 'Ding Songyan woke.' : `EN ${match[1]}`

        return [`${match[1]}|${text}`]
      })

    const reply = `${lines.join('\n')}\n+|輕煙|Qingyan|character|f\n`

    return Stream.fromIterable<Response.StreamPartEncoded>([
      { type: 'text-delta', id: '1', delta: reply },
      { type: 'finish', reason: 'stop', usage, response: undefined },
    ])
  },
})

const knownNames: Record<string, string> = {
  丁松言: 'Ding Songyan|character|m',
  丁轻烟: 'Ding Qingyan|character|f',
  青云宗: 'Azure Cloud Sect|sect|-',
}

const verdicts = (prompt: string) =>
  prompt
    .split('\n')
    .flatMap((line) => {
      const match = /^(\d+)\|([^|]+)\|/.exec(line)

      if (match === null) {
        return []
      }

      const known = knownNames[match[2] ?? '']

      return [known === undefined ? `${match[1]}|drop` : `${match[1]}|keep|${known}`]
    })
    .join('\n')

const digestsFor = (prompt: string) =>
  [...prompt.matchAll(/^=== Chapter (\d+)/gm)]
    .map((match) =>
      [
        `#${match[1]}`,
        `S|Ding Songyan wakes in chapter ${match[1]}.`,
        'C|丁松言',
        'F|character-death|a guard dies',
      ].join('\n'),
    )
    .join('\n')

const replyTo = (prompt: string) => {
  if (prompt.includes('repeat often')) {
    return verdicts(prompt)
  }

  if (prompt.includes('=== Chapter')) {
    return digestsFor(prompt)
  }

  return 'Sword and Candle\nA young man wakes in a candle flame.'
}

const llm = Layer.succeed(LlmClient)({
  model: () =>
    Effect.succeed({
      modelName: 'Echo',
      layer: Layer.effect(LanguageModel.LanguageModel, echoModel),
      spend: () => Effect.succeed(0.001),
    }),
  describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Echo' }),
  complete: ({ prompt }) =>
    Effect.succeed({
      text: replyTo(prompt),
      usage: { inputTokens: 10, outputTokens: 10 },
      costUsd: 0.0001,
    }),
})

const sitePages = Effect.gen(function* () {
  const pages: Record<string, string> = {
    'https://101kks.com/book/42674.html': yield* fixture('book.html'),
    'https://101kks.com/ajax_novels/chapterlist/42674.html': yield* fixture('chapters.html'),
    'https://101kks.com/txt/42674/14812982.html': yield* fixture('chapter.html'),
    'https://101kks.com/txt/42674/20453844.html': yield* fixture('chapter.html'),
    'https://101kks.com/search/%E5%89%91%E7%83%9B%E5%A4%A7%E8%8D%92/1.html':
      yield* fixture('book.html'),
    'https://www.qidian.com/book/1048862481/': yield* fixtureOf('qidian', 'book.html'),
    'https://www.qidian.com/chapter/1048862481/907850545/': yield* fixtureOf(
      'qidian',
      'chapter.html',
    ),
  }

  return Layer.succeed(PageFetcher)({
    get: (url) => {
      const body = pages[url]

      return body === undefined
        ? Effect.fail(new NovelsError({ reason: 'site', message: `No page at ${url}` }))
        : Effect.succeed({ status: 200, url, body })
    },
  })
})

const setup = Effect.gen(function* () {
  const layer = NovelsRpcLive.pipe(
    Layer.provide([
      NovelStore.layer,
      GlossaryStore.layer,
      NovelInsightStore.layer,
      yield* sitePages,
      llm,
      PresetReferences.layer,
    ]),
    Layer.provide(Layer.succeed(ScanPause)(0)),
    Layer.provide(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provide(Database.layer(':memory:')),
    Layer.provide(NodeServices.layer),
  )

  const client = yield* RpcTest.makeClient(NovelsRpc).pipe(
    Effect.provideContext(yield* Layer.build(layer)),
  )

  yield* client.saveNovelSettings({
    presetId: 'fast',
    targetLanguage: 'English',
    readAhead: 0,
    contentFlags: [],
  })

  return client
})

const lastView = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.runLast(stream).pipe(Effect.map(Option.getOrUndefined))

const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 200; turn++) {
    yield* Effect.yieldNow
  }
})

describe('Novels', () => {
  it.effect('adds a novel from a 101kks link with its chapter list', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.addNovelFromUrl({ url: 'https://101kks.com/book/42674.html' })
      const again = yield* client.addNovelFromUrl({ url: 'https://www.101kks.com/book/42674.html' })

      expect(again).toBe(id)

      const details = yield* client.novelDetails({ novelId: id })

      expect(details.title).toBe('劍燭大荒')
      expect(details.chapters).toBe(7)
      expect(details.sourceLabel).toBe('101kks')

      const page = yield* client.novelChapters({
        novelId: id,
        page: 0,
        pageSize: 3,
        newestFirst: true,
      })

      expect(page.total).toBe(8)

      expect(page.rows.map((row) => row.title)).toEqual([
        '第六十四章 神乎其技',
        '第六十三章 名與實',
        '第六十二章 小院清晨',
      ])
    }).pipe(Effect.scoped),
  )

  it.effect('fetches, translates and highlights a chapter as it is opened', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.addNovelFromUrl({ url: 'https://101kks.com/book/42674.html' })

      yield* client.editGlossary({
        edit: AddNovelTerm.make({
          novelId: id,
          original: '丁松言',
          translation: 'Ding Songyan',
          kind: 'character',
          gender: 'm',
          note: null,
        }),
      })

      yield* client.openChapter({ novelId: id, number: 2 })

      const view = yield* lastView(client.watchChapter({ novelId: id, number: 2 }))

      expect(view?.state).toBe('translated')

      expect(view?.paragraphs[0]).toMatchObject({
        original: '丁松言睜開眼時，窗外的天色還未亮透。',
        translated: 'Ding Songyan woke.',
        originalTerms: [{ start: 0, end: 3 }],
        translatedTerms: [{ start: 0, end: 12 }],
      })

      expect(view?.note).toBe('PS：幾分鐘後還有一章。')

      const terms = yield* client.novelTerms({ novelId: id })

      expect(terms.filter((term) => term.suggested).map((term) => term.original)).toEqual(['輕煙'])
    }).pipe(Effect.scoped),
  )

  it.effect('reads pasted chapters and keeps renamed terms in step', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.createNovel({ title: '雨夜來信', language: 'zh' })

      expect(
        yield* client.previewPaste({ text: '第一章 雨\n丁松言回頭。\n第二章 信\n她笑了。' }),
      ).toEqual([
        { title: '第一章 雨', paragraphs: 1, characters: 6, scrambled: false },
        { title: '第二章 信', paragraphs: 1, characters: 4, scrambled: false },
      ])

      const numbers = yield* client.pasteChapters({
        novelId: id,
        text: '第一章 雨\n丁松言回頭。\n第二章 信\n她笑了。',
        startAt: null,
      })

      expect(numbers).toEqual([1, 2])

      const termId = yield* client.editGlossary({
        edit: AddNovelTerm.make({
          novelId: id,
          original: '丁松言',
          translation: 'Ding Songyan',
          kind: 'character',
          gender: 'm',
          note: null,
        }),
      })

      yield* client.openChapter({ novelId: id, number: 1 })
      yield* lastView(client.watchChapter({ novelId: id, number: 1 }))

      yield* client.editGlossary({
        edit: UpdateNovelTerm.make({
          novelId: id,
          termId: termId ?? '',
          original: '丁松言',
          translation: 'Ding Song',
          kind: 'character',
          gender: 'm',
          note: null,
        }),
      })

      const view = yield* client.openChapter({ novelId: id, number: 1 })

      expect(view.paragraphs[0]?.translated).toBe('Ding Song woke.')
      expect(view.next).toBe(2)
    }).pipe(Effect.scoped),
  )

  it.effect('turns down scrambled text', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.createNovel({ title: '測試', language: 'zh' })

      const error = yield* client
        .pasteChapters({
          novelId: id,
          text: '他說',
          startAt: null,
        })
        .pipe(Effect.flip)

      expect(error.reason).toBe('invalid')
    }).pipe(Effect.scoped),
  )
})

describe('Official Sources', () => {
  it.effect('takes the chapter list from Qidian and paid chapters from a host, by name', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.addNovelFromUrl({ url: 'https://www.qidian.com/book/1048862481/' })

      yield* settle

      const details = yield* client.novelDetails({ novelId: id })

      expect(details.officialSource).toEqual({
        site: 'qidian',
        siteName: 'Qidian',
        url: 'https://www.qidian.com/book/1048862481/',
      })

      expect(details.textSources.map((source) => source.site)).toEqual(['101kks'])

      const rows = (yield* client.novelChapters({
        novelId: id,
        page: 0,
        pageSize: 10,
        newestFirst: false,
      })).rows

      expect(rows.map((row) => [row.title, row.locked, row.status, row.textFrom])).toEqual([
        ['欢迎收藏', false, 'on-site', 'Qidian'],
        ['第一章 晓梦', false, 'on-site', 'Qidian'],
        ['第二章 木鸢', false, 'on-site', 'Qidian'],
        ['第六十五章 名与实', true, 'on-site', '101kks'],
        ['第六十六章 神乎其技', true, 'on-site', '101kks'],
        ['第一百零四章 坦诚相告', true, 'no-text', null],
      ])

      expect(rows[1]?.releasedAt).toBe('2026-05-30 13:10:39')

      const free = yield* client.openChapter({ novelId: id, number: 2 })

      expect(free.paragraphs.map((paragraph) => paragraph.original)).toEqual([
        '丁松言睁开眼时，窗外的天色还未亮透。',
        '他记得自己最后看见的是一盏烛火。',
        '“二哥，你醒了？”',
      ])

      const paid = yield* client.openChapter({ novelId: id, number: 5 })

      expect(paid.hasText).toBe(true)
      expect(paid.paragraphs[0]?.original).toBe('丁松言睜開眼時，窗外的天色還未亮透。')

      const unmatched = yield* client.openChapter({ novelId: id, number: 6 })

      expect(unmatched.hasText).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect('lists Official Sources first in search results', () =>
    Effect.gen(function* () {
      const client = yield* setup

      const sites = (yield* client.novelSites()).map((site) => [site.id, site.role ?? 'host'])

      expect(sites).toEqual([
        ['qidian', 'official'],
        ['17k', 'official'],
        ['101kks', 'host'],
      ])
    }).pipe(Effect.scoped),
  )
})

describe('Term Scan', () => {
  it.effect('finds a novel’s names in its first chapters and suggests them', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.createNovel({ title: '測試', language: 'zh' })
      const names = ['丁松言', '丁轻烟', '青云宗']
      const before = ['他看着', '只见', '原来是', '传闻', '听说', '众人望向', '她想起', '远处的']

      const after = [
        '笑了笑。',
        '沉默不语。',
        '点了点头。',
        '走了过来。',
        '叹了口气。',
        '皱起眉头。',
      ]

      const text = [1, 2, 3]
        .map(
          (chapter) =>
            `第${chapter}章 測試\n` +
            Array.from(
              { length: 30 },
              (_, line) =>
                `${before[(line + chapter) % before.length]}${names[(line + chapter) % names.length]}${after[(line * 5 + chapter) % after.length]}`,
            ).join('\n'),
        )
        .join('\n')

      yield* client.pasteChapters({ novelId: id, text, startAt: null })

      const stages = yield* client.scanTerms({ novelId: id, chapters: 50 }).pipe(Stream.runCollect)

      expect(stages.at(-1)).toMatchObject({ stage: 'done', found: 3 })
      expect(stages.some((stage) => stage.stage === 'checking')).toBe(true)

      const terms = yield* client.novelTerms({ novelId: id })

      expect(
        terms.map((term) => [term.original, term.translation, term.origin, term.suggested]),
      ).toEqual(
        expect.arrayContaining([
          ['丁松言', 'Ding Songyan', 'scan', true],
          ['丁轻烟', 'Ding Qingyan', 'scan', true],
          ['青云宗', 'Azure Cloud Sect', 'scan', true],
        ]),
      )

      expect(terms.find((term) => term.original === '丁松言')?.chapters).toEqual([1, 2, 3])
    }).pipe(Effect.scoped),
  )

  it.effect('says why when no model is chosen', () =>
    Effect.gen(function* () {
      const client = yield* setup

      yield* client.saveNovelSettings({
        presetId: '',
        targetLanguage: 'English',
        readAhead: 0,
        contentFlags: [],
      })

      const id = yield* client.createNovel({ title: '測試', language: 'zh' })
      const stages = yield* client.scanTerms({ novelId: id, chapters: 50 }).pipe(Stream.runCollect)

      expect(stages.at(-1)?.stage).toBe('failed')
    }).pipe(Effect.scoped),
  )
})

describe('General Glossaries', () => {
  it.effect('lends their terms to the novels that pick them, with the novel’s own winning', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const novelId = yield* client.createNovel({ title: '雨夜來信', language: 'zh' })

      yield* client.pasteChapters({ novelId, text: '第一章 雨\n丁松言回頭。', startAt: null })

      const glossaryId = yield* client.editGlossary({
        edit: CreateGlossary.make({ name: 'Names' }),
      })

      yield* client.editGlossary({
        edit: AddTerm.make({
          glossaryId: glossaryId ?? '',
          original: '丁松言',
          translation: 'Ding Songyan',
          kind: 'character',
          gender: 'm',
          note: null,
          reading: 'Dīng Sōngyán',
        }),
      })

      yield* client.editGlossary({
        edit: PickGlossaries.make({ novelId, glossaryIds: [glossaryId ?? ''] }),
      })

      yield* client.openChapter({ novelId, number: 1 })

      const view = yield* lastView(client.watchChapter({ novelId, number: 1 }))

      expect(view?.paragraphs[0]?.translated).toBe('Ding Songyan woke.')

      expect(view?.terms.map((term) => [term.original, term.glossary])).toEqual([
        ['丁松言', 'Names'],
      ])

      const shelf = yield* client.glossaryShelf()

      expect(shelf.general).toMatchObject([{ name: 'Names', terms: 1, novels: 1 }])

      const page = yield* client.glossaryPage({ ref: { kind: 'novel', id: novelId } })

      expect(page.picks).toMatchObject([{ name: 'Names', picked: true }])

      const general = yield* client.glossaryPage({ ref: { kind: 'general', id: glossaryId ?? '' } })

      expect(general.terms[0]?.reading).toBe('Dīng Sōngyán')

      yield* client.editGlossary({
        edit: UpdateTerm.make({
          glossaryId: glossaryId ?? '',
          termId: general.terms[0]?.id ?? '',
          original: '丁松言',
          translation: 'Ding Song',
          kind: 'character',
          gender: 'm',
          note: null,
        }),
      })

      const renamed = yield* client.openChapter({ novelId, number: 1 })

      expect(renamed.paragraphs[0]?.translated).toBe('Ding Song woke.')

      const hits = yield* client.findTerms({ query: '丁鬆' })

      expect(hits.map((hit) => hit.glossaryName)).toEqual(['Names'])

      const csv = yield* client.exportGlossary({ ref: { kind: 'general', id: glossaryId ?? '' } })

      expect(csv.split('\n')).toEqual([
        'original,translation,kind,gender,reading,note',
        '丁松言,Ding Song,character,m,Dīng Sōngyán,',
      ])
    }).pipe(Effect.scoped),
  )
})

describe('Novel Chat', () => {
  it.effect('makes Chapter Digests and answers questions about the novel with chapters cited', () =>
    Effect.gen(function* () {
      const client = yield* setup
      const id = yield* client.addNovelFromUrl({ url: 'https://101kks.com/book/42674.html' })

      yield* client.editGlossary({
        edit: AddNovelTerm.make({
          novelId: id,
          original: '丁松言',
          translation: 'Ding Songyan',
          kind: 'character',
          gender: 'm',
          note: null,
        }),
      })

      const before = yield* client.novelInsight({ novelId: id })

      expect(before.digested).toBe(0)
      expect(before.flags.every((flag) => flag.chapters.length === 0)).toBe(true)

      const progress = yield* lastView(client.digestNovel({ novelId: id, upTo: 99 }))

      expect(progress?.stage).toBe('done')

      const insight = yield* client.novelInsight({ novelId: id })

      expect(insight.digested).toBeGreaterThan(0)
      expect(insight.knownUpTo).toBeGreaterThan(0)

      expect(insight.flags.find((flag) => flag.id === 'character-death')).toMatchObject({
        note: 'a guard dies',
      })

      expect(insight.characters[0]).toMatchObject({
        translation: 'Ding Songyan',
        mentions: insight.digested,
      })

      const events = yield* Stream.runCollect(
        client.askNovel({
          novelId: id,
          question: 'Does Ding Songyan wake up?',
          spoilers: false,
          kind: 'question',
        }),
      )

      const answer = events.find((event) => isAnswer(event))

      expect(answer?.answer.text).toBe('Yes, Ding Songyan wakes before dawn.')
      expect(answer?.answer.chapters.length).toBe(1)
      expect(answer?.answer.coverage).toContain('of 7 chapters')

      const after = yield* client.novelInsight({ novelId: id })

      expect(after.answers.map((entry) => entry.question)).toEqual(['Does Ding Songyan wake up?'])
    }).pipe(Effect.scoped),
  )
})
