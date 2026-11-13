import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const whatsNewKeys = ['whats-new']

export const whatsNewAtom = Core.query('getWhatsNew', undefined, {
  reactivityKeys: whatsNewKeys,
})

export const markWhatsNewSeenAtom = Core.mutation('markWhatsNewSeen')

export const markAreaSeenAtom = Core.mutation('markAreaSeen')

export const installUpdateAtom = Core.mutation('installUpdate')

export const updateStatusAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchUpdate', undefined)
    }),
  ),
)
