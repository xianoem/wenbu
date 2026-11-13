import { Effect, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { Core, concurrentMutation, type PayloadOf } from '#lib/rpc'

export const mangaEditorStateAtom = Atom.family((folder: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core
        const opened = yield* client('openMangaEditor', { folder })

        return client('watchMangaEditor', { folder: opened })
      }),
    ),
  ),
)

const SEPARATOR = '\u0000'

export type ImageKind = 'original' | 'result' | 'cleaned' | 'brush'

/** Atom families compare keys by value, so the image request travels as one string. */
export const imageKey = (folder: string, page: string, kind: ImageKind, version: number) =>
  [folder, page, kind, String(version)].join(SEPARATOR)

export const settingsKeys = (folder: string) => [`manga-editor-settings:${folder}`]

export const mangaEditorSettingsAtom = Atom.family((folder: string) =>
  Core.query('getMangaEditorSettings', { folder }, { reactivityKeys: settingsKeys(folder) }),
)

export const saveMangaEditorSettingsAtom = Core.mutation('saveMangaEditorSettings')

export const closeMangaEditorAtom = concurrentMutation(
  (client, payload: PayloadOf<'closeMangaEditor'>) => client('closeMangaEditor', payload),
)

export const updateMangaEditorLineAtom = concurrentMutation(
  (client, payload: PayloadOf<'updateMangaEditorLine'>) => client('updateMangaEditorLine', payload),
)

export const letterMangaEditorBlockAtom = concurrentMutation(
  (client, payload: PayloadOf<'letterMangaEditorBlock'>) =>
    client('letterMangaEditorBlock', payload),
)

export const removeMangaEditorBlockAtom = concurrentMutation(
  (client, payload: PayloadOf<'removeMangaEditorBlock'>) =>
    client('removeMangaEditorBlock', payload),
)

export const orderMangaEditorLinesAtom = concurrentMutation(
  (client, payload: PayloadOf<'orderMangaEditorLines'>) => client('orderMangaEditorLines', payload),
)

export const mergeMangaEditorLinesAtom = concurrentMutation(
  (client, payload: PayloadOf<'mergeMangaEditorLines'>) => client('mergeMangaEditorLines', payload),
)

export const splitMangaEditorLineAtom = concurrentMutation(
  (client, payload: PayloadOf<'splitMangaEditorLine'>) => client('splitMangaEditorLine', payload),
)

export const undoMangaEditorAtom = concurrentMutation(
  (client, payload: PayloadOf<'undoMangaEditor'>) => client('undoMangaEditor', payload),
)

export const redoMangaEditorAtom = concurrentMutation(
  (client, payload: PayloadOf<'redoMangaEditor'>) => client('redoMangaEditor', payload),
)
