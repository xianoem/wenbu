import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Predicate, Stream } from 'effect'
import { LanguageModel, type Prompt, type Response } from 'effect/ai'
import type { GlossaryTerm } from '#contract/Novels'
import type { PresetModel } from '../llm/LlmClient'
import {
  chunksOf,
  parseLine,
  ReplyLine,
  TranslateEvent,
  translateChapter,
} from './ChapterTranslator'

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

const streamingModel = (prompts: Array<string>, reply: (prompt: string) => string) =>
  LanguageModel.make({
    generateText: () => Effect.die('Not used.'),
    streamText: (options) => {
      const prompt = userText(options.prompt)

      prompts.push(prompt)

      const pieces = reply(prompt).match(/[\s\S]{1,7}/g) ?? []

      return Stream.fromIterable<Response.StreamPartEncoded>([
        ...pieces.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
        { type: 'finish' as const, reason: 'stop' as const, usage, response: undefined },
      ])
    },
  })

const presetModel = (prompts: Array<string>, reply: (prompt: string) => string): PresetModel => ({
  modelName: 'Scripted',
  layer: Layer.effect(LanguageModel.LanguageModel, streamingModel(prompts, reply)),
  spend: (spent) => Effect.succeed((spent.inputTokens + spent.outputTokens) / 1_000_000),
})

const term = (
  original: string,
  translation: string,
  gender: 'm' | 'f' | null = null,
): GlossaryTerm => ({
  id: original,
  original,
  translation,
  kind: gender === null ? 'concept' : 'character',
  gender,
  note: null,
  suggested: false,
  glossary: 'Novel glossary',
  chapters: [],
  origin: 'manual',
  count: 0,
  reading: null,
})

const run = (
  model: PresetModel,
  paragraphs: ReadonlyArray<string>,
  terms: ReadonlyArray<GlossaryTerm> = [],
) =>
  translateChapter(model, {
    title: '第一章 曉夢',
    paragraphs,
    terms,
    language: 'zh',
    targetLanguage: 'English',
  }).pipe(Stream.runCollect)

const paragraphsOf = (events: ReadonlyArray<TranslateEvent>) =>
  events.filter(TranslateEvent.$is('Paragraph')).map((event) => [event.index, event.text])

describe('parseLine', () => {
  it('reads numbered lines, the title and new terms', () => {
    expect(parseLine('3|He woke.')).toEqual(
      Option.some(ReplyLine.Line({ key: '3', text: 'He woke.' })),
    )

    expect(parseLine('T| Dawn Dream ')).toEqual(
      Option.some(ReplyLine.Line({ key: 'T', text: 'Dawn Dream' })),
    )

    expect(parseLine('+|輕煙|Qingyan|character|f')).toEqual(
      Option.some(
        ReplyLine.Term({
          original: '輕煙',
          translation: 'Qingyan',
          kind: 'character',
          gender: 'f',
        }),
      ),
    )

    expect(parseLine('Here is the translation:')).toEqual(Option.none())
  })
})

describe('chunksOf', () => {
  it('keeps paragraphs whole and under the budget', () => {
    const long = '字'.repeat(1000)

    expect(chunksOf([long, long, long, long, long], 1800).map((chunk) => chunk.length)).toEqual([
      3, 2,
    ])
  })
})

describe('translateChapter', () => {
  it.effect('streams paragraphs and the title as the model answers', () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []

      const model = presetModel(prompts, () =>
        [
          'T|Dawn Dream',
          '1|When Ding Songyan opened his eyes, it was still dark.',
          '2|“Second Brother?”',
          '',
        ].join('\n'),
      )

      const events = yield* run(
        model,
        ['丁松言睜開眼時，天還沒亮。', '「二哥？」'],
        [term('丁松言', 'Ding Songyan', 'm')],
      )

      expect(events.filter(TranslateEvent.$is('Title'))).toEqual([
        TranslateEvent.Title({ text: 'Dawn Dream' }),
      ])

      expect(paragraphsOf(events)).toEqual([
        [0, 'When Ding Songyan opened his eyes, it was still dark.'],
        [1, '“Second Brother?”'],
      ])

      expect(prompts[0]).toContain('丁松言 → Ding Songyan (m)')
      expect(events.at(-1)).toEqual(TranslateEvent.Spent({ costUsd: 0.00015 }))
    }),
  )

  it.effect('sends only the glossary terms that occur in the text', () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []
      const model = presetModel(prompts, () => '1|He read.\n')

      yield* run(
        model,
        ['他讀過燭龍。'],
        [term('燭龍', 'Torch Dragon'), term('青云宗', 'Azure Cloud Sect')],
      )

      expect(prompts[0]).toContain('燭龍 → Torch Dragon')
      expect(prompts[0]).not.toContain('Azure Cloud Sect')
    }),
  )

  it.effect('asks again for lines the model skipped or that missed a glossary term', () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []

      const model = presetModel(prompts, () =>
        prompts.length === 1
          ? '1|He read of the candle dragon.\n'
          : '1|He read of the Torch Dragon.\n2|She laughed.\n',
      )

      const events = yield* run(model, ['他讀過燭龍。', '她笑了。'], [term('燭龍', 'Torch Dragon')])

      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain('must use')

      expect(paragraphsOf(events).slice(-2)).toEqual([
        [0, 'He read of the Torch Dragon.'],
        [1, 'She laughed.'],
      ])
    }),
  )

  it.effect('passes on terms the model found', () =>
    Effect.gen(function* () {
      const model = presetModel([], () => '1|“I’m Qingyan!”\n+|輕煙|Qingyan|character|f\n')
      const events = yield* run(model, ['「我是輕煙呀。」'])

      expect(events.filter(TranslateEvent.$is('NewTerm'))).toEqual([
        TranslateEvent.NewTerm({
          original: '輕煙',
          translation: 'Qingyan',
          kind: 'character',
          gender: 'f',
        }),
      ])
    }),
  )
})
