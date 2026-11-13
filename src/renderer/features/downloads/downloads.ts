import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const downloadSettingsKeys = ['download-settings']

export const downloadSettingsAtom = Core.query('getDownloadSettings', undefined, {
  reactivityKeys: downloadSettingsKeys,
})

export const saveDownloadSettingsAtom = Core.mutation('saveDownloadSettings')

export const downloadsAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchDownloads', undefined)
    }),
  ),
)

export const startDownloadAtom = Core.mutation('startDownload')

export const resumeDownloadAtom = Core.mutation('resumeDownload')

export const cancelDownloadAtom = Core.mutation('cancelDownload')

export const removeDownloadAtom = Core.mutation('removeDownload')

export const answerDownloadAtom = Core.mutation('answerDownload')

export const signInToSourceAtom = Core.mutation('signInToSource')

export const signOutOfSourceAtom = Core.mutation('signOutOfSource')

export const checkSourceAtom = Core.mutation('checkSource')
