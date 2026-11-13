import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  type Scope,
  Stream,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import type { OcrResult } from '#contract/Detections'
import { defaultMangaSettings, MangaRpc } from '#contract/Manga'
import {
  defaultLettering,
  type EditorPage,
  linesOf,
  MangaEditorRpc,
  type MangaEditorState,
} from '#contract/MangaEditor'
import type { Plugin } from '#contract/Plugins'
import { ScreenAiOcr } from '../detections/ScreenAiOcr'
import { type CompletionRequest, LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import { MangaRpcLive } from '../manga/Manga'
import { MangaRuntime } from '../manga/MangaRuntime'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { Plugins } from '../plugins/Plugins'
import { doneSteps, fitParts, MangaEditorRpcLive, ocrText } from './MangaEditor'
import type { StoredBlock } from './MangaEditorStore'

const fakeWorker = fileURLToPath(new URL('../manga/__fixtures__/fake-worker.mjs', import.meta.url))

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

const reply = (request: CompletionRequest) => {
  if (request.system?.includes('You help a translator') === true) {
    return JSON.stringify({ reply: 'Worried.', suggestion: { line: 1, translation: 'Hey?' } })
  }

  const lines = [...request.prompt.matchAll(/^(\d+)\. \[\w+\] (.*)$/gm)].map(([, n, text]) => ({
    n: Number(n),
    romaji: (text ?? '')
      .split('|')
      .map(() => 'romaji')
      .join(' | '),
    translation: (text ?? '')
      .split('|')
      .map((part) => `EN ${part}`)
      .join(' | '),
  }))

  return JSON.stringify({ lines })
}

const drawnText: OcrResult = {
  image: { width: 30, height: 60 },
  paragraphs: [
    {
      lines: [
        { text: 'ドキ', box: { centerX: 0.3, centerY: 0.5, width: 0.4, height: 0.9 }, words: [] },
        { text: 'ドキ', box: { centerX: 0.7, centerY: 0.5, width: 0.4, height: 0.9 }, words: [] },
      ],
    },
  ],
}

const setup = Effect.fn(function* (options: { readonly preset?: string } = {}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const folder = path.join(root, 'gallery')
  const requests = yield* Ref.make<ReadonlyArray<CompletionRequest>>([])

  yield* fs.makeDirectory(folder)

  for (const page of ['1.jpg', '2.jpg']) {
    yield* fs.writeFileString(path.join(folder, page), `page ${page}`)
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
    state: Stream.make({ plugins: [installedPlugin], checking: false }),
    installedFolder: () => Effect.succeed(Option.some(path.join(root, 'plugin'))),
    check: Effect.void,
    install: () => Effect.void,
    cancel: () => Effect.void,
    remove: () => Effect.void,
    test: () => Effect.void,
  })

  const screenAi = Layer.succeed(ScreenAiOcr)({
    recognize: () => Effect.succeed(drawnText),
    stop: Effect.void,
  })

  const runtime = MangaRuntime.layer(
    () => ({ command: process.execPath, args: [fakeWorker], env: {} }),
    { idle: '1 minute' },
  )

  const layer = Layer.mergeAll(MangaEditorRpcLive, MangaRpcLive).pipe(
    Layer.provideMerge(PresetReferences.layer),
    Layer.provide(
      Layer.mergeAll(llm, plugins, screenAi, runtime, DiskSpace.fixed(100 * 1024 ** 3)),
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
  const client = yield* RpcTest.makeClient(MangaEditorRpc).pipe(Effect.provideContext(context))
  const manga = yield* RpcTest.makeClient(MangaRpc).pipe(Effect.provideContext(context))

  yield* manga.saveMangaSettings({
    ...defaultMangaSettings,
    presetId: options.preset ?? 'preset-1',
  })

  const opened = yield* client.openMangaEditor({ folder })

  const until = (ready: (state: MangaEditorState) => boolean) =>
    client
      .watchMangaEditor({ folder: opened })
      .pipe(
        Stream.filter(ready),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('10 seconds'),
      )

  return { client, folder: opened, requests, until }
})

const first = (state: MangaEditorState): EditorPage =>
  state.pages[0] ?? {
    name: '',
    blocks: [],
    done: [],
    cleanVersion: 0,
    renderVersion: 0,
    brushVersion: 0,
    canUndo: false,
    canRedo: false,
  }

const test = <E>(
  name: string,
  body: Effect.Effect<void, E, NodeServices.NodeServices | Scope.Scope>,
) => it.live(name, () => body.pipe(Effect.scoped, Effect.provide(NodeServices.layer)), 20_000)

const page = '1.jpg'

describe('MangaEditor', () => {
  test(
    'does nothing until asked, then scans and translates one page',
    Effect.gen(function* () {
      const { client, folder, requests, until } = yield* setup()
      const opened = yield* until((state) => state.pages.length === 2)

      expect(opened.pages.map((one) => one.done)).toEqual([[], []])

      yield* client.scanMangaEditorPage({ folder, page, translate: true })

      const state = yield* until((current) => first(current).done.includes('translate'))

      expect(first(state).blocks.map((block) => [block.source, block.translation])).toEqual([
        ['ねえ、', 'EN ねえ、'],
        ['聞いてる？', 'EN 聞いてる？'],
      ])

      expect(first(state).blocks[0]?.romaji).toBe('romaji')

      expect(first(state).blocks.map((block) => block.lettering.textBox)).toEqual([
        { x: 52, y: 4, width: 46, height: 66 },
        undefined,
      ])

      expect(state.pages[1]?.done).toEqual([])
      expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.01 })
      expect(yield* Ref.get(requests)).toHaveLength(1)
    }),
  )

  test(
    'inpaints a brushed area on top of the cleaned page, and undoes it like any edit',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()

      const cleanedImage = client
        .readMangaEditorImage({ folder, page, kind: 'cleaned', version: 0 })
        .pipe(Effect.map((bytes) => new TextDecoder().decode(bytes)))

      yield* client.scanMangaEditorPage({ folder, page, translate: false })
      yield* client.cleanMangaEditorPage({ folder, page })
      yield* until((state) => first(state).cleanVersion === 1)

      const cleaned = yield* cleanedImage

      yield* client.brushMangaEditorPage({ folder, page, image: new Uint8Array([1, 2, 3]) })
      yield* until((state) => first(state).cleanVersion === 2)

      expect(yield* cleanedImage).toContain('editor-output')

      yield* client.undoMangaEditor({ folder, page })
      yield* until((state) => first(state).cleanVersion === 3)

      expect(yield* cleanedImage).toBe(cleaned)
    }),
  )

  test(
    'letters pages only on export, with the lines and sizes the editor laid out',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()

      yield* client.scanMangaEditorPage({ folder, page, translate: true })
      yield* client.cleanMangaEditorPage({ folder, page })

      const cleaned = yield* until((state) => first(state).cleanVersion === 1)

      expect(first(cleaned).done).toEqual(['scan', 'translate', 'clean'])

      const underText = yield* client.readMangaEditorImage({
        folder,
        page,
        kind: 'cleaned',
        version: 1,
      })

      expect(new TextDecoder().decode(underText)).toContain('clean')

      const [heyId = '', youId = ''] = first(cleaned).blocks.map((block) => block.id)

      yield* client.updateMangaEditorLine({ folder, page, id: heyId, translation: 'Hey you' })

      yield* client.exportMangaEditor({
        folder,
        layouts: { [heyId]: { size: 42, lines: ['HEY', 'YOU'] } },
      })

      const exported = yield* until((state) => first(state).renderVersion === 1)
      const resultFile = yield* client.findMangaEditorImage({ folder, page, kind: 'result' })

      const lettered = new TextDecoder().decode(
        yield* (yield* FileSystem.FileSystem).readFile(resultFile),
      )

      expect(lettered).toContain('["HEY\\nYOU",42]')

      expect(first(exported).blocks.find((block) => block.id === youId)?.translation).toBe(
        'EN 聞いてる？',
      )
    }),
  )

  test(
    'exports every page into the output folder, under its own name, and leaves the originals alone',
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { client, folder, until } = yield* setup()

      yield* client.scanMangaEditorPage({ folder, page, translate: true })
      yield* until((state) => first(state).done.includes('translate'))

      const output = yield* client.exportMangaEditor({ folder, layouts: {} })

      expect(output).toBe(path.join(folder, 'translated'))
      expect((yield* fs.readDirectory(output)).toSorted()).toEqual(['1.jpg', '2.jpg'])
      expect(yield* fs.readFileString(path.join(output, '1.jpg'))).toContain('render')
      expect(yield* fs.readFileString(path.join(folder, '1.jpg'))).toBe('page 1.jpg')
      expect(yield* fs.readFileString(path.join(folder, '2.jpg'))).toBe('page 2.jpg')
    }),
  )

  test(
    'reads a box drawn on a translated page, places it in reading order and translates it',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()

      yield* client.scanMangaEditorPage({ folder, page, translate: true })

      const id = yield* client.addMangaEditorBlock({
        folder,
        page,
        box: { x: 20, y: 80, width: 30, height: 30 },
        image: { width: 1, height: 1, pixels: new Uint8Array(4) },
      })

      const state = yield* until(
        (current) => first(current).blocks.find((block) => block.id === id)?.status === 'draft',
      )

      expect(first(state).blocks.map((block) => block.source)).toEqual([
        'ねえ、',
        'ドキドキ',
        '聞いてる？',
      ])

      expect(first(state).blocks[1]).toMatchObject({ origin: 'drawn', translation: 'EN ドキドキ' })
    }),
  )

  test(
    'reorders, merges and splits lines, and undoes and redoes them',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()

      yield* client.scanMangaEditorPage({ folder, page, translate: false })

      const scanned = yield* until((state) => first(state).blocks.length === 2)
      const [a = '', b = ''] = first(scanned).blocks.map((block) => block.id)

      yield* client.orderMangaEditorLines({ folder, page, ids: [b, a] })

      const reordered = yield* until((state) => first(state).blocks[0]?.id === b)

      expect(first(reordered).canUndo).toBe(true)

      yield* client.mergeMangaEditorLines({ folder, page, ids: [a, b] })

      const merged = yield* until((state) => linesOf(first(state).blocks).length === 1)

      expect(first(merged).blocks.map((block) => block.id)).toEqual([b, a])

      yield* client.splitMangaEditorLine({ folder, page, id: b })
      yield* until((state) => linesOf(first(state).blocks).length === 2)
      yield* client.undoMangaEditor({ folder, page })

      const undone = yield* until((state) => linesOf(first(state).blocks).length === 1)

      expect(first(undone).canRedo).toBe(true)

      yield* client.redoMangaEditor({ folder, page })
      yield* until((state) => linesOf(first(state).blocks).length === 2)
    }),
  )

  test(
    'reports the missing preset on the page when translating',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup({ preset: '' })

      const error = yield* Effect.flip(
        client.scanMangaEditorPage({ folder, page, translate: true }),
      )

      expect(error.message).toContain('Choose an LLM preset')

      const state = yield* until((current) => first(current).error !== undefined)

      expect(first(state).done).toEqual(['scan'])
    }),
  )

  test(
    'chats about the page and proposes a translation for a line',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()

      yield* client.scanMangaEditorPage({ folder, page, translate: true })

      const state = yield* until((current) => first(current).done.includes('translate'))
      const id = first(state).blocks[0]?.id ?? ''

      const answer = yield* client.chatMangaEditor({
        folder,
        page,
        id,
        messages: [{ role: 'user', text: 'Is she worried?' }],
      })

      expect(answer).toEqual({
        text: 'Worried.',
        suggestion: { id, number: 1, translation: 'Hey?' },
      })
    }),
  )

  test(
    'keeps settings per gallery and offers line breaks for a bubble',
    Effect.gen(function* () {
      const { client, folder, until } = yield* setup()
      const settings = yield* client.getMangaEditorSettings({ folder })

      expect(settings).toMatchObject({
        presetId: 'preset-1',
        font: 'Anime Ace',
        cleanMethod: 'fill',
      })

      const saved = yield* client.saveMangaEditorSettings({
        folder,
        settings: { ...settings, seriesNotes: 'Keep -chan.' },
      })

      expect(saved.seriesNotes).toBe('Keep -chan.')
      expect((yield* client.getMangaEditorSettings({ folder })).seriesNotes).toBe('Keep -chan.')

      const refused = yield* Effect.flip(
        client.saveMangaEditorSettings({
          folder,
          settings: { ...settings, outlineColor: 'white' },
        }),
      )

      expect(refused.reason).toBe('invalid')

      yield* client.scanMangaEditorPage({ folder, page, translate: true })

      const state = yield* until((current) => first(current).done.includes('translate'))
      const id = first(state).blocks[0]?.id ?? ''

      expect(yield* client.breaksMangaEditorBlock({ folder, page, id })).toEqual([
        { lines: ['HEY,', 'YOU'], fontSize: 20 },
      ])

      yield* client.letterMangaEditorBlock({
        folder,
        page,
        id,
        lettering: { ...defaultLettering, breakMode: 'greedy', size: 18 },
        everyBubble: true,
      })

      const lettered = yield* until(
        (current) => first(current).blocks[1]?.lettering.breakMode === 'greedy',
      )

      expect(first(lettered).blocks[1]?.lettering.size).toBe(18)
    }),
  )
})

