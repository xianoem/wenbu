import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Schema, Stream, Struct } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  defaultDetectionSettings,
  DetectionError,
  type DetectionSettings,
  type DetectionsState,
  type OcrResult,
} from '#contract/Detections'
import type { Plugin } from '#contract/Plugins'
import { LlmSettingsError } from '#contract/Llm'
import { LlmClient, LlmClientError } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { Plugins } from '../plugins/Plugins'
import { Detections } from './Detections'
import { GoogleLens } from './GoogleLens'
import { ScreenAiOcr } from './ScreenAiOcr'

const ocrOf = (text: string): OcrResult => ({
  image: { width: 10, height: 10 },
  paragraphs: text === '' ? [] : [{ lines: [{ text, words: [{ text }] }] }],
})

const textOf = (pixels: Uint8Array) => (pixels[0] === 0 ? '' : 'こんにちは')

const image = (first = 255) => ({
  width: 1,
  height: 1,
  pixels: Uint8Array.from([first, 0, 0, 255]),
})

const screenAiPlugin = (installed: boolean): Plugin => ({
  id: 'screen-ai',
  name: 'Chrome Screen AI',
  description: '',
  project: 'Chrome Screen AI',
  license: '',
  sourceLabel: '',
  sourceUrl: '',
  platforms: ['win32', 'linux'],
  supported: true,
  ...(installed
    ? {
        installed: {
          version: '153.05',
          sizeBytes: 1,
          installedAt: '2026-10-23T00:00:00Z',
          test: {
            passed: true,
            message: 'Read the sample image.',
            testedAt: '2026-10-23T00:00:00Z',
          },
        },
      }
    : {}),
})

const PluginsFake = (installed: boolean) =>
  Layer.succeed(Plugins)({
    state: Stream.make({ plugins: [screenAiPlugin(installed)], checking: false }),
    installedFolder: () =>
      Effect.succeed(installed ? Option.some('plugins/screen-ai/153.05') : Option.none()),
    check: Effect.void,
    install: () => Effect.void,
    cancel: () => Effect.void,
    remove: () => Effect.void,
    test: () => Effect.void,
  })

const EnginesFake = Layer.mergeAll(
  Layer.succeed(ScreenAiOcr)({
    recognize: (_folder, input) => Effect.succeed(ocrOf(textOf(input.pixels))),
    stop: Effect.void,
  }),
  Layer.succeed(GoogleLens)({
    recognize: (input) => Effect.succeed(ocrOf(`lens:${textOf(input.pixels)}`)),
  }),
)

const LlmFake = Layer.succeed(LlmClient)({
  model: () => Effect.die('The Game Guide model is not used here.'),
  describe: (presetId) =>
    presetId === 'missing'
      ? Effect.fail(new LlmSettingsError({ reason: 'not-found', message: 'Missing.' }))
      : Effect.succeed({ presetName: 'Fast EN', modelName: 'Fake' }),
  complete: (request) =>
    request.presetId === 'broken'
      ? Effect.fail(new LlmClientError({ message: 'The model is unavailable.' }))
      : Effect.succeed({
          text: 'Hello',
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: undefined,
        }),
})

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const setup = (
  options: {
    readonly installed?: boolean
    readonly settings?: Partial<DetectionSettings>
    readonly stored?: object
  } = {},
) =>
  Effect.gen(function* () {
    const store = yield* Layer.build(KeyValueStore.layerMemory)

    if (options.stored !== undefined) {
      yield* Context.get(store, KeyValueStore.KeyValueStore).set(
        'detections',
        yield* encodeJson(options.stored),
      )
    }

    const layer = Detections.layer.pipe(
      Layer.provide([
        PluginsFake(options.installed ?? true),
        EnginesFake,
        LlmFake,
        Layer.succeedContext(store),
      ]),
      Layer.provideMerge(PresetReferences.layer),
      Layer.provideMerge(Database.layer(':memory:')),
    )

    const context = yield* Layer.build(layer)
    const detections = Context.get(context, Detections)
    const references = Context.get(context, PresetReferences)

    if (options.stored === undefined) {
      yield* detections.saveSettings({
        ...defaultDetectionSettings,
        engineId: 'screen-ai',
        ...options.settings,
      })
    }

    const latest = detections.state.pipe(Stream.runHead, Effect.map(Option.getOrThrow))

    return { detections, latest, references }
  })

