import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import { Schema } from 'effect'
import { Atom } from 'effect/reactivity'
import { GallerySort, GalleryVersion } from '#contract/Galleries'

export const Screen = Schema.Literals([
  'dashboard',
  'library',
  'novels',
  'galleries',
  'glossaries',
  'manga',
  'plugins',
  'settings',
  'logs',
])

export type Screen = typeof Screen.Type

export const SettingsPage = Schema.Literals([
  'models',
  'translation',
  'overlay',
  'subtitles',
  'manga',
  'detections',
  'downloads',
  'novels',
])

export type SettingsPage = typeof SettingsPage.Type

const sessionStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerSessionStorage)

export const screenAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'screen',
  schema: Screen,
  defaultValue: (): Screen => 'dashboard',
})

export const returnScreenAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'return-screen',
  schema: Screen,
  defaultValue: (): Screen => 'dashboard',
})

export const settingsPageAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'settings-page',
  schema: SettingsPage,
  defaultValue: (): SettingsPage => 'models',
})

export const gameIdAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'game-id',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const openWorkAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'open-work',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const detailsReviewAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'details-review',
  schema: Schema.Boolean,
  defaultValue: () => false,
})

export const inGameTextReviewAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'in-game-text-review',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const translationReviewAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'translation-review',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const sourceChangesAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'source-changes',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const openGlossaryAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'open-glossary',
  schema: Schema.UndefinedOr(
    Schema.TemplateLiteral([Schema.Literals(['novel', 'general']), ':', Schema.String]),
  ),
  defaultValue: (): `${'novel' | 'general'}:${string}` | undefined => undefined,
})

export const openNovelAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'open-novel',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const NovelReaderOpening = Schema.Struct({
  novelId: Schema.String,
  chapter: Schema.Int,
})

export type NovelReaderOpening = typeof NovelReaderOpening.Type

export const novelReaderAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'novel-reader',
  schema: Schema.UndefinedOr(NovelReaderOpening),
  defaultValue: (): NovelReaderOpening | undefined => undefined,
})

export const galleryFolderAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'gallery-folder',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const openGalleryAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'open-gallery',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})

export const ViewerOpening = Schema.Struct({
  folder: Schema.String,
  page: Schema.Int,
  version: GalleryVersion,
})

export type ViewerOpening = typeof ViewerOpening.Type

export const viewerAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'gallery-viewer',
  schema: Schema.UndefinedOr(ViewerOpening),
  defaultValue: (): ViewerOpening | undefined => undefined,
})

const localStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const sidebarOpenAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'sidebar-open',
  schema: Schema.Boolean,
  defaultValue: () => true,
})

export const gallerySortAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'gallery-sort',
  schema: GallerySort,
  defaultValue: (): GallerySort => 'added',
})

export const LibraryView = Schema.Literals(['list', 'grid'])

export type LibraryView = typeof LibraryView.Type

export const libraryViewAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'library-view',
  schema: LibraryView,
  defaultValue: (): LibraryView => 'list',
})

export const mangaEditorAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'manga-editor',
  schema: Schema.UndefinedOr(Schema.String),
  defaultValue: (): string | undefined => undefined,
})