describe('helpers', () => {
  it('fits typed parts to the bubbles', () => {
    expect(fitParts(['a'], 2)).toEqual(['a', ''])
    expect(fitParts(['a', 'b', 'c'], 2)).toEqual(['a', 'b c'])
  })

  it('reads vertical columns right to left', () => {
    expect(
      ocrText({
        image: { width: 100, height: 100 },
        paragraphs: [
          {
            lines: [
              {
                text: '二',
                box: { centerX: 0.2, centerY: 0.5, width: 0.1, height: 0.8 },
                words: [],
              },
              {
                text: '一',
                box: { centerX: 0.8, centerY: 0.5, width: 0.1, height: 0.8 },
                words: [],
              },
            ],
          },
        ],
      }),
    ).toBe('一二')
  })

  it('judges the steps a page has finished from what it holds', () => {
    const translated: Pick<StoredBlock, 'translation'> = { translation: 'Hey' }

    const stored = {
      page,
      scannedAt: '2026-10-27T00:00:00Z',
      scanError: undefined,
      cleanKey: undefined,
      renderKey: undefined,
      cleanVersion: 1,
      renderVersion: 0,
      brushVersion: 0,
    }

    expect(doneSteps(undefined, [])).toEqual([])
    expect(doneSteps(stored, [translated, { translation: '' }])).toEqual(['scan', 'clean'])
    expect(doneSteps(stored, [translated])).toEqual(['scan', 'translate', 'clean'])
  })
})
