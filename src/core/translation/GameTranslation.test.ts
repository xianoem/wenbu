import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, expect, it } from '@effect/vitest'
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schedule,
  Schema,
  Stream,
  Struct,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { unzipSync, zipSync } from 'fflate'
import { SqlClient } from 'effect/sql'
import {
  defaultTranslationSettings,
  GameTranslationRpc,
  type TranslationRun,
  type TranslationSettings,
} from '#contract/GameTranslation'
import { LibraryRpc } from '#contract/Library'
import { NotEnoughSpace, reserveBytes } from '#contract/Storage'
import { LlmSettingsError } from '#contract/Llm'
import { Games } from '../library/Games'
import { LibraryRpcLive } from '../library/Library'
import { makeMvGame, mvMap, TestLauncher } from '../library/TestGames'
import { LlmClient, LlmClientError, type PresetDescription } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { GameData } from '../rpgmaker/GameData'
import { LogBook } from '../diagnostics/LogBook'
import { GameTranslationLive } from './GameTranslation'
import { GameFileHashes } from './GameFileHashes'
import { TranslationLines } from './TranslationLines'

const Batch = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Struct({ text: Schema.String })),
)

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const decodeBatch = Schema.decodeUnknownEffect(Batch)

const encodeReply = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
)

const presets: Record<string, PresetDescription> = {
  'preset-1': { presetName: 'Dialogue', modelName: 'Fake 1', price: { input: 1, output: 2 } },
  'preset-free': { presetName: 'Local', modelName: 'Fake 2' },
}

const LlmFake = Layer.succeed(LlmClient)({
  model: () => Effect.die('The Game Guide model is not used here.'),
  describe: (presetId) =>
    Effect.fromNullishOr(presets[presetId]).pipe(
      Effect.mapError(() => new LlmSettingsError({ reason: 'not-found', message: 'Missing.' })),
    ),
  complete: (request) =>
    Effect.gen(function* () {
      const batch = yield* Effect.orDie(decodeBatch(request.prompt.split('\n\n').at(-1) ?? ''))
      const texts = Object.values(batch).map((item) => item.text)

      if (texts.some((text) => text.includes('hang'))) {
        return yield* Effect.never
      }

      if (texts.some((text) => text.includes('slow'))) {
        yield* Effect.sleep('300 millis')
      }

      if (texts.some((text) => text.includes('broken'))) {
        return yield* new LlmClientError({ message: 'The model is unavailable.' })
      }

      const reply = Object.fromEntries(
        Object.entries(batch)
          .filter(([, item]) => !item.text.includes('never'))
          .map(([key, item]) => [
            key,
            request.prompt.startsWith('Shorten')
              ? 'Short'
              : item.text === 'same'
                ? 'same'
                : item.text.includes('uncoded')
                  ? `EN:${item.text.replace(/\\C\[\d+\]/g, '')}`
                  : `EN:${item.text}`,
          ]),
      )

      return {
        text: `\`\`\`json\n${yield* Effect.orDie(encodeReply(reply))}\n\`\`\``,
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.5,
      }
    }),
})

const layerWithFree = (
  freeBytes: number,
  platform: Layer.Layer<NodeServices.NodeServices> = NodeServices.layer,
) =>
  Layer.mergeAll(GameTranslationLive, LibraryRpcLive).pipe(
    Layer.provideMerge(TestLauncher),
    Layer.provideMerge(Games.layer),
    Layer.provideMerge(GameData.layer),
    Layer.provide(LlmFake),
    Layer.provideMerge(PresetReferences.layer),
    Layer.provideMerge(TranslationLines.layer),
    Layer.provideMerge(GameFileHashes.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(freeBytes)),
    Layer.provideMerge(platform),
  )

const failingMoves = (name: string) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      rename: (from: string, to: string) =>
        from.includes('.wenbu-updates') && to.endsWith(name)
          ? fs.rename(`${from}.held-open`, to)
          : fs.rename(from, to),
    })),
  ).pipe(Layer.provideMerge(NodeServices.layer))

const TestLayer = layerWithFree(100 * 1024 ** 3)

const settings: TranslationSettings = {
  ...defaultTranslationSettings,
  presetId: 'preset-1',
  mode: 'custom',
  workers: 2,
  chunkTokens: 1,
  retryRounds: 2,
}

