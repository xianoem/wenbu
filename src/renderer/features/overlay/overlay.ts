import { Effect, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { Core } from '#lib/rpc'

export const overlaySettingsKeys = ['overlay-settings']

export const overlayGameKeys = ['overlay-game']

export const overlayAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchOverlay', undefined)
    }),
  ),
)

export const overlayHooksAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchOverlayHooks', undefined)
    }),
  ),
)

export const overlaySettingsAtom = Core.query('getOverlaySettings', undefined, {
  reactivityKeys: overlaySettingsKeys,
})

export const overlayGameAtom = Atom.family((gameId: string) =>
  Core.query('getOverlayGame', { gameId }, { reactivityKeys: overlayGameKeys }),
)

export const overlayPopoverOpenAtom = Atom.make(false)

export const saveOverlaySettingsAtom = Core.mutation('saveOverlaySettings')

export const launchWithOverlayAtom = Core.mutation('launchWithOverlay')

export const findGameProcessesAtom = Core.mutation('findGameProcesses')

export const attachOverlayAtom = Core.mutation('attachOverlay')

export const attachOverlayElevatedAtom = Core.mutation('attachOverlayElevated')

export const retryAttachAtom = Core.mutation('retryAttach')

export const stopOverlayAtom = Core.mutation('stopOverlay')

export const selectHookAtom = Core.mutation('selectHook')

export const insertHookCodeAtom = Core.mutation('insertHookCode')

export const setOverlayVisibleAtom = Core.mutation('setOverlayVisible')

export const setOverlayPausedAtom = Core.mutation('setOverlayPaused')

export const saveOverlayAppearanceAtom = Core.mutation('saveOverlayAppearance')

export const retryTranslationAtom = Core.mutation('retryTranslation')

export const saveTextPipelineAtom = Core.mutation('saveTextPipeline')

export const resetTextPipelineAtom = Core.mutation('resetTextPipeline')

export const previewTextPipelineAtom = Core.mutation('previewTextPipeline')

export const resetStoryAtom = Core.mutation('resetStory')
