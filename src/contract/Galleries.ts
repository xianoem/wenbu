import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const GalleryVersion = Schema.Literals(['original', 'translated'])

export type GalleryVersion = typeof GalleryVersion.Type

export const ReadingDirection = Schema.Literals(['rtl', 'ltr'])

export type ReadingDirection = typeof ReadingDirection.Type

export const ViewerLayout = Schema.Literals(['single', 'spread', 'scroll'])

export type ViewerLayout = typeof ViewerLayout.Type

export const GalleryFilter = Schema.Literals(['all', 'translated', 'unread'])

export type GalleryFilter = typeof GalleryFilter.Type

export const GallerySort = Schema.Literals(['added', 'title', 'read'])

export type GallerySort = typeof GallerySort.Type

const readingFields = {
  page: Schema.Int,
  version: GalleryVersion,
  direction: ReadingDirection,
  shiftSpread: Schema.Boolean,
  layout: ViewerLayout,
}

export const ReadingProgress = Schema.Struct({ ...readingFields, readAt: Schema.String })

export type ReadingProgress = typeof ReadingProgress.Type

export const GalleryTile = Schema.Struct({
  kind: Schema.Literal('gallery'),
  folder: Schema.String,
  title: Schema.String,
  artists: Schema.Array(Schema.String),
  source: Schema.NullOr(Schema.String),
  originalPages: Schema.Int,
  translatedPages: Schema.Int,
  cover: Schema.NullOr(Schema.String),
  coverVersion: Schema.Number,
  addedAt: Schema.String,
  reading: Schema.NullOr(ReadingProgress),
})

export type GalleryTile = typeof GalleryTile.Type

export const FolderTile = Schema.Struct({
  kind: Schema.Literal('folder'),
  folder: Schema.String,
  title: Schema.String,
  galleries: Schema.Int,
  pages: Schema.Int,
  covers: Schema.Array(Schema.String),
  addedAt: Schema.String,
})

export type FolderTile = typeof FolderTile.Type

export const GalleryEntry = Schema.Union([GalleryTile, FolderTile])

export type GalleryEntry = typeof GalleryEntry.Type

export const FolderHeader = Schema.Struct({
  folder: Schema.String,
  title: Schema.String,
  parent: Schema.NullOr(Schema.String),
  galleries: Schema.Int,
  folders: Schema.Int,
  pages: Schema.Int,
})

export type FolderHeader = typeof FolderHeader.Type

export const GalleryCounts = Schema.Struct({
  all: Schema.Int,
  translated: Schema.Int,
  unread: Schema.Int,
})

export const EntryListing = Schema.Struct({
  header: Schema.NullOr(FolderHeader),
  entries: Schema.Array(GalleryEntry),
  counts: GalleryCounts,
  sources: Schema.Array(Schema.String),
})

export type EntryListing = typeof EntryListing.Type

export const ListEntries = Schema.Struct({
  folder: Schema.optional(Schema.String),
  filter: GalleryFilter,
  sort: GallerySort,
  search: Schema.String,
  source: Schema.optional(Schema.String),
})

export type ListEntries = typeof ListEntries.Type

export const GalleryPage = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  modifiedMs: Schema.Number,
})

export type GalleryPage = typeof GalleryPage.Type

export const OpenedGallery = Schema.Struct({
  folder: Schema.String,
  title: Schema.String,
  titleJapanese: Schema.NullOr(Schema.String),
  artists: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  source: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  cover: Schema.NullOr(Schema.String),
  addedAt: Schema.String,
  downloaded: Schema.Boolean,
  original: Schema.Array(GalleryPage),
  translated: Schema.Array(GalleryPage),
  reading: Schema.NullOr(ReadingProgress),
})

export type OpenedGallery = typeof OpenedGallery.Type

export const GalleryRoot = Schema.Struct({
  path: Schema.String,
  downloads: Schema.Boolean,
})

export type GalleryRoot = typeof GalleryRoot.Type

export const IndexChange = Schema.Struct({
  folders: Schema.Array(Schema.String),
})

export type IndexChange = typeof IndexChange.Type

export class GalleriesError extends Schema.TaggedError<GalleriesError>()('GalleriesError', {
  reason: Schema.Literals(['not-found', 'invalid', 'conflict']),
  message: Schema.String,
}) {}

const ByFolder = { folder: Schema.String }

const ByPath = { path: Schema.String }

export class GalleriesRpc extends RpcGroup.make(
  Rpc.make('listGalleryEntries', { payload: ListEntries, success: EntryListing }),
  Rpc.make('continueReadingGalleries', { success: Schema.Array(GalleryTile) }),
  Rpc.make('openGallery', { payload: ByFolder, success: OpenedGallery, error: GalleriesError }),
  Rpc.make('saveGalleryReading', {
    payload: { ...ByFolder, ...readingFields },
    error: GalleriesError,
  }),
  Rpc.make('galleryRoots', { success: Schema.Array(GalleryRoot) }),
  Rpc.make('addGalleryRoot', { payload: ByPath, success: GalleryRoot, error: GalleriesError }),
  Rpc.make('removeGalleryRoot', { payload: ByPath, error: GalleriesError }),
  Rpc.make('watchGalleryIndex', { success: IndexChange, stream: true }),
) {}