const firstRun = <E>(
  runs: Stream.Stream<Option.Option<TranslationRun>, E>,
  done: (run: TranslationRun) => boolean,
) =>
  runs.pipe(
    Stream.map(Option.getOrUndefined),
    Stream.filter((run): run is TranslationRun => run !== undefined && done(run)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

const messagesMap = (lines: ReadonlyArray<string>) => ({
  displayName: '',
  events: [
    null,
    {
      pages: [
        {
          list: lines.flatMap((line) => [
            { code: 101, parameters: ['', 0, 0, 2] },
            { code: 401, parameters: [line] },
          ]),
        },
      ],
    },
  ],
})

const installByHand = Effect.fnUntraced(function* (
  folder: string,
  gameId: string,
  map: ReturnType<typeof messagesMap>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const data = yield* GameData
  const hashes = yield* GameFileHashes
  const translation = yield* RpcTest.makeClient(GameTranslationRpc)
  const text = yield* encodeJson(map)

  yield* fs.writeFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json'), text)
  yield* fs.writeFileString(path.join(folder, 'www', 'data', 'Map001.json'), text)

  const current = yield* data.dataHashes({ folderPath: folder, engine: 'rpg-maker-mv' })

  yield* hashes.saveOriginals(gameId, new Map([['Map001.json', current.get('Map001.json') ?? '']]))
  yield* translation.applyTranslationEdits({ gameId })
})

const updateZip = Effect.fnUntraced(function* (
  folder: string,
  name: string,
  root: string,
  content: {
    readonly title: string
    readonly map: object
    readonly extra?: Readonly<Record<string, string | object>>
  },
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const archive = path.join(path.dirname(folder), name)
  const encoder = new TextEncoder()

  const text = (value: string | object) =>
    Effect.map(Predicate.isString(value) ? Effect.succeed(value) : encodeJson(value), (json) =>
      encoder.encode(json),
    )

  const files: Record<string, Uint8Array> = {
    [`${root}www/data/System.json`]: yield* text({ gameTitle: content.title, currencyUnit: 'G' }),
    [`${root}www/data/Map001.json`]: yield* text(content.map),
  }

  for (const [file, value] of Object.entries(content.extra ?? {})) {
    files[`${root}${file}`] = yield* text(value)
  }

  yield* fs.writeFile(archive, zipSync(files))

  return archive
})

const setup = Effect.fnUntraced(function* (lines: ReadonlyArray<string>) {
  const library = yield* RpcTest.makeClient(LibraryRpc)
  const translation = yield* RpcTest.makeClient(GameTranslationRpc)
  const folder = yield* makeMvGame(lines)
  const game = yield* library.addGame({ path: folder })

  yield* translation.saveTranslationSettings(settings)

  const finished = firstRun(
    translation.watchTranslation({ gameId: game.id }),
    (run) => run.status !== 'running',
  )

  const mapText = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return yield* fs.readFileString(path.join(folder, 'www', 'data', 'Map001.json'))
  })

  const gameState = Effect.map(library.listGames(), (games) => games[0]?.translation)

  return { translation, library, game, folder, finished, mapText, gameState }
})

