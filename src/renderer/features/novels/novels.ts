import { useAtomSet } from '@effect/atom-react'
import { useCallback } from 'react'
import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import { Effect, Schema, Stream } from 'effect'
import { Atom, Reactivity } from 'effect/reactivity'
import type { GlossaryEdit, NovelSummary, SearchUpdate, TermKind } from '#contract/Novels'
import { Core } from '#lib/rpc'

export const novelsKeys = ['novels']

export const novelSettingsKeys = ['novel-settings']

export const novelSitesKeys = ['novel-sites']

export const shelfAtom = Core.query('novelShelf', undefined, { reactivityKeys: novelsKeys })

export const novelDetailsAtom = Atom.family((novelId: string) =>
  Core.query('novelDetails', { novelId }, { reactivityKeys: novelsKeys }),
)

export const chapterPageAtom = Atom.family((key: `${string}|${number}|${'new' | 'old'}`) => {
  const [novelId = '', page = '0', order = 'new'] = key.split('|')

  return Core.query(
    'novelChapters',
    { novelId, page: Number(page), pageSize: 10, newestFirst: order === 'new' },
    { reactivityKeys: novelsKeys },
  )
})

export const allChaptersAtom = Atom.family((novelId: string) =>
  Core.query(
    'novelChapters',
    { novelId, page: 0, pageSize: 100_000, newestFirst: false },
    { reactivityKeys: novelsKeys },
  ),
)

export const novelTermsAtom = Atom.family((novelId: string) =>
  Core.query('novelTerms', { novelId }, { reactivityKeys: novelsKeys }),
)

export const chapterViewAtom = Atom.family((key: `${string}|${number}|${number}`) => {
  const [novelId = '', chapter = '0'] = key.split('|')
  const payload = { novelId, number: Number(chapter) }

  return Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core
        const opened = yield* client('openChapter', payload)

        return Stream.concat(Stream.make(opened), client('watchChapter', payload))
      }),
    ),
  )
})

export const novelSettingsAtom = Core.query('novelSettings', undefined, {
  reactivityKeys: novelSettingsKeys,
})

export const saveNovelSettingsAtom = Core.mutation('saveNovelSettings')

export const novelSitesAtom = Core.query('novelSites', undefined, {
  reactivityKeys: novelSitesKeys,
})

export const searchAtom = Atom.family((query: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('searchNovels', { query }).pipe(
          Stream.scan(
            (): ReadonlyArray<SearchUpdate> => [],
            (all, update) => [...all, update],
          ),
        )
      }),
    ),
  ),
)

export const addNovelFromUrlAtom = Core.mutation('addNovelFromUrl')

export const createNovelAtom = Core.mutation('createNovel')

export const pasteChaptersAtom = Core.mutation('pasteChapters')

export const previewPasteAtom = Core.mutation('previewPaste')

export const removeNovelAtom = Core.mutation('removeNovel')

export const refreshNovelAtom = Core.mutation('refreshNovel')

export const retranslateChapterAtom = Core.mutation('retranslateChapter')

export const saveReadingAtom = Core.mutation('saveNovelReading')

export const editGlossaryAtom = Core.mutation('editGlossary')

export function useGlossaryEdit() {
  const edit = useAtomSet(editGlossaryAtom, { mode: 'promiseExit' })

  return useCallback(
    (change: GlossaryEdit) =>
      edit({ payload: { edit: change }, reactivityKeys: [...glossariesKeys, ...novelsKeys] }),
    [edit],
  )
}

export const glossariesKeys = ['glossaries']

export const glossaryShelfAtom = Core.query('glossaryShelf', undefined, {
  reactivityKeys: [...glossariesKeys, ...novelsKeys],
})

export const glossaryPageAtom = Atom.family((key: `${'novel' | 'general'}:${string}`) => {
  const [kind = 'novel', ...id] = key.split(':')

  return Core.query(
    'glossaryPage',
    { ref: { kind: kind === 'general' ? 'general' : 'novel', id: id.join(':') } },
    { reactivityKeys: [...glossariesKeys, ...novelsKeys] },
  )
})