describe('Detections', () => {
  it.live('keeps saved settings when a field was added later', () =>
    Effect.gen(function* () {
      const older = Struct.omit(
        {
          ...defaultDetectionSettings,
          engineId: 'google-lens' as const,
          concurrentJobs: 3,
          translation: { ...defaultDetectionSettings.translation, presetId: 'fast' },
        },
        ['cloudRequestsPerMinute'],
      )

      const { detections } = yield* setup({ stored: older })

      expect(yield* detections.settings).toEqual({
        ...older,
        cloudRequestsPerMinute: defaultDetectionSettings.cloudRequestsPerMinute,
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('stops using a preset once it is deleted', () =>
    Effect.gen(function* () {
      const { detections, references } = yield* setup({
        settings: { translation: { ...defaultDetectionSettings.translation, presetId: 'fast' } },
      })

      const before = yield* references.areasUsing(new Set(['fast']))

      yield* references.clear(new Set(['fast']))

      expect(before).toEqual(['Detections'])
      expect((yield* detections.settings).translation.presetId).toBe('')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('detects text with Screen AI and keeps it in the history, newest first', () =>
    Effect.gen(function* () {
      const { detections, latest } = yield* setup()

      yield* detections.detect(image(), 'image')

      const detection = yield* detections.detect(image(), 'clipboard')
      const state: DetectionsState = yield* latest

      expect(detection).toMatchObject({
        originalText: 'こんにちは',
        input: 'clipboard',
        engine: { id: 'screen-ai' },
      })

      expect(detection.translation).toBeUndefined()
      expect(state.detections.map((item) => item.input)).toEqual(['clipboard', 'image'])
      expect(state.pending).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('translates with the detection preset, and keeps the text when translation fails', () =>
    Effect.gen(function* () {
      const { detections } = yield* setup({
        settings: {
          translation: {
            ...defaultDetectionSettings.translation,
            presetId: 'fast',
            retryRounds: 1,
          },
        },
      })

      const translated = yield* detections.detect(image(), 'image')

      yield* detections.saveSettings({
        ...defaultDetectionSettings,
        engineId: 'screen-ai',
        translation: {
          ...defaultDetectionSettings.translation,
          presetId: 'broken',
          retryRounds: 1,
        },
      })

      const failed = yield* detections.detect(image(), 'image')

      expect(translated).toMatchObject({
        translatedText: 'Hello',
        translation: { status: 'translated', presetName: 'Fast EN' },
      })

      expect(failed).toMatchObject({
        originalText: 'こんにちは',
        translation: { status: 'failed', error: 'The model is unavailable.' },
      })

      expect(failed.translatedText).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('uses Google Lens when chosen', () =>
    Effect.gen(function* () {
      const { detections } = yield* setup({ settings: { engineId: 'google-lens' } })

      const detection = yield* detections.detect(image(), 'image')

      expect(detection).toMatchObject({
        originalText: 'lens:こんにちは',
        engine: { id: 'google-lens', label: 'Google Lens' },
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('asks for setup when no engine is chosen or Screen AI is not installed', () =>
    Effect.gen(function* () {
      const none = yield* setup({ settings: { engineId: undefined } })
      const missing = yield* setup({ installed: false })

      const noEngine = yield* Effect.flip(none.detections.detect(image(), 'image'))
      const notInstalled = yield* Effect.flip(missing.detections.detect(image(), 'image'))
      const engines = (yield* missing.latest).engines

      expect([noEngine.reason, noEngine.message]).toEqual([
        'not-ready',
        'Choose a detection engine in Settings → Detections.',
      ])

      expect(notInstalled.message).toBe('Install Chrome Screen AI in Settings → Plugins.')

      expect(engines.map((engine) => [engine.id, engine.ready])).toEqual([
        ['screen-ai', false],
        ['google-lens', true],
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('reports an image without text, and shows it until the next detection', () =>
    Effect.gen(function* () {
      const { detections, latest } = yield* setup()

      const error = yield* Effect.flip(detections.detect(image(0), 'image'))
      const failedState = yield* latest

      yield* detections.detect(image(), 'image')

      const nextState = yield* latest

      expect(error).toBeInstanceOf(DetectionError)
      expect(failedState.lastError).toBe('No text was detected in the image.')
      expect(failedState.detections).toHaveLength(0)
      expect(nextState.lastError).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('ignores clipboard images while clipboard listening is off', () =>
    Effect.gen(function* () {
      const { detections, latest } = yield* setup({ settings: { listenToClipboard: false } })

      expect(yield* detections.detectClipboard(image())).toEqual(Option.none())
      expect((yield* latest).detections).toHaveLength(0)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('returns clipboard detections so the Translation Overlay can show them', () =>
    Effect.gen(function* () {
      const { detections } = yield* setup()

      const detection = yield* detections.detectClipboard(image())

      expect(Option.map(detection, (found) => found.originalText)).toEqual(
        Option.some('こんにちは'),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('keeps the newest 100 detections and removes single ones', () =>
    Effect.gen(function* () {
      const { detections, latest } = yield* setup()

      yield* Effect.forEach(
        Array.from({ length: 102 }),
        () => detections.detect(image(), 'image'),
        { discard: true },
      )

      const full = yield* latest
      const newest = full.detections[0]?.id ?? ''

      yield* detections.remove(newest)

      const afterRemove = yield* latest

      expect(full.detections).toHaveLength(100)
      expect(afterRemove.detections.map((item) => item.id)).not.toContain(newest)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
