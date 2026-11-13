import { Effect, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { Core } from '#lib/rpc'

export const subtitleSettingsKeys = ['subtitle-settings']

export const subtitlesAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchSubtitles', undefined)
    }),
  ),
)

export const subtitleBacklogAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchSubtitleBacklog', undefined)
    }),
  ),
)

export const audioLevelAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchAudioLevel', undefined)
    }),
  ),
)

export const audioSourcesAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchAudioSources', undefined)
    }),
  ),
)

export const subtitleSettingsAtom = Core.query('getSubtitleSettings', undefined, {
  reactivityKeys: subtitleSettingsKeys,
})

export const subtitlesPopoverOpenAtom = Atom.make(false)

export const saveSubtitleSettingsAtom = Core.mutation('saveSubtitleSettings')

export const startSubtitlesAtom = Core.mutation('startSubtitles')

export const stopSubtitlesAtom = Core.mutation('stopSubtitles')

export const setSubtitlesPausedAtom = Core.mutation('setSubtitlesPaused')

export const setSubtitleOverlayVisibleAtom = Core.mutation('setSubtitleOverlayVisible')

export const setSubtitleOverlayLockedAtom = Core.mutation('setSubtitleOverlayLocked')

export const setSubtitleTextSizeAtom = Core.mutation('setSubtitleTextSize')

export const retrySubtitleTranslationAtom = Core.mutation('retrySubtitleTranslation')

export const clearSubtitleBacklogAtom = Core.mutation('clearSubtitleBacklog')
