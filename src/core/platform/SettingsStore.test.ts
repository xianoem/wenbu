import { describe, expect, it } from '@effect/vitest'
import { Effect, Logger, References, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import * as SettingsStore from './SettingsStore'

const Settings = Schema.Struct({
  language: Schema.String,
  retries: Schema.Int,
  context: Schema.Struct({ lines: Schema.Int }),
})

const defaults: typeof Settings.Type = { language: 'English', retries: 3, context: { lines: 10 } }

const saveRaw = (kv: KeyValueStore.KeyValueStore, value: object) =>
  Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value), (json) =>
    kv.set('settings', json),
  )

const withStore = <A, E>(
  use: (
    kv: KeyValueStore.KeyValueStore,
    settings: ReturnType<typeof SettingsStore.make<typeof Settings.fields>>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore

    return yield* use(kv, SettingsStore.make(kv, Settings, defaults))
  }).pipe(Effect.provide(KeyValueStore.layerMemory))

describe('SettingsStore', () => {
  it.effect('returns the defaults when nothing is saved', () =>
    withStore((_, settings) =>
      Effect.gen(function* () {
        expect(yield* settings.get('settings')).toEqual(defaults)
      }),
    ),
  )

  it.effect('reads back saved settings', () =>
    withStore((_, settings) =>
      Effect.gen(function* () {
        const saved = { language: 'German', retries: 5, context: { lines: 20 } }

        yield* settings.set('settings', saved)

        expect(yield* settings.get('settings')).toEqual(saved)
      }),
    ),
  )

  it.effect('keeps saved values when a field was added later', () =>
    withStore((kv, settings) =>
      Effect.gen(function* () {
        yield* saveRaw(kv, { language: 'German', context: { lines: 20 } })

        expect(yield* settings.get('settings')).toEqual({
          language: 'German',
          retries: 3,
          context: { lines: 20 },
        })
      }),
    ),
  )

  it.effect('resets only a field that no longer decodes', () =>
    withStore((kv, settings) =>
      Effect.gen(function* () {
        yield* saveRaw(kv, { language: 'German', retries: 'many', context: { rows: 20 } })

        expect(yield* settings.get('settings')).toEqual({ ...defaults, language: 'German' })
      }),
    ),
  )

  it.effect('returns the defaults when the saved value is not JSON', () =>
    withStore((kv, settings) =>
      Effect.gen(function* () {
        yield* kv.set('settings', '{not json')

        expect(yield* settings.get('settings')).toEqual(defaults)
      }),
    ),
  )

  it.effect('warns when it resets unreadable settings to the defaults', () =>
    withStore((kv, settings) =>
      Effect.gen(function* () {
        const warnings: Array<unknown> = []

        const logger = Logger.make(({ logLevel, message, fiber }) => {
          warnings.push([
            logLevel,
            Array.isArray(message) ? message[0] : message,
            fiber.getRef(References.CurrentLogAnnotations)['key'],
          ])
        })

        yield* kv.set('settings', '{not json')
        yield* settings.get('settings').pipe(Effect.provide(Logger.layer([logger])))

        expect(warnings).toEqual([
          ['Warn', 'Stored settings were unreadable; using defaults', 'settings'],
        ])
      }),
    ),
  )
})
