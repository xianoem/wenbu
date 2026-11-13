import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import {
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  type Scope,
  Stream,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { defaultMangaSettings, MangaRpc, type MangaRun, type MangaSettings } from '#contract/Manga'
import type { Plugin } from '#contract/Plugins'
import { NotEnoughSpace, reserveBytes } from '#contract/Storage'
import { type CompletionRequest, LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { Plugins } from '../plugins/Plugins'
import { MangaRpcLive, recentPages } from './Manga'
import { MangaRuntime } from './MangaRuntime'

const fakeWorker = fileURLToPath(new URL('./__fixtures__/fake-worker.mjs', import.meta.url))

const installedPlugin: Plugin = {
  id: 'manga-image-translator',
  name: 'manga-image-translator',
  description: '',
  project: '',
  license: 'GPL-3.0',
  sourceLabel: '',
  sourceUrl: '',
  platforms: ['win32'],
  supported: true,
  installed: {
    version: '1',
    sizeBytes: 1,
    installedAt: '2026-10-24T00:00:00Z',
    test: { passed: true, message: '', testedAt: '2026-10-24T00:00:00Z' },
  },
}

type Reply = (request: CompletionRequest) => string

const setup = Effect.fn(function* (
  options: { reply?: Reply; installed?: boolean; freeBytes?: number } = {},
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const folder = path.join(root, 'gallery')
  const requests = yield* Ref.make<ReadonlyArray<CompletionRequest>>([])
  const installed = options.installed ?? true

  const reply: Reply =
    options.reply ?? ((request) => request.prompt.replaceAll(/<\|(\d+)\|>/g, '<|$1|>EN '))

  yield* fs.makeDirectory(folder)

  for (const page of ['1.jpg', '2.jpg', '3.jpg']) {
    yield* fs.writeFileString(path.join(folder, page), '')
  }

  const llm = Layer.succeed(LlmClient)({
    model: () => Effect.die('The Game Guide model is not used here.'),
    complete: (request) =>
      Ref.update(requests, (all) => [...all, request]).pipe(
        Effect.as({
          text: reply(request),
          usage: { inputTokens: 10, outputTokens: 5 },
          costUsd: 0.01,
        }),
      ),
    describe: () => Effect.succeed({ presetName: 'Manga', modelName: 'Fake 1' }),
  })

  const plugins = Layer.succeed(Plugins)({
    state: Stream.make({ plugins: installed ? [installedPlugin] : [], checking: false }),
    installedFolder: () =>
      Effect.succeed(installed ? Option.some(path.join(root, 'plugin')) : Option.none()),
    check: Effect.void,
    install: () => Effect.void,
    cancel: () => Effect.void,
    remove: () => Effect.void,
    test: () => Effect.void,
  })

  const runtime = MangaRuntime.layer(
    () => ({ command: process.execPath, args: [fakeWorker], env: {} }),
    {
      idle: '1 minute',
    },
  )

  const layer = MangaRpcLive.pipe(
    Layer.provideMerge(PresetReferences.layer),
    Layer.provide(
      Layer.mergeAll(llm, plugins, runtime, DiskSpace.fixed(options.freeBytes ?? 100 * 1024 ** 3)),
    ),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provide(Database.layer(':memory:')),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ WENBU_RESOURCES_DIR: root, WENBU_DATA_DIR: root }),
      ),
    ),
  )

  const context = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(MangaRpc).pipe(Effect.provideContext(context))

  const settle = (runId: string) =>
    client.watchMangaRuns().pipe(
      Stream.map((runs) => runs.find((run) => run.id === runId)),
      Stream.filter((run): run is MangaRun => run !== undefined && run.status !== 'running'),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    )

  const withPreset = (change: Partial<MangaSettings> = {}) =>
    client.saveMangaSettings({ ...defaultMangaSettings, presetId: 'preset-1', ...change })

  return {
    client,
    folder,
    root,
    requests,
    settle,
    withPreset,
    references: Context.get(context, PresetReferences),
    store: Context.get(context, KeyValueStore.KeyValueStore),
  }
})

const test = <E>(
  name: string,
  body: Effect.Effect<void, E, NodeServices.NodeServices | Scope.Scope>,
) => it.effect(name, () => body.pipe(Effect.scoped, Effect.provide(NodeServices.layer)), 20_000)

