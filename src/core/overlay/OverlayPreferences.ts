import { Context, Effect, Layer, Option, Ref } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { WindowBounds } from '#contract/CoreMessages'
import {
  defaultOverlayAppearance,
  defaultOverlaySettings,
  OverlayAppearance,
  OverlayError,
  OverlaySettings,
  overlayFontSizes,
  overlayOpacity,
} from '#contract/TranslationOverlay'
import { PresetReferences } from '../llm/PresetReferences'
import * as SettingsStore from '../platform/SettingsStore'

const keys = {
  settings: 'translation-overlay',
  appearance: 'translation-overlay-appearance',
  bounds: 'translation-overlay-bounds',
} as const

export const contextLineRange = { min: 1, max: 50 } as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const atLeast = (min: number, value: number) => Math.max(min, Math.round(value))

const sanitizeSettings = (settings: OverlaySettings) => {
  const sourceLanguage = settings.sourceLanguage.trim()
  const targetLanguage = settings.targetLanguage.trim()

  if (sourceLanguage === '') {
    return Effect.fail(
      new OverlayError({
        reason: 'invalid',
        message: 'Enter the language the game is in.',
        field: 'sourceLanguage',
      }),
    )
  }

  if (targetLanguage === '') {
    return Effect.fail(
      new OverlayError({
        reason: 'invalid',
        message: 'Enter the language to translate into.',
        field: 'targetLanguage',
      }),
    )
  }

  return Effect.succeed<OverlaySettings>({
    ...settings,
    presetId: settings.presetId.trim(),
    sourceLanguage,
    targetLanguage,
    timeoutSeconds: atLeast(1, settings.timeoutSeconds),
    retryRounds: atLeast(1, settings.retryRounds),
    context: {
      mode: settings.context.mode,
      lines: clamp(Math.round(settings.context.lines), contextLineRange.min, contextLineRange.max),
      maxTokens: atLeast(0, settings.context.maxTokens),
      summaryEvery: atLeast(1, settings.context.summaryEvery),
    },
  })
}

const sanitizeAppearance = (appearance: OverlayAppearance): OverlayAppearance => ({
  ...appearance,
  fontSize: clamp(Math.round(appearance.fontSize), overlayFontSizes.min, overlayFontSizes.max),
  opacity: clamp(appearance.opacity, overlayOpacity.min, overlayOpacity.max),
})

export class OverlayPreferences extends Context.Service<
  OverlayPreferences,
  {
    readonly settings: Effect.Effect<OverlaySettings>
    readonly saveSettings: (
      settings: OverlaySettings,
    ) => Effect.Effect<OverlaySettings, OverlayError>
    readonly appearance: Effect.Effect<OverlayAppearance>
    readonly saveAppearance: (appearance: OverlayAppearance) => Effect.Effect<OverlayAppearance>
    readonly bounds: Effect.Effect<Option.Option<WindowBounds>>
    readonly saveBounds: (bounds: WindowBounds) => Effect.Effect<void>
  }
>()('wenbu/core/overlay/OverlayPreferences') {
  static readonly layer = Layer.effect(
    OverlayPreferences,
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore
      const settingsStore = SettingsStore.make(kv, OverlaySettings, defaultOverlaySettings)
      const appearanceStore = SettingsStore.make(kv, OverlayAppearance, defaultOverlayAppearance)
      // oxlint-disable-next-line wenbu/no-schema-store -- bounds are whole or useless; a reset only re-centres the window.
      const boundsStore = KeyValueStore.toSchemaStore(kv, WindowBounds)

      const settingsRef = yield* Ref.make(
        yield* settingsStore
          .get(keys.settings)
          .pipe(Effect.orElseSucceed(() => defaultOverlaySettings)),
      )

      const appearanceRef = yield* Ref.make(
        yield* appearanceStore
          .get(keys.appearance)
          .pipe(Effect.orElseSucceed(() => defaultOverlayAppearance)),
      )

      const saveSettings = Effect.fn('OverlayPreferences.saveSettings')(function* (
        settings: OverlaySettings,
      ) {
        const clean = yield* sanitizeSettings(settings)

        yield* Ref.set(settingsRef, clean)
        yield* Effect.orDie(settingsStore.set(keys.settings, clean))

        return clean
      })

      const saveAppearance = Effect.fn('OverlayPreferences.saveAppearance')(function* (
        appearance: OverlayAppearance,
      ) {
        const clean = sanitizeAppearance(appearance)

        yield* Ref.set(appearanceRef, clean)
        yield* Effect.orDie(appearanceStore.set(keys.appearance, clean))

        return clean
      })

      yield* (yield* PresetReferences).register({
        area: 'Translation overlay',
        uses: (presetIds) =>
          Effect.map(Ref.get(settingsRef), (settings) => presetIds.has(settings.presetId)),
        clear: (presetIds) =>
          Effect.flatMap(Ref.get(settingsRef), (settings) =>
            presetIds.has(settings.presetId)
              ? Effect.orDie(saveSettings({ ...settings, presetId: '' }))
              : Effect.void,
          ),
      })

      return OverlayPreferences.of({
        settings: Ref.get(settingsRef),
        saveSettings,
        appearance: Ref.get(appearanceRef),
        saveAppearance,
        bounds: boundsStore.get(keys.bounds).pipe(Effect.orElseSucceed(() => Option.none())),
        saveBounds: (bounds) => Effect.ignore(boundsStore.set(keys.bounds, bounds)),
      })
    }),
  )
}