export const findTermsAtom = Atom.family((query: string) =>
  Core.query('findTerms', { query }, { reactivityKeys: [...glossariesKeys, ...novelsKeys] }),
)

export const exportGlossaryAtom = Core.mutation('exportGlossary')

export const scanTermsAtom = Atom.family((key: `${string}|${number}|${number}`) => {
  const [novelId = '', chapters = '50'] = key.split('|')

  return Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('scanTerms', { novelId, chapters: Number(chapters) }).pipe(
          Stream.tap(() => Reactivity.invalidate([...glossariesKeys, ...novelsKeys])),
        )
      }),
    ),
  )
})

export const insightKeys = ['novel-insight']

export const novelInsightAtom = Atom.family((novelId: string) =>
  Core.query('novelInsight', { novelId }, { reactivityKeys: [...insightKeys, ...novelsKeys] }),
)

export const digestAtom = Atom.family((key: `${string}|${number}|${number}`) => {
  const [novelId = '', upTo = '0'] = key.split('|')

  return Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('digestNovel', { novelId, upTo: Number(upTo) }).pipe(
          Stream.tap(() => Reactivity.invalidate(insightKeys)),
        )
      }),
    ),
  )
})

export const explainTextAtom = Core.mutation('explainText')

export const detectSiteAtom = Core.mutation('detectSite')

export const editSiteAtom = Core.mutation('editSite')

export const kindMeta: Record<
  TermKind,
  { readonly label: string; readonly plural: string; readonly color: string }
> = {
  character: { label: 'Character', plural: 'Characters', color: 'oklch(0.75 0.12 250)' },
  place: { label: 'Place', plural: 'Places', color: 'oklch(0.78 0.12 150)' },
  sect: { label: 'Sect', plural: 'Sects', color: 'oklch(0.8 0.12 75)' },
  technique: { label: 'Technique', plural: 'Techniques', color: 'oklch(0.72 0.15 25)' },
  item: { label: 'Item', plural: 'Items', color: 'oklch(0.75 0.1 300)' },
  concept: { label: 'Concept', plural: 'Concepts', color: 'oklch(0.75 0.08 200)' },
  other: { label: 'Other', plural: 'Other', color: 'oklch(0.7 0.01 285)' },
}

export const termKinds: ReadonlyArray<TermKind> = [
  'character',
  'place',
  'sect',
  'technique',
  'item',
  'concept',
  'other',
]

export const downloadText = (name: string, text: string, type = 'text/csv') => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')

  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export const tints = ['amber', 'violet', 'teal', 'slate'] as const

export type Tint = (typeof tints)[number]

export const tintOf = (id: string): Tint => {
  let hash = 0

  for (const character of id) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  }

  return tints[hash % tints.length] ?? 'slate'
}

export const shownTitle = (novel: Pick<NovelSummary, 'title' | 'titleTranslated'>) =>
  novel.titleTranslated ?? novel.title

export const looksLikeLink = (text: string) => /^https?:\/\//i.test(text.trim())

export const ReaderFont = Schema.Literals(['serif', 'sans'])

export const ReaderWidth = Schema.Literals(['narrow', 'comfortable', 'wide'])

export const ReaderTheme = Schema.Literals(['dark', 'black', 'sepia'])

export const ReaderDisplay = Schema.Struct({
  translation: Schema.Boolean,
  original: Schema.Boolean,
  font: ReaderFont,
  size: Schema.Number,
  lineHeight: Schema.Number,
  width: ReaderWidth,
  theme: ReaderTheme,
})

export type ReaderDisplay = typeof ReaderDisplay.Type

const localStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const readerDisplayAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'novel-reader-display',
  schema: ReaderDisplay,
  defaultValue: (): ReaderDisplay => ({
    translation: true,
    original: true,
    font: 'serif',
    size: 18,
    lineHeight: 1.7,
    width: 'comfortable',
    theme: 'dark',
  }),
})
