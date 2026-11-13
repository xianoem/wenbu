import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const detectionSettingsKeys = ['detection-settings']

export const detectionsAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchDetections', undefined)
    }),
  ),
)

export const detectionSettingsAtom = Core.query('getDetectionSettings', undefined, {
  reactivityKeys: detectionSettingsKeys,
})

export const saveDetectionSettingsAtom = Core.mutation('saveDetectionSettings')

export const detectImageAtom = Core.mutation('detectImage')

export const removeDetectionAtom = Core.mutation('removeDetection')
