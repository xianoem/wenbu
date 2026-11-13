import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Schema, Struct } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  defaultOverlayAppearance,
  defaultOverlaySettings,
  OverlayError,
} from '#contract/TranslationOverlay'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { OverlayPreferences } from './OverlayPreferences'

const StorageLayer = PresetReferences.layer.pipe(
  Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provideMerge(NodeServices.layer),
)

const TestLayer = OverlayPreferences.layer.pipe(Layer.provideMerge(StorageLayer))

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

describe('OverlayPreferences', () => {
  it.effect('starts with the defaults', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences

      expect(yield* preferences.settings).toEqual(defaultOverlaySettings)
      expect(yield* preferences.appearance).toEqual(defaultOverlayAppearance)
      expect(yield* preferences.bounds).toEqual(Option.none())
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('cleans settings before saving them', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences

      const saved = yield* preferences.saveSettings({
        ...defaultOverlaySettings,
        presetId: ' preset-1 ',
        targetLanguage: ' German ',
        timeoutSeconds: 0,
        retryRounds: 0,
        context: { mode: 'recent', lines: 200, maxTokens: -5, summaryEvery: 0 },
      })

      expect(saved).toEqual({
        ...defaultOverlaySettings,
        presetId: 'preset-1',
        targetLanguage: 'German',
        timeoutSeconds: 1,
        retryRounds: 1,
        context: { mode: 'recent', lines: 50, maxTokens: 0, summaryEvery: 1 },
      })

      expect(yield* preferences.settings).toEqual(saved)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('rejects an empty target language', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences

      const error = yield* Effect.flip(
        preferences.saveSettings({ ...defaultOverlaySettings, targetLanguage: '  ' }),
      )

      expect(error).toBeInstanceOf(OverlayError)
      expect(error.field).toBe('targetLanguage')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('keeps the appearance within its ranges', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences

      const saved = yield* preferences.saveAppearance({
        ...defaultOverlayAppearance,
        fontSize: 200,
        opacity: 0,
      })

      expect(saved.fontSize).toBe(36)
      expect(saved.opacity).toBe(0.25)
      expect(yield* preferences.appearance).toEqual(saved)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('remembers the window bounds', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences
      const bounds = { x: 10, y: 20, width: 640, height: 180 }

      yield* preferences.saveBounds(bounds)

      expect(yield* preferences.bounds).toEqual(Option.some(bounds))
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('keeps saved preferences when a field was added later', () =>
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore

      const olderSettings = Struct.omit(
        { ...defaultOverlaySettings, presetId: 'preset-1', targetLanguage: 'German' },
        ['onNewLine'],
      )

      const olderAppearance = Struct.omit({ ...defaultOverlayAppearance, fontSize: 30 }, ['locked'])

      yield* kv.set('translation-overlay', yield* encodeJson(olderSettings))
      yield* kv.set('translation-overlay-appearance', yield* encodeJson(olderAppearance))

      const preferences = Context.get(
        yield* Layer.build(OverlayPreferences.layer),
        OverlayPreferences,
      )

      expect(yield* preferences.settings).toEqual({
        ...olderSettings,
        onNewLine: defaultOverlaySettings.onNewLine,
      })

      expect(yield* preferences.appearance).toEqual({
        ...olderAppearance,
        locked: defaultOverlayAppearance.locked,
      })
    }).pipe(Effect.scoped, Effect.provide(StorageLayer)),
  )

  it.effect('stops using a preset once it is deleted', () =>
    Effect.gen(function* () {
      const preferences = yield* OverlayPreferences
      const references = yield* PresetReferences

      yield* preferences.saveSettings({ ...defaultOverlaySettings, presetId: 'preset-1' })

      expect(yield* references.areasUsing(new Set(['preset-1']))).toEqual(['Translation overlay'])

      yield* references.clear(new Set(['preset-1']))

      expect((yield* preferences.settings).presetId).toBe('')
    }).pipe(Effect.provide(TestLayer)),
  )
})
