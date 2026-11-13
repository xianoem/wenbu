import { Effect, Stream } from 'effect'
import type { FactStatus } from '#contract/GameGuide'
import { Core } from '#lib/rpc'

export const guideSettingsKeys = ['game-guide-settings']

export const guideIndexAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchGuideIndex', undefined)
    }),
  ),
)

export const guideSettingsAtom = Core.query('getGuideSettings', undefined, {
  reactivityKeys: guideSettingsKeys,
})

export const saveGuideSettingsAtom = Core.mutation('saveGuideSettings')

export const clearGuideConversationAtom = Core.mutation('clearGuideConversation')

export const statusLabels: Record<FactStatus, string> = {
  open: 'Available',
  needs: 'Needs something',
  later: 'Later',
  passed: 'Done',
  unknown: '',
}

export const statusTones: Record<FactStatus, string> = {
  open: 'bg-success/10 text-success',
  needs: 'bg-warning/10 text-warning',
  later: 'bg-warning/10 text-warning',
  passed: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
}
