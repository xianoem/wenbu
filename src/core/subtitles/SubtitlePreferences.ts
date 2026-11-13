import { Context, Effect, Layer, Option, Ref } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { WindowBounds } from '#contract/CoreMessages'
import {
  ComputerAudio,
  defaultSpeechModel,
  SubtitleSettings,
  SubtitlesError,
} from '#contract/Subtitles'
import { PresetReferences } from '../llm/PresetReferences'
import * as SettingsStore from '../platform/SettingsStore'

const keys = { settings: 'live-subtitles', bounds: 'live-subtitles-bounds' } as const

export const defaultSubtitleSettings: SubtitleSettings = {
  source: ComputerAudio.make({}),
  targetLanguage: 'English',
  presetId: '',
  model: defaultSpeechModel,
  device: 'auto',
  sensitivity: 'normal',
  pauseMs: 400,
  waitForSentences: true,
  contextLines: 8,
  overlayMode: 'both',
  textSize: 1,
  hideFromCapture: false,
}

export const pauseRange = { min: 250, max: 1000 } as const

export const contextLineRange = { min: 0, max: 30 } as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)))

const sanitize = (settings: SubtitleSettings) => {
  const targetLanguage = settings.targetLanguage.trim()

  if (targetLanguage === '') {
    return Effect.fail(
      new SubtitlesError({ reason: 'invalid', message: 'Enter the language to translate into.' }),
    )
  }

  const spokenLanguage = settings.spokenLanguage?.trim() ?? ''
  const { spokenLanguage: _spoken, ...rest } = settings

  return Effect.succeed<SubtitleSettings>({
    ...rest,
    ...(spokenLanguage === '' ? {} : { spokenLanguage }),
    targetLanguage,
    presetId: settings.presetId.trim(),
    pauseMs: clamp(settings.pauseMs, pauseRange.min, pauseRange.max),
    contextLines: clamp(settings.contextLines, contextLineRange.min, contextLineRange.max),
    textSize: clamp(settings.textSize, 0, 3),
  })
}

export class SubtitlePreferences extends Context.Service<
  SubtitlePreferences,
  {
    readonly settings: Effect.Effect<SubtitleSettings>
    readonly save: (settings: SubtitleSettings) => Effect.Effect<SubtitleSettings, SubtitlesError>
    readonly bounds: Effect.Effect<Option.Option<WindowBounds>>
    readonly saveBounds: (bounds: WindowBounds) => Effect.Effect<void>
  }
>()('wenbu/core/subtitles/SubtitlePreferences') {
  static readonly layer = Layer.effect(
    SubtitlePreferences,
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore
      const store = SettingsStore.make(kv, SubtitleSettings, defaultSubtitleSettings)
      // oxlint-disable-next-line wenbu/no-schema-store -- bounds are whole or useless; a reset only re-centres the window.
      const boundsStore = KeyValueStore.toSchemaStore(kv, WindowBounds)

      const current = yield* Ref.make(
        yield* store.get(keys.settings).pipe(Effect.orElseSucceed(() => defaultSubtitleSettings)),
      )

      const save = Effect.fn('SubtitlePreferences.save')(function* (settings: SubtitleSettings) {
        const clean = yield* sanitize(settings)

        yield* Ref.set(current, clean)
        yield* Effect.orDie(store.set(keys.settings, clean))

        return clean
      })

      yield* (yield* PresetReferences).register({
        area: 'Live Subtitles',
        uses: (presetIds) =>
          Effect.map(Ref.get(current), (settings) => presetIds.has(settings.presetId)),
        clear: (presetIds) =>
          Effect.flatMap(Ref.get(current), (settings) =>
            presetIds.has(settings.presetId)
              ? Effect.orDie(save({ ...settings, presetId: '' }))
              : Effect.void,
          ),
      })

      return SubtitlePreferences.of({
        settings: Ref.get(current),
        save,
        bounds: boundsStore.get(keys.bounds).pipe(Effect.orElseSucceed(() => Option.none())),
        saveBounds: (bounds) => Effect.ignore(boundsStore.set(keys.bounds, bounds)),
      })
    }),
  )
}