describe('GameTranslation', () => {
  it.live('translates a game step by step and writes the result', () =>
    Effect.gen(function* () {
      const { translation, game, finished, mapText, gameState } = yield* setup([
        'こんにちは',
        'さようなら',
      ])

      yield* translation.startTranslation({ gameId: game.id })

      const run = yield* finished

      expect(run).toMatchObject({
        status: 'translated',
        presetName: 'Dialogue · Fake 1',
        lines: { total: 3, translated: 3, written: 3 },
        usage: { inputTokens: 300, outputTokens: 60, costUsd: 1.5 },
      })

      expect(run.steps.map((step) => [step.id, step.status, step.summary])).toEqual([
        ['prepare', 'done', 'Saved a copy of the original files'],
        ['extract', 'done', '3 lines in 2 files'],
        ['translate', 'done', 'All 3 lines'],
        ['apply', 'done', '3 lines written'],
      ])

      expect(yield* mapText).toContain(
        '{"code":401,"parameters":["EN:こんにちは"]},{"code":401,"parameters":["さようなら"]}',
      )

      expect(yield* gameState).toBe('translated')

      expect(
        (yield* translation.listTranslationRuns({ gameId: game.id })).map((saved) => saved.status),
      ).toEqual(['translated'])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('stores every line with its translation', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['こんにちは'])
      const store = yield* TranslationLines

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const lines = yield* store.lines(game.id)

      expect(lines.map((line) => [line.sourceText, line.translatedText, line.applied])).toEqual(
        expect.arrayContaining([['こんにちは', 'EN:こんにちは', true]]),
      )

      expect(lines.every((line) => line.applied && line.origin === 'model')).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('translates only lines without a translation when run again', () =>
    Effect.gen(function* () {
      const { translation, game, finished, mapText } = yield* setup(['こんにちは'])
      const store = yield* TranslationLines

      yield* translation.startTranslation({ gameId: game.id })

      const first = yield* finished

      const hello = (yield* store.lines(game.id)).find((line) => line.sourceText === 'こんにちは')

      yield* store.edit(game.id, hello?.entryId ?? '', 'Hi there')
      yield* store.setLocked(game.id, hello?.entryId ?? '', true)
      yield* translation.startTranslation({ gameId: game.id })

      const second = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) =>
          run.status !== 'running' && run.steps[0]?.summary === 'Using the saved original files',
      )

      expect(first.usage.inputTokens).toBeGreaterThan(0)
      expect(second.status).toBe('translated')
      expect(second.usage.inputTokens).toBe(0)
      expect(yield* mapText).toContain('"Hi there"')
      expect(yield* mapText).not.toContain('EN:こんにちは')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('translates only what a game update added, keeping moved and locked lines', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const store = yield* TranslationLines
      const mapPath = path.join(folder, 'www', 'data', 'Map001.json')

      yield* fs.writeFileString(mapPath, yield* encodeJson(messagesMap(['おはよう', 'こんにちは'])))
      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const hello = (yield* store.lines(game.id)).find((line) => line.sourceText === 'こんにちは')

      yield* store.edit(game.id, hello?.entryId ?? '', 'Hi there')
      yield* store.setLocked(game.id, hello?.entryId ?? '', true)

      yield* installByHand(folder, game.id, messagesMap(['新しい行', 'おはよう', 'こんにちは！']))

      const update = yield* translation.getGameUpdate({ gameId: game.id })

      yield* translation.startTranslation({ gameId: game.id, scope: 'changed' })

      const second = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) =>
          run.status !== 'running' && run.steps[0]?.summary === 'Using the saved original files',
      )

      expect(second.usage.inputTokens).toBe(100)

      expect(Option.getOrThrow(update)).toMatchObject({
        added: 1,
        changed: 1,
        moved: 1,
        pending: 1,
        review: 1,
      })

      const text = yield* mapText

      expect(text).toContain('"EN:新しい行"')
      expect(text).toContain('"EN:おはよう"')
      expect(text).toContain('"Hi there"')

      expect(
        (yield* store.lines(game.id)).find((line) => line.sourceText === 'こんにちは！'),
      ).toMatchObject({ change: 'changed', locked: true, previousSource: 'こんにちは' })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('refuses to translate into another language once a game is translated', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished
      yield* translation.saveTranslationSettings({ ...settings, targetLanguage: 'German' })

      const refused = yield* Effect.flip(translation.startTranslation({ gameId: game.id }))

      expect(refused).toMatchObject({
        field: 'targetLanguage',
        message:
          'This game is translated into English. Remove its translation to translate it into German.',
      })

      yield* translation.removeTranslation({ gameId: game.id })
      yield* translation.startTranslation({ gameId: game.id })

      const third = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) => run.status !== 'running' && run.targetLanguage === 'German',
      )

      expect(third.status).toBe('translated')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('stops instead of putting old files over ones changed outside Wenbu', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const handCopied = yield* encodeJson(mvMap(['こんばんは']))

      yield* fs.writeFileString(path.join(folder, 'www', 'data', 'Map001.json'), handCopied)

      const run = yield* Effect.flip(translation.startTranslation({ gameId: game.id }))
      const apply = yield* Effect.flip(translation.applyTranslationEdits({ gameId: game.id }))
      const update = yield* translation.getGameUpdate({ gameId: game.id })

      expect(run).toMatchObject({ reason: 'conflict', field: 'gameFiles' })
      expect(run.message).toContain('Map001.json')
      expect(apply).toMatchObject({ field: 'gameFiles' })
      expect(update).toEqual(Option.none())
      expect(yield* mapText).toBe(handCopied)
      expect(yield* translation.listTranslationRuns({ gameId: game.id })).toHaveLength(1)

      expect(
        yield* fs.readFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json')),
      ).toContain('こんにちは')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('puts its translated files back over ones changed outside Wenbu', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(mvMap(['こんばんは'])),
      )

      yield* translation.restoreTranslatedFiles({ gameId: game.id })

      expect(yield* mapText).toContain('"EN:こんにちは"')
      yield* translation.applyTranslationEdits({ gameId: game.id })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('does not take its own translation for a game update', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const sql = yield* SqlClient.SqlClient

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      yield* sql`DELETE FROM game_file_hashes`

      yield* translation.startTranslation({ gameId: game.id })

      const second = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) =>
          run.status !== 'running' && run.steps[0]?.summary === 'Using the saved original files',
      )

      yield* translation.startTranslation({ gameId: game.id })

      const third = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) => run.status !== 'running' && run.id !== second.id,
      )

      expect([second.steps[0]?.notes, third.steps[0]?.notes]).toEqual([[], []])
      expect(yield* mapText).not.toContain('EN:EN:')

      expect(
        yield* fs.readFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json')),
      ).not.toContain('EN:')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('estimates tokens and cost for what a run would translate', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['おはよう', 'こんにちは', 'さようなら'])),
      )

      const before = yield* translation.estimateTranslation({ gameId: game.id })

      yield* translation.saveTranslationSettings({ ...settings, presetId: 'preset-free' })

      const priceless = yield* translation.estimateTranslation({ gameId: game.id })

      yield* translation.saveTranslationSettings(settings)
      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const after = yield* translation.estimateTranslation({ gameId: game.id })

      expect(before).toMatchObject({ scope: 'missing', lines: 5, batches: 5 })
      expect(before.costUsd?.low).toBeGreaterThan(0)
      expect(before.price).toEqual({ input: 1, output: 2 })
      expect(priceless.costUsd).toBeUndefined()
      expect(priceless.inputTokens).toBe(before.inputTokens)
      expect(after).toMatchObject({ lines: 0, batches: 0, costUsd: { low: 0, high: 0 } })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('estimates nothing left for a game translated before lines were stored', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['こんにちは'])
      const sql = yield* SqlClient.SqlClient

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished
      yield* sql`DELETE FROM translation_lines`

      expect(yield* translation.estimateTranslation({ gameId: game.id })).toMatchObject({
        lines: 0,
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('stops sending batches at the spending limit and applies what is done', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['おはよう', 'こんにちは', 'さようなら'])),
      )

      yield* translation.saveTranslationSettings({
        ...settings,
        workers: 1,
        spendLimit: { usd: 1 },
      })

      yield* translation.startTranslation({ gameId: game.id })

      const run = yield* finished
      const text = yield* mapText

      expect(run).toMatchObject({
        status: 'partial',
        stopped: { reason: 'spend-limit', limit: { usd: 1 } },
        lines: { total: 5, translated: 2, written: 2 },
        usage: { costUsd: 1 },
      })

      expect(run.steps[2]).toMatchObject({
        status: 'warning',
        summary: '2 lines of 5 · stopped at the $1.00 limit',
      })

      expect(text).toContain('"EN:こんにちは"')
      expect(text).not.toContain('EN:さようなら')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('carries on when the limit is raised during a run', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['slow'])

      yield* translation.saveTranslationSettings({ ...settings, workers: 1 })
      yield* translation.startTranslation({ gameId: game.id, spendLimit: { usd: 0.5 } })
      yield* translation.setRunSpendLimit({ gameId: game.id, limit: { usd: 10 } })

      const run = yield* finished

      expect(run.status).toBe('translated')
      expect(run.stopped).toBeUndefined()
      expect(run.spendLimit).toEqual({ usd: 10 })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('lists, filters and searches the translated lines', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['おはよう', 'こんにちは', 'さようなら'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const all = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: '',
        limit: 2,
      })

      const [morning, hello] = all.lines

      yield* translation.saveTranslationLine({
        gameId: game.id,
        entryId: morning?.entryId ?? '',
        text: 'Morning!',
      })

      yield* translation.setTranslationLineLocked({
        gameId: game.id,
        entryId: hello?.entryId ?? '',
        locked: true,
      })

      const list = (filter: 'edited' | 'locked' | 'all', query = '') =>
        translation.listTranslationLines({ gameId: game.id, filter, query, limit: 100 })

      const edited = yield* list('edited')
      const locked = yield* list('locked')
      const searched = yield* list('all', 'Map001 さよう')
      const byTranslation = yield* list('all', 'morning')

      expect([all.lines.length, all.total]).toEqual([2, 5])
      expect(edited.lines.map((line) => line.translatedText)).toEqual(['Morning!'])
      expect(locked.lines.map((line) => line.sourceText)).toEqual(['こんにちは'])
      expect(searched.lines.map((line) => line.sourceText)).toEqual(['さようなら'])
      expect(byTranslation.lines.map((line) => line.sourceText)).toEqual(['おはよう'])

      expect(edited.counts).toMatchObject({
        all: 5,
        edited: 1,
        locked: 1,
        missing: 0,
        unapplied: 1,
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('reads back a translation made before lines were stored when listing', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['こんにちは'])
      const sql = yield* SqlClient.SqlClient

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished
      yield* sql`DELETE FROM translation_lines`

      const page = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'こんにちは',
        limit: 100,
      })

      expect(page.lines.map((line) => [line.translatedText, line.applied])).toEqual([
        ['EN:こんにちは', true],
      ])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('does not count a translation the game kept out as an edit', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['uncoded \\C[2]red'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const page = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'uncoded',
        limit: 10,
      })

      expect(page.lines.map((line) => line.writeSkipped)).toEqual(['broken-formatting'])
      expect(page.counts).toMatchObject({ unapplied: 0, skipped: 1 })

      yield* translation.saveTranslationLine({
        gameId: game.id,
        entryId: page.lines[0]?.entryId ?? '',
        text: 'Uncoded \\C[2]red',
      })

      const edited = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'uncoded',
        limit: 10,
      })

      expect(edited.lines[0]?.writeSkipped).toBeUndefined()
      expect(edited.counts.unapplied).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('writes edits to the game without a new run', () =>
    Effect.gen(function* () {
      const { translation, game, finished, mapText } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const [hello] = (yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'こんにちは',
        limit: 1,
      })).lines

      yield* translation.saveTranslationLine({
        gameId: game.id,
        entryId: hello?.entryId ?? '',
        text: 'Hi there',
      })

      yield* translation.applyTranslationEdits({ gameId: game.id })

      const after = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: '',
        limit: 1,
      })

      expect(yield* mapText).toContain('"Hi there"')
      expect(after.counts.unapplied).toBe(0)
      expect(yield* translation.listTranslationRuns({ gameId: game.id })).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('shows a line with the one before it and others with the same text', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['はい', 'こんにちは', 'はい'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const { lines } = yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'Map001',
        limit: 100,
      })

      const detail = yield* translation.getTranslationLine({
        gameId: game.id,
        entryId: lines[2]?.entryId ?? '',
      })

      expect(detail.line.sourceText).toBe('はい')
      expect(detail.before?.sourceText).toBe('こんにちは')
      expect(detail.sameSource.map((line) => line.entryId)).toEqual([lines[0]?.entryId])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('translates one line again, unless it is locked', () =>
    Effect.gen(function* () {
      const { translation, game, finished } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const [hello] = (yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'こんにちは',
        limit: 1,
      })).lines

      const target = { gameId: game.id, entryId: hello?.entryId ?? '' }

      yield* translation.saveTranslationLine({ ...target, text: 'Hi there' })

      const again = yield* translation.retranslateLine(target)

      yield* translation.setTranslationLineLocked({ ...target, locked: true })

      const refused = yield* Effect.flip(translation.retranslateLine(target))
      const empty = yield* Effect.flip(translation.saveTranslationLine({ ...target, text: '  ' }))

      expect(again).toMatchObject({
        translatedText: 'EN:こんにちは',
        origin: 'model',
        applied: false,
      })

      expect(refused.message).toBe('Unlock the line to translate it again.')
      expect(empty.reason).toBe('invalid')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('shows what an installed update did until nothing is left to do', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const mapPath = path.join(folder, 'www', 'data', 'Map001.json')

      yield* fs.writeFileString(
        mapPath,
        yield* encodeJson(messagesMap(['おはよう', 'こんにちは', 'さようなら'])),
      )

      const untranslated = yield* translation.getGameUpdate({ gameId: game.id })

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const quiet = yield* translation.getGameUpdate({ gameId: game.id })

      yield* installByHand(folder, game.id, messagesMap(['新しい行', 'おはよう', 'こんにちは！']))

      const found = yield* translation.getGameUpdate({ gameId: game.id })
      const again = yield* translation.getGameUpdate({ gameId: game.id })

      expect([untranslated, quiet]).toEqual([Option.none(), Option.none()])

      expect(Option.getOrThrow(found)).toMatchObject({
        changed: 1,
        added: 1,
        removed: 1,
        pending: 2,
        review: 0,
      })

      expect(Option.getOrThrow(again)).toMatchObject({ changed: 1, added: 1, pending: 2 })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('lists what an update changed and keeps an old translation on request', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const mapPath = path.join(folder, 'www', 'data', 'Map001.json')

      yield* fs.writeFileString(
        mapPath,
        yield* encodeJson(messagesMap(['おはよう', 'こんにちは', 'さようなら'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const hello = (yield* translation.listTranslationLines({
        gameId: game.id,
        filter: 'all',
        query: 'こんにちは',
        limit: 1,
      })).lines[0]

      yield* translation.setTranslationLineLocked({
        gameId: game.id,
        entryId: hello?.entryId ?? '',
        locked: true,
      })

      yield* installByHand(folder, game.id, messagesMap(['おはよう！', 'こんにちは！']))

      const changes = yield* translation.listSourceChanges({ gameId: game.id })

      expect(
        changes.lines.map((line) => [
          line.change,
          line.previousSource,
          line.sourceText,
          line.translatedText,
        ]),
      ).toEqual([
        ['changed', 'おはよう', 'おはよう！', undefined],
        ['changed', 'こんにちは', 'こんにちは！', 'EN:こんにちは'],
      ])

      expect(changes.removed.map((line) => [line.sourceText, line.translatedText])).toEqual([
        ['さようなら', 'EN:さようなら'],
      ])

      const [morning, locked] = changes.lines
      const target = (line: typeof morning) => ({ gameId: game.id, entryId: line?.entryId ?? '' })

      const kept = yield* translation.setSourceChangeAction({ ...target(morning), action: 'keep' })

      const reviewed = yield* translation.setSourceChangeAction({
        ...target(locked),
        action: 'keep',
      })

      const after = yield* translation.getGameUpdate({ gameId: game.id })

      const retranslated = yield* translation.setSourceChangeAction({
        ...target(locked),
        action: 'translate',
      })

      expect([kept.translatedText, kept.change]).toEqual(['EN:おはよう', undefined])

      expect([reviewed.translatedText, reviewed.locked, reviewed.change]).toEqual([
        'EN:こんにちは',
        true,
        undefined,
      ])

      expect(after).toEqual(Option.none())

      expect([retranslated.translatedText, retranslated.locked, retranslated.change]).toEqual([
        undefined,
        false,
        'changed',
      ])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('checks an update zip without touching the game', () =>
    Effect.gen(function* () {
      const { translation, game, folder, mapText } = yield* setup(['こんにちは'])
      const before = yield* mapText

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: messagesMap(['こんにちは', '新しい行']),
        extra: { 'www/data/Map002.json': mvMap(['追加マップ']), 'www/save/file1.rpgsave': 'save' },
      })

      const inspection = yield* translation.inspectGameUpdate({ gameId: game.id, archive })

      expect(inspection).toMatchObject({
        archive: 'Magic_ver1.1.zip',
        version: '1.1',
        replaced: 2,
        added: 1,
        saves: 1,
        blocked: false,
      })

      expect(inspection.checks.map((check) => [check.id, check.status])).toEqual([
        ['same-game', 'ok'],
        ['fits', 'ok'],
        ['safe', 'ok'],
        ['newer', 'ok'],
        ['saves', 'warning'],
        ['space', 'ok'],
      ])

      expect(yield* mapText).toBe(before)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('installs an update over a translated game and keeps the translation it still fits', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const mapPath = path.join(folder, 'www', 'data', 'Map001.json')

      yield* fs.writeFileString(mapPath, yield* encodeJson(messagesMap(['おはよう', 'こんにちは'])))
      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: messagesMap(['新しい行', 'おはよう', 'こんにちは！']),
        extra: { 'www/save/file1.rpgsave': 'save' },
      })

      const refused = yield* Effect.flip(
        translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: false }),
      )

      yield* translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true })

      const update = Option.getOrThrow(yield* translation.getGameUpdate({ gameId: game.id }))
      const text = yield* mapText

      expect(refused.message).toBe('Check the warnings, then install anyway.')
      expect(update).toMatchObject({ added: 1, changed: 1, pending: 2, active: true })

      expect(update.install).toMatchObject({
        archive: 'Magic_ver1.1.zip',
        version: '1.1',
        canUndo: true,
      })

      expect(text).toContain('"EN:おはよう"')
      expect(text).toContain('"新しい行"')

      expect(
        yield* fs.readFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json')),
      ).toContain('こんにちは！')

      yield* translation.startTranslation({ gameId: game.id, scope: 'changed' })

      const second = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) => run.status !== 'running' && run.scope === 'changed',
      )

      expect(second.usage.inputTokens).toBe(200)
      expect(yield* mapText).toContain('"EN:新しい行"')

      expect(
        Option.getOrThrow(yield* translation.getGameUpdate({ gameId: game.id })),
      ).toMatchObject({
        active: false,
        pending: 0,
        install: { canUndo: true },
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('keeps the translation of a game translated before lines were stored', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const sql = yield* SqlClient.SqlClient

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished
      yield* sql`DELETE FROM translation_lines`

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: mvMap(['こんにちは']),
        extra: { 'www/data/Map002.json': mvMap(['追加マップ']) },
      })

      yield* translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true })

      expect(yield* mapText).toContain('"EN:こんにちは"')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('reports each step of an install while it runs', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: mvMap(['こんばんは']),
      })

      const seen = yield* translation.watchGameUpdateInstall({ gameId: game.id }).pipe(
        Stream.filter(Option.isSome),
        Stream.map((progress) => progress.value.step),
        Stream.changes,
        Stream.takeUntil((step) => step === 'done'),
        Stream.runCollect,
        Effect.forkScoped,
      )

      yield* Effect.sleep('50 millis')
      yield* translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true })

      expect(yield* Fiber.join(seen)).toEqual([
        'restore',
        'unpack',
        'backup',
        'move',
        'settle',
        'done',
      ])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('puts back what it moved when a file cannot be moved into the game', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const before = yield* mapText

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: mvMap(['こんばんは']),
        extra: { 'www/data/Map002.json': mvMap(['追加マップ']) },
      })

      const failure = yield* Effect.flip(
        translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true }),
      )

      expect(failure).toMatchObject({ reason: 'failed' })
      expect(yield* mapText).toBe(before)
      expect(yield* fs.exists(path.join(folder, 'www', 'data', 'Map002.json'))).toBe(false)
      expect(yield* translation.getGameUpdate({ gameId: game.id })).toEqual(Option.none())
      expect(yield* fs.readDirectory(path.join(folder, '.wenbu-updates'))).toEqual([])

      expect(
        yield* fs.readFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json')),
      ).toContain('こんにちは')

      yield* translation.applyTranslationEdits({ gameId: game.id })
    }).pipe(
      Effect.scoped,
      Effect.provide(layerWithFree(100 * 1024 ** 3, failingMoves('Map002.json'))),
    ),
  )

  it.live('refuses a zip of another game and leaves everything as it was', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const before = yield* mapText

      const archive = yield* updateZip(folder, 'Other.zip', 'Other/', {
        title: '月夜の迷宮',
        map: messagesMap(['別のゲーム']),
      })

      const refused = yield* Effect.flip(
        translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true }),
      )

      expect(refused.message).toBe('The zip holds 月夜の迷宮, not 魔法の森.')
      expect(yield* mapText).toBe(before)
      expect(yield* translation.getGameUpdate({ gameId: game.id })).toEqual(Option.none())
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('undoes an installed update and puts the translation back', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished, mapText } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const before = yield* mapText

      const archive = yield* updateZip(folder, 'Magic_ver1.1.zip', 'Magic_ver1.1/', {
        title: '魔法の森',
        map: mvMap(['こんばんは']),
        extra: { 'www/data/Map002.json': mvMap(['追加マップ']) },
      })

      yield* translation.installGameUpdate({ gameId: game.id, archive, acceptWarnings: true })
      yield* translation.undoGameUpdate({ gameId: game.id })

      expect(yield* mapText).toBe(before)
      expect(yield* fs.exists(path.join(folder, 'www', 'data', 'Map002.json'))).toBe(false)
      expect(yield* translation.getGameUpdate({ gameId: game.id })).toEqual(Option.none())

      expect(
        yield* fs.readFileString(path.join(folder, 'www', 'data.wenbu-original', 'Map001.json')),
      ).toContain('こんにちは')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('exports the translated data files as a zip players unpack over the game', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map002.json'),
        yield* encodeJson(mvMap(['never'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const target = path.join(path.dirname(folder), 'patch.zip')

      const result = yield* translation.exportTranslation({
        gameId: game.id,
        format: 'data-files',
        target,
        readme: true,
      })

      const files = unzipSync(yield* fs.readFile(target))
      const readme = new TextDecoder().decode(files['README.txt'])

      expect(Object.keys(files).toSorted()).toEqual([
        'README.txt',
        'www/data/Map001.json',
        'www/data/System.json',
      ])

      expect(result).toMatchObject({ files: 2 })
      expect(new TextDecoder().decode(files['www/data/Map001.json'])).toContain('EN:こんにちは')
      expect(readme).toContain('魔法の森')
      expect(readme).toContain('www')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('exports only translated lines as CSV and JSON', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['こんにちは', 'never', '「はい」、そう\n言った'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const csvPath = path.join(path.dirname(folder), 'lines.csv')
      const jsonPath = path.join(path.dirname(folder), 'lines.json')

      const csv = yield* translation.exportTranslation({
        gameId: game.id,
        format: 'csv',
        target: csvPath,
        readme: false,
      })

      yield* translation.exportTranslation({
        gameId: game.id,
        format: 'json',
        target: jsonPath,
        readme: false,
      })

      const csvBytes = yield* fs.readFile(csvPath)
      const csvText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvBytes)

      const json = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            format: Schema.String,
            game: Schema.Struct({ title: Schema.String }),
            lines: Schema.Array(Schema.Record(Schema.String, Schema.String)),
          }),
        ),
      )(yield* fs.readFileString(jsonPath))

      expect(csv.lines).toBe(4)
      expect(csvText.startsWith('﻿File,Location,Original,Translation\r\n')).toBe(true)
      expect(csvText).toContain('"「はい」、そう\n言った","EN:「はい」、そう\n言った"')
      expect(csvText).not.toContain('never')

      expect(json).toMatchObject({ format: 'wenbu-translation', game: { title: '魔法の森' } })
      expect(json.lines).toHaveLength(4)

      expect(json.lines[0]).toMatchObject({
        file: 'Map001.json',
        original: 'こんにちは',
        translation: 'EN:こんにちは',
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('refuses to export data files while the game has files changed outside Wenbu', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(mvMap(['こんばんは'])),
      )

      const refused = yield* Effect.flip(
        translation.exportTranslation({
          gameId: game.id,
          format: 'data-files',
          target: path.join(path.dirname(folder), 'patch.zip'),
          readme: false,
        }),
      )

      expect(refused).toMatchObject({ field: 'gameFiles' })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('flags lines too long for their window and shortens one', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['あ'.repeat(30), 'はい'])),
      )

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished

      const list = translation.listTranslationLines({
        gameId: game.id,
        filter: 'too-long',
        query: '',
        limit: 10,
      })

      const tooLong = yield* list
      const target = { gameId: game.id, entryId: tooLong.lines[0]?.entryId ?? '' }
      const shortened = yield* translation.shortenTranslationLine(target)

      yield* translation.setTranslationLineLocked({ ...target, locked: true })

      const refused = yield* Effect.flip(translation.shortenTranslationLine(target))

      expect(tooLong.lines.map((line) => line.sourceText)).toEqual(['あ'.repeat(30)])
      expect(tooLong.counts.tooLong).toBe(1)
      expect(shortened).toMatchObject({ translatedText: 'Short', origin: 'model' })
      expect((yield* list).counts.tooLong).toBe(0)
      expect(refused.message).toBe('Unlock the line to shorten it.')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('counts lines that stay the same and never sends lines of control codes only', () =>
    Effect.gen(function* () {
      const { translation, game, folder, finished } = yield* setup([])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map001.json'),
        yield* encodeJson(messagesMap(['same', 'こんにちは', '\\F[b1a]', '\\C[2]\\.'])),
      )

      yield* translation.startTranslation({ gameId: game.id })

      const run = yield* finished

      expect(run.steps.map((step) => step.summary)).toEqual([
        'Saved a copy of the original files',
        '4 lines in 2 files',
        'All 4 lines',
        '3 lines written · 1 already the same',
      ])

      expect(run.steps[1]?.notes).toContain('Skipped 2 values: control codes only')
      expect(run.usage.inputTokens).toBe(400)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('refuses to start when the drive cannot hold the copy of the originals', () =>
    Effect.gen(function* () {
      const { translation, game, folder, gameState } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const exit = yield* Effect.exit(translation.startTranslation({ gameId: game.id }))

      assert(Exit.isFailure(exit))
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBeInstanceOf(NotEnoughSpace)
      expect(yield* translation.listTranslationRuns({ gameId: game.id })).toEqual([])
      expect(yield* fs.exists(path.join(folder, 'www', 'data.wenbu-original'))).toBe(false)
      expect(yield* gameState).toBe('original')
    }).pipe(Effect.scoped, Effect.provide(layerWithFree(reserveBytes))),
  )

  it.live('finishes as partial when lines stay untranslated, naming failed batches', () =>
    Effect.gen(function* () {
      const { translation, game, finished, gameState } = yield* setup(['こんにちは'])
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const library = yield* RpcTest.makeClient(LibraryRpc)
      const folder = (yield* library.listGames())[0]?.folderPath ?? ''

      yield* fs.writeFileString(
        path.join(folder, 'www', 'data', 'Map002.json'),
        '{"displayName":"","events":[null,{"pages":[{"list":[{"code":401,"parameters":["never"]},{"code":0,"parameters":[]},{"code":401,"parameters":["broken"]}]}]}]}',
      )

      yield* translation.startTranslation({ gameId: game.id })

      const run = yield* finished
      const translate = run.steps.find((step) => step.id === 'translate')

      expect(run.status).toBe('partial')
      expect(translate?.status).toBe('warning')
      expect(translate?.summary).toBe('3 lines of 5 · 2 lines left after 2 rounds')

      expect(translate?.notes).toEqual(['The model is unavailable. (2 batches)'])

      expect(yield* gameState).toBe('partial')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('retranslates from the originals and removes a translation', () =>
    Effect.gen(function* () {
      const { translation, game, finished, mapText, gameState } = yield* setup(['こんにちは'])

      yield* translation.startTranslation({ gameId: game.id })
      yield* finished
      yield* translation.startTranslation({ gameId: game.id })

      const second = yield* firstRun(
        translation.watchTranslation({ gameId: game.id }),
        (run) =>
          run.status !== 'running' && run.steps[0]?.summary === 'Using the saved original files',
      )

      expect(second.status).toBe('translated')
      expect(yield* mapText).toContain('"EN:こんにちは"')
      expect(yield* mapText).not.toContain('EN:EN:')

      yield* translation.removeTranslation({ gameId: game.id })

      expect(yield* mapText).toContain('"こんにちは"')
      expect(yield* gameState).toBe('original')
      expect(yield* translation.listTranslationRuns({ gameId: game.id })).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('cancels a run without touching the game files', () =>
    Effect.gen(function* () {
      const { translation, game, finished, mapText, gameState } = yield* setup(['hang'])
      const before = yield* mapText

      yield* translation.startTranslation({ gameId: game.id })

      yield* translation.watchTranslation({ gameId: game.id }).pipe(
        Stream.filter((run) => Option.exists(run, (value) => value.steps[2]?.status === 'running')),
        Stream.runHead,
      )

      const conflict = yield* Effect.flip(translation.startTranslation({ gameId: game.id }))

      yield* translation.cancelTranslation({ gameId: game.id })

      const run = yield* finished

      expect(conflict).toMatchObject({ reason: 'conflict' })
      expect(run.status).toBe('cancelled')
      expect(run.steps.map((step) => step.status)).toEqual(['done', 'done', 'cancelled', 'pending'])
      expect(yield* mapText).toBe(before)
      expect(yield* gameState).toBe('original')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('refuses a blank target language and trims a typed one', () =>
    Effect.gen(function* () {
      const { translation } = yield* setup(['こんにちは'])

      const blank = yield* Effect.flip(
        translation.saveTranslationSettings({ ...settings, targetLanguage: '  ' }),
      )

      const saved = yield* translation.saveTranslationSettings({
        ...settings,
        targetLanguage: ' Brazilian Portuguese ',
      })

      expect([blank.field, saved.targetLanguage]).toEqual([
        'targetLanguage',
        'Brazilian Portuguese',
      ])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('resets only the saved settings that no longer fit', () =>
    Effect.gen(function* () {
      const translation = yield* RpcTest.makeClient(GameTranslationRpc)
      const store = yield* KeyValueStore.KeyValueStore

      yield* store.set(
        'game-translation',
        '{"presetId":"preset-1","coverage":{"dialogue401":true},"applyRisky":false}',
      )

      expect(yield* translation.getTranslationSettings()).toEqual({
        ...defaultTranslationSettings,
        presetId: 'preset-1',
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('keeps saved settings when a field was added later', () =>
    Effect.gen(function* () {
      const translation = yield* RpcTest.makeClient(GameTranslationRpc)
      const store = yield* KeyValueStore.KeyValueStore
      const older = Struct.omit(settings, ['reuseDuplicates'])

      yield* store.set('game-translation', yield* encodeJson(older))

      expect(yield* translation.getTranslationSettings()).toEqual({
        ...older,
        reuseDuplicates: defaultTranslationSettings.reuseDuplicates,
      })
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('stops using a preset once it is deleted', () =>
    Effect.gen(function* () {
      const { translation } = yield* setup(['こんにちは'])
      const references = yield* PresetReferences

      const before = yield* references.areasUsing(new Set(['preset-1']))

      yield* references.clear(new Set(['preset-1']))

      expect(before).toEqual(['Game translation'])
      expect((yield* translation.getTranslationSettings()).presetId).toBe('')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('asks for a preset before starting', () =>
    Effect.gen(function* () {
      const { translation, game } = yield* setup(['こんにちは'])

      yield* translation.saveTranslationSettings({ ...settings, presetId: '' })

      const missing = yield* Effect.flip(translation.startTranslation({ gameId: game.id }))

      yield* translation.saveTranslationSettings({ ...settings, presetId: 'deleted' })

      const deleted = yield* Effect.flip(translation.startTranslation({ gameId: game.id }))

      expect(missing).toMatchObject({ field: 'presetId', message: 'Choose a preset.' })
      expect(deleted.message).toBe('The chosen preset no longer exists. Choose another.')

      assert.isTrue(
        Option.isNone(
          yield* translation
            .watchTranslation({ gameId: game.id })
            .pipe(Stream.runHead, Effect.map(Option.flatten)),
        ),
      )
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('never writes game text or translations to the log, even when verbose', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const folder = path.join(yield* fs.makeTempDirectoryScoped(), '2026-10-25T10-00-00')

      const logging = LogBook.logger.pipe(
        Layer.provideMerge(LogBook.layerWith({ folder, run: 1, home: '' })),
      )

      const logText = yield* Effect.gen(function* () {
        const book = yield* LogBook

        yield* book.setVerbose(true)

        const { translation, game, finished } = yield* setup([
          'SECRET-LINE-こんにちは',
          'SECRET-LINE-broken',
        ])

        yield* translation.startTranslation({ gameId: game.id })
        yield* finished

        return yield* fs.readFileString(path.join(folder, 'core.log')).pipe(
          Effect.filterOrFail((text) => text.includes('Game translation finished')),
          Effect.retry({ schedule: Schedule.spaced('20 millis'), times: 100 }),
        )
      }).pipe(Effect.scoped, Effect.provide(TestLayer.pipe(Layer.provideMerge(logging))))

      expect(logText).toContain('Translation batch failed')
      expect(logText).not.toContain('SECRET')
      expect(logText).not.toContain('EN:')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
