import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const mangaSettingsKeys = ['manga-settings']

export const mangaSettingsAtom = Core.query('getMangaSettings', undefined, {
  reactivityKeys: mangaSettingsKeys,
})

export const saveMangaSettingsAtom = Core.mutation('saveMangaSettings')

export const checkMangaFolderAtom = Core.mutation('checkMangaFolder')

export const startMangaRunAtom = Core.mutation('startMangaRun')

export const cancelMangaRunAtom = Core.mutation('cancelMangaRun')

export const removeMangaRunAtom = Core.mutation('removeMangaRun')

export const mangaRunsAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchMangaRuns', undefined)
    }),
  ),
)

export const mangaRuntimeAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchMangaRuntime', undefined)
    }),
  ),
)
