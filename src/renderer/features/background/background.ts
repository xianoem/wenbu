import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const backgroundKeys = ['background-settings']

export const backgroundSettingsAtom = Core.query('getBackgroundSettings', undefined, {
  reactivityKeys: backgroundKeys,
})

export const saveBackgroundSettingsAtom = Core.mutation('saveBackgroundSettings')

export const activityAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchActivity', undefined)
    }),
  ),
)