describe('Manga', () => {
  test(
    'saves settings and refuses ones that make no sense',
    Effect.gen(function* () {
      const { client, withPreset } = yield* setup()

      expect((yield* withPreset({ outputFolderName: ' done ' })).outputFolderName).toBe('done')
      expect((yield* client.getMangaSettings()).presetId).toBe('preset-1')

      const error = yield* Effect.flip(withPreset({ minFontSize: 50, maxFontSize: 20 }))

      expect(error.field).toBe('maxFontSize')
      expect((yield* Effect.flip(withPreset({ textColor: 'black' }))).field).toBe('textColor')
      expect((yield* withPreset({ textColor: '#1a1a1a' })).textColor).toBe('#1a1a1a')
    }),
  )

  test(
    'keeps settings saved before a setting existed',
    Effect.gen(function* () {
      const { client, store } = yield* setup()
      const { textColor: _textColor, borderColor: _borderColor, ...older } = defaultMangaSettings

      const saved = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
        ...older,
        presetId: 'preset-1',
      })

      yield* store.set('manga-translation', saved)

      expect(yield* client.getMangaSettings()).toMatchObject({
        presetId: 'preset-1',
        textColor: 'auto',
        borderColor: '#ffffff',
      })
    }),
  )

  test(
    'refuses to start when the drive cannot hold the translated pages',
    Effect.gen(function* () {
      const { client, folder, withPreset } = yield* setup({ freeBytes: reserveBytes })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* fs.writeFile(path.join(folder, '1.jpg'), new Uint8Array(10))
      yield* withPreset()

      expect(yield* Effect.flip(client.startMangaRun({ folder }))).toBeInstanceOf(NotEnoughSpace)
    }),
  )

  test(
    'stops the run when the drive fills up before a page',
    Effect.gen(function* () {
      const { client, folder, withPreset, settle } = yield* setup({ freeBytes: reserveBytes })

      yield* withPreset()

      const run = yield* settle(yield* client.startMangaRun({ folder }))

      expect(run).toMatchObject({ status: 'failed', space: { freeBytes: reserveBytes } })
    }),
  )

  test(
    'counts the pages of a folder',
    Effect.gen(function* () {
      const { client, folder } = yield* setup()
      const checked = yield* client.checkMangaFolder({ folder })

      expect(checked).toMatchObject({ pages: 3, translatedPages: 0 })
      expect(checked.outputFolder.endsWith('translated')).toBe(true)
    }),
  )

  test(
    'needs a preset and the plugin before it starts',
    Effect.gen(function* () {
      const { client, folder, withPreset } = yield* setup({ installed: false })

      expect(yield* Effect.flip(client.startMangaRun({ folder }))).toMatchObject({
        field: 'presetId',
      })

      yield* withPreset()

      expect(yield* Effect.flip(client.startMangaRun({ folder }))).toMatchObject({
        reason: 'plugin-missing',
      })
    }),
  )

  test(
    'translates every page with the preset, in numbered lines',
    Effect.gen(function* () {
      const { client, folder, requests, settle, withPreset } = yield* setup()

      yield* withPreset()

      const run = yield* settle(yield* client.startMangaRun({ folder }))
      const sent = yield* Ref.get(requests)

      expect(run).toMatchObject({ status: 'translated', pages: { total: 3, done: 3, failed: 0 } })
      expect(run.recentPages).toBeUndefined()

      expect(sent.map((request) => request.prompt).toSorted()).toEqual([
        '<|1|>text0',
        '<|1|>text1',
        '<|1|>text2',
      ])

      expect(sent[0]?.system).toContain('into English')
      expect(run.usage).toEqual({ inputTokens: 30, outputTokens: 15, costUsd: 0.03 })
    }),
  )

  test(
    'asks again when a reply misses lines, then gives the page up',
    Effect.gen(function* () {
      const { client, folder, requests, settle, withPreset } = yield* setup({
        reply: () => 'Sorry, I cannot.',
      })

      yield* withPreset({ retryAttempts: 2 })

      const run = yield* settle(yield* client.startMangaRun({ folder }))

      expect(run.status).toBe('failed')
      expect(run.pages.failed).toBe(3)

      expect(run.problems[0]).toEqual({
        page: '1.jpg',
        message: 'The reply did not have every numbered line.',
      })

      expect((yield* Ref.get(requests)).length).toBe(6)
    }),
  )

  test(
    'skips pages that already have a translation',
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { client, folder, settle, withPreset } = yield* setup()

      yield* withPreset()
      yield* fs.makeDirectory(path.join(folder, 'translated'))
      yield* fs.writeFileString(path.join(folder, 'translated', '1.jpg'), '')

      const run = yield* settle(yield* client.startMangaRun({ folder }))

      expect(run.pages).toEqual({ total: 3, done: 2, failed: 0, skipped: 1 })
    }),
  )

  test(
    'keeps presets it uses from being deleted unnoticed',
    Effect.gen(function* () {
      const { references, withPreset } = yield* setup()

      yield* withPreset()

      expect(yield* references.areasUsing(new Set(['preset-1']))).toEqual(['Manga translation'])
    }),
  )
})

describe('recentPages', () => {
  const pages = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'].map((name) => ({
    name,
    source: name,
    output: name,
    translated: false,
  }))

  it('shows the last finished pages, the ones in progress and the next one', () => {
    const tracked = new Map([
      [0, { status: 'done' as const, startedAt: 0, regions: 7, seconds: 9.8 }],
      [1, { status: 'done' as const, startedAt: 0, regions: 0, seconds: 1 }],
      [2, { status: 'failed' as const, startedAt: 0, message: 'No reply.', seconds: 4 }],
      [3, { status: 'done' as const, startedAt: 0, regions: 3, seconds: 5 }],
      [4, { status: 'running' as const, startedAt: 0, stage: 'lettering' as const }],
    ])

    expect(recentPages(pages, tracked, [0, 1, 2, 3])).toEqual([
      { name: '2.jpg', status: 'done', regions: 0, seconds: 1 },
      { name: '3.jpg', status: 'failed', message: 'No reply.', seconds: 4 },
      { name: '4.jpg', status: 'done', regions: 3, seconds: 5 },
      { name: '5.jpg', status: 'running', stage: 'lettering' },
      { name: '6.jpg', status: 'pending' },
    ])
  })
})
