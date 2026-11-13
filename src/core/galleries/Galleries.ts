import {
  DateTime,
  Effect,
  FiberMap,
  FileSystem,
  Option,
  Path,
  PubSub,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { SqlClient, type Statement } from 'effect/sql'
import { defaultDownloadSettings, DownloadSettings } from '#contract/Downloads'
import {
  type EntryListing,
  GalleriesError,
  GalleriesRpc,
  type GalleryEntry,
  type GalleryRoot,
  type GallerySort,
  type GalleryTile,
  GalleryVersion,
  type IndexChange,
  type ListEntries,
  ReadingDirection,
  type ReadingProgress,
  ViewerLayout,
} from '#contract/Galleries'
import { defaultMangaSettings, MangaSettings } from '#contract/Manga'
import { mangaSettingsKey } from '../manga/Manga'
import * as SettingsStore from '../platform/SettingsStore'
import * as GalleryIndex from './GalleryIndex'
import { naturally } from './GalleryTree'
import { RootWatcher } from './RootWatcher'

const diskReads = 8

const settleTime = '500 millis'

const continueReadingShown = 3

const Names = Schema.fromJsonString(Schema.Array(Schema.String))

const TileRow = Schema.Struct({
  folder: Schema.String,
  parent: Schema.String,
  kind: Schema.Literals(['gallery', 'folder']),
  title: Schema.String,
  title_japanese: Schema.NullOr(Schema.String),
  artists: Names,
  tags: Names,
  source: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  original_pages: Schema.Int,
  translated_pages: Schema.Int,
  cover: Schema.NullOr(Schema.String),
  covers: Names,
  galleries: Schema.Int,
  pages: Schema.Int,
  added_at: Schema.String,
  downloaded: Schema.Int,
  pages_synced: Schema.Int,
  read_page: Schema.NullOr(Schema.Int),
  read_version: Schema.NullOr(GalleryVersion),
  read_direction: Schema.NullOr(ReadingDirection),
  read_shift: Schema.NullOr(Schema.Int),
  read_layout: Schema.NullOr(ViewerLayout),
  read_at: Schema.NullOr(Schema.String),
  cover_ms: Schema.NullOr(Schema.Number),
})

type TileRow = typeof TileRow.Type

const PageRow = Schema.Struct({
  version: GalleryVersion,
  name: Schema.String,
  file: Schema.String,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  modified_ms: Schema.Number,
})

const CountsRow = Schema.Struct({
  all: Schema.Int,
  translated: Schema.NullOr(Schema.Int),
  unread: Schema.NullOr(Schema.Int),
})

const decodeTiles = Schema.decodeUnknownEffect(Schema.Array(TileRow))

const decodePages = Schema.decodeUnknownEffect(Schema.Array(PageRow))

const decodeCounts = Schema.decodeUnknownEffect(Schema.Array(CountsRow))

const decodePaths = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ path: Schema.String })))

const decodeSources = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ source: Schema.String })),
)

const tileColumns = `
  e.folder, e.parent, e.kind, e.title, e.title_japanese, e.artists, e.tags, e.source, e.url,
  e.original_pages, e.translated_pages, e.cover, e.covers, e.galleries, e.pages, e.added_at,
  e.downloaded, e.pages_synced, r.page AS read_page, r.version AS read_version,
  r.direction AS read_direction, r.shift_spread AS read_shift, r.layout AS read_layout,
  r.read_at AS read_at,
  (SELECT p.modified_ms FROM gallery_pages p WHERE p.gallery = e.folder AND p.file = e.cover) AS cover_ms`

const readingOf = (row: TileRow): ReadingProgress | null => {
  if (
    row.read_page === null ||
    row.read_version === null ||
    row.read_direction === null ||
    row.read_layout === null ||
    row.read_at === null
  ) {
    return null
  }

  return {
    page: row.read_page,
    version: row.read_version,
    direction: row.read_direction,
    shiftSpread: row.read_shift === 1,
    layout: row.read_layout,
    readAt: row.read_at,
  }
}

const galleryTile = (row: TileRow): GalleryTile => ({
  kind: 'gallery',
  folder: row.folder,
  title: row.title,
  artists: row.artists,
  source: row.source,
  originalPages: row.original_pages,
  translatedPages: row.translated_pages,
  cover: row.cover,
  coverVersion: row.cover_ms ?? 0,
  addedAt: row.added_at,
  reading: readingOf(row),
})

const entryOf = (row: TileRow): GalleryEntry => {
  if (row.kind === 'gallery') {
    return galleryTile(row)
  }

  return {
    kind: 'folder',
    folder: row.folder,
    title: row.title,
    galleries: row.galleries,
    pages: row.pages,
    covers: row.covers,
    addedAt: row.added_at,
  }
}

const readAtOf = (entry: GalleryEntry) =>
  entry.kind === 'gallery' && entry.reading !== null ? entry.reading.readAt : ''

const newestFirst = (left: string, right: string) => right.localeCompare(left)

const orderOf = (sort: GallerySort) => (left: GalleryEntry, right: GalleryEntry) => {
  if (sort === 'title') {
    return naturally.compare(left.title, right.title)
  }

  if (sort === 'read') {
    return newestFirst(readAtOf(left), readAtOf(right)) || newestFirst(left.addedAt, right.addedAt)
  }

  return newestFirst(left.addedAt, right.addedAt)
}

const likePattern = (search: string) => {
  const escaped = search
    .trim()
    .toLowerCase()
    .replaceAll(/[\\%_]/g, (char) => `\\${char}`)

  return `%${escaped}%`
}

interface ByFolder {
  readonly folder: string
}

interface ByPath {
  readonly path: string
}

const notFound = (message: string) => new GalleriesError({ reason: 'not-found', message })

export const GalleriesRpcLive = GalleriesRpc.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const watcher = yield* RootWatcher
    const keyValues = yield* KeyValueStore.KeyValueStore
    const index = yield* GalleryIndex.make(yield* Semaphore.make(diskReads))

    const downloadSettings = SettingsStore.make(
      keyValues,
      DownloadSettings,
      defaultDownloadSettings,
    )

    const mangaSettings = SettingsStore.make(keyValues, MangaSettings, defaultMangaSettings)
    const changes = yield* PubSub.unbounded<IndexChange>()
    const watchers = yield* FiberMap.make<string>()
    const checking = yield* Semaphore.make(1)
    const watched = yield* Ref.make<ReadonlyArray<string>>([])
    const lastTranslationFolder = yield* Ref.make<Option.Option<string>>(Option.none())
    const now = Effect.map(DateTime.now, (time) => DateTime.formatIso(time))

    const addedRoots = sql`SELECT path FROM gallery_roots ORDER BY added_at, path`.pipe(
      Effect.flatMap((rows) => decodePaths(rows)),
      Effect.map((rows) => rows.map((row) => row.path)),
      Effect.orDie,
    )

    const normalized = (folder: string) => path.resolve(folder.trim())

    const downloadsFolder = Effect.map(Effect.orDie(downloadSettings.get('downloads')), (saved) =>
      saved.folder.trim() === '' ? Option.none<string>() : Option.some(normalized(saved.folder)),
    )

    const translationFolder = Effect.map(
      Effect.orDie(mangaSettings.get(mangaSettingsKey)),
      (saved) => saved.outputFolderName.trim(),
    )

    const currentRoots = Effect.gen(function* () {
      const downloads = yield* downloadsFolder
      const added = yield* addedRoots

      const others = added.filter((root) =>
        Option.match(downloads, {
          onNone: () => true,
          onSome: (folder) => !GalleryIndex.overlaps(folder, root, path.sep),
        }),
      )

      const first = Option.map(downloads, (folder): GalleryRoot => ({
        path: folder,
        downloads: true,
      }))

      return [
        ...Option.toArray(first),
        ...others.map((root): GalleryRoot => ({ path: root, downloads: false })),
      ]
    })

    const publish = (folders: ReadonlySet<string>) =>
      folders.size === 0 ? Effect.void : PubSub.publish(changes, { folders: [...folders] })

    const check = Effect.fn('Galleries.check')(function* (
      root: string,
      dirty: ReadonlySet<string>,
    ) {
      const folderName = yield* translationFolder
      const previousName = yield* Ref.getAndSet(lastTranslationFolder, Option.some(folderName))
      const reclassify = Option.isSome(previousName) && previousName.value !== folderName

      const result = yield* checking.withPermits(1)(
        index.scanRoot(root, folderName, dirty, reclassify),
      )

      yield* publish(result.changed)

      for (const gallery of result.unsynced) {
        yield* index.syncPages(gallery, folderName)
      }

      yield* publish(new Set(result.unsynced))
    })

    const touched = (root: string, batch: ReadonlyArray<Option.Option<string>>) => {
      if (batch.some((change) => Option.isNone(change))) {
        return new Set<string>()
      }

      return new Set(
        batch.flatMap((change) =>
          Option.toArray(change).flatMap((relative) => {
            const file = path.join(root, relative)

            return [file.toLowerCase(), path.dirname(file).toLowerCase()]
          }),
        ),
      )
    }

    const watch = (root: string) =>
      watcher.watch(root).pipe(
        Stream.groupedWithin(10_000, settleTime),
        Stream.runForEach((batch) => check(root, touched(root, batch))),
      )

    const reconcile = Effect.gen(function* () {
      const roots = (yield* currentRoots).map((root) => root.path)
      const before = yield* Ref.getAndSet(watched, roots)

      for (const root of before.filter((root) => !roots.includes(root))) {
        yield* FiberMap.remove(watchers, root)
        yield* checking.withPermits(1)(index.dropRoot(root))
        yield* publish(new Set([root]))
      }

      for (const root of roots) {
        if (!(yield* FiberMap.has(watchers, root))) {
          yield* FiberMap.run(watchers, root, Effect.andThen(check(root, new Set()), watch(root)))
        }
      }

      return roots
    })

    const tiles = (where: Statement.Fragment) =>
      sql`SELECT ${sql.literal(tileColumns)} FROM gallery_entries e LEFT JOIN gallery_reading r ON r.gallery = e.folder WHERE ${where}`.pipe(
        Effect.flatMap((rows) => decodeTiles(rows)),
        Effect.orDie,
      )

    const scopeOf = (folder: string | undefined, roots: ReadonlyArray<string>) => {
      if (folder === undefined || roots.includes(folder)) {
        return sql`e.root IN ${sql.in(folder === undefined ? roots : [folder])}`
      }

      const inside = `${folder}${path.sep}`

      return sql`substr(e.folder, 1, ${inside.length}) = ${inside}`
    }

    const filterOf = (filter: ListEntries['filter']) => {
      if (filter === 'translated') {
        return sql`e.translated_pages > 0`
      }

      return filter === 'unread' ? sql`r.gallery IS NULL` : sql`1 = 1`
    }

    const headerOf = Effect.fnUntraced(function* (folder: string, roots: ReadonlyArray<string>) {
      const [row] = yield* tiles(sql.and([sql`e.folder = ${folder}`, sql`e.kind = 'folder'`]))

      if (row === undefined) {
        return null
      }

      const children = yield* tiles(sql`e.parent = ${folder}`)

      return {
        folder: row.folder,
        title: row.title,
        parent: roots.includes(row.parent) ? null : row.parent,
        galleries: children.filter((child) => child.kind === 'gallery').length,
        folders: children.filter((child) => child.kind === 'folder').length,
        pages: row.pages,
      }
    })

    const countsOf = (where: Statement.Fragment) =>
      sql`
        SELECT count(*) AS "all",
          sum(e.translated_pages > 0) AS translated,
          sum(r.gallery IS NULL) AS unread
        FROM gallery_entries e LEFT JOIN gallery_reading r ON r.gallery = e.folder
        WHERE ${where}`.pipe(
        Effect.flatMap((rows) => decodeCounts(rows)),
        Effect.map(([row]) => ({
          all: row?.all ?? 0,
          translated: row?.translated ?? 0,
          unread: row?.unread ?? 0,
        })),
        Effect.orDie,
      )

    const sourcesOf = (where: Statement.Fragment) =>
      sql`
        SELECT DISTINCT e.source AS source FROM gallery_entries e
        WHERE ${where} AND e.source IS NOT NULL ORDER BY e.source`.pipe(
        Effect.flatMap((rows) => decodeSources(rows)),
        Effect.map((rows) => rows.map((row) => row.source)),
        Effect.orDie,
      )

    const emptyListing: EntryListing = {
      header: null,
      entries: [],
      counts: { all: 0, translated: 0, unread: 0 },
      sources: [],
    }

    const listEntries = Effect.fn('Galleries.listEntries')(function* (request: ListEntries) {
      const roots = yield* reconcile

      if (roots.length === 0) {
        return emptyListing
      }

      const folder = request.folder === undefined ? undefined : normalized(request.folder)
      const scope = sql.and([scopeOf(folder, roots), sql`e.kind = 'gallery'`])
      const searching = request.search.trim() !== ''
      const flat = searching || request.filter !== 'all' || request.source !== undefined

      const search = searching
        ? sql`e.search LIKE ${likePattern(request.search)} ESCAPE '\\'`
        : sql`1 = 1`

      const source = request.source === undefined ? sql`1 = 1` : sql`e.source = ${request.source}`

      const rows = yield* tiles(
        flat
          ? sql.and([scope, search, source, filterOf(request.filter)])
          : sql.and([
              sql`e.root IN ${sql.in(roots)}`,
              sql`e.parent IN ${sql.in(folder === undefined ? roots : [folder])}`,
            ]),
      )

      const header =
        folder === undefined || roots.includes(folder) ? null : yield* headerOf(folder, roots)

      return {
        header,
        entries: rows.map((row) => entryOf(row)).toSorted(orderOf(request.sort)),
        counts: yield* countsOf(sql.and([scope, search, source])),
        sources: yield* sourcesOf(scope),
      } satisfies EntryListing
    })

    const galleryRow = Effect.fnUntraced(function* (folder: string) {
      const roots = yield* reconcile

      const [row] = yield* tiles(
        sql.and([
          sql`e.folder = ${normalized(folder)}`,
          sql`e.kind = 'gallery'`,
          sql`e.root IN ${sql.in([...roots, ''])}`,
        ]),
      )

      if (row === undefined) {
        return yield* notFound('This gallery is no longer in Galleries.')
      }

      return row
    })

    const pagesOf = (gallery: string) =>
      sql`SELECT version, name, file, width, height, modified_ms FROM gallery_pages WHERE gallery = ${gallery} ORDER BY version, position`.pipe(
        Effect.flatMap((rows) => decodePages(rows)),
        Effect.orDie,
      )

    const openGallery = Effect.fn('Galleries.openGallery')(function* ({ folder }: ByFolder) {
      const row = yield* galleryRow(folder)

      if (row.pages_synced === 0) {
        yield* index.syncPages(row.folder, yield* translationFolder)
      }

      const pages = yield* pagesOf(row.folder)

      const versionPages = (version: GalleryVersion) =>
        pages
          .filter((page) => page.version === version)
          .map((page) => ({
            name: page.name,
            file: page.file,
            width: page.width,
            height: page.height,
            modifiedMs: page.modified_ms,
          }))

      return {
        folder: row.folder,
        title: row.title,
        titleJapanese: row.title_japanese,
        artists: row.artists,
        tags: row.tags,
        source: row.source,
        url: row.url,
        cover: row.cover,
        addedAt: row.added_at,
        downloaded: row.downloaded === 1,
        original: versionPages('original'),
        translated: versionPages('translated'),
        reading: readingOf(row),
      }
    })

    const continueReading = Effect.fn('Galleries.continueReading')(function* () {
      const roots = yield* reconcile

      const rows = yield* tiles(
        sql.and([sql`e.root IN ${sql.in([...roots, ''])}`, sql`r.gallery IS NOT NULL`]),
      )

      return rows
        .map((row) => galleryTile(row))
        .toSorted((left, right) => newestFirst(readAtOf(left), readAtOf(right)))
        .slice(0, continueReadingShown)
    })

    const saveReading = Effect.fn('Galleries.saveReading')(function* (
      reading: ByFolder & Omit<ReadingProgress, 'readAt'>,
    ) {
      const row = yield* galleryRow(reading.folder)

      yield* Effect.orDie(
        sql`INSERT OR REPLACE INTO gallery_reading ${sql.insert({
          gallery: row.folder,
          page: reading.page,
          version: reading.version,
          direction: reading.direction,
          shift_spread: reading.shiftSpread ? 1 : 0,
          layout: reading.layout,
          read_at: yield* now,
        })}`,
      )
    })

    const addRoot = Effect.fn('Galleries.addRoot')(function* ({ path: wanted }: ByPath) {
      const root = normalized(wanted)

      const info = yield* fs
        .stat(root)
        .pipe(Effect.mapError(() => notFound('The folder could not be found.')))

      if (info.type !== 'Directory') {
        return yield* new GalleriesError({
          reason: 'invalid',
          message: 'Choose a folder, not a file.',
        })
      }

      const overlapping = (yield* currentRoots).find((existing) =>
        GalleryIndex.overlaps(existing.path, root, path.sep),
      )

      if (overlapping !== undefined) {
        return yield* new GalleriesError({
          reason: 'conflict',
          message: `This folder overlaps ${overlapping.path}, which Galleries already reads.`,
        })
      }

      yield* Effect.orDie(
        sql`INSERT INTO gallery_roots ${sql.insert({ path: root, added_at: yield* now })}`,
      )

      yield* reconcile
      yield* Effect.logInfo('Gallery root added').pipe(Effect.annotateLogs({ root }))

      return { path: root, downloads: false }
    })

    const removeRoot = Effect.fn('Galleries.removeRoot')(function* ({ path: wanted }: ByPath) {
      const root = normalized(wanted)
      const downloads = yield* downloadsFolder

      if (Option.isSome(downloads) && downloads.value.toLowerCase() === root.toLowerCase()) {
        return yield* new GalleriesError({
          reason: 'invalid',
          message: 'The Downloads folder is always read. Choose another Downloads folder first.',
        })
      }

      if (!(yield* addedRoots).includes(root)) {
        return yield* notFound('This folder is not a gallery root.')
      }

      yield* Effect.orDie(sql`DELETE FROM gallery_roots WHERE path = ${root}`)
      yield* reconcile
      yield* Effect.logInfo('Gallery root removed').pipe(Effect.annotateLogs({ root }))
    })

    return GalleriesRpc.of({
      listGalleryEntries: listEntries,
      continueReadingGalleries: continueReading,
      openGallery,
      saveGalleryReading: saveReading,
      galleryRoots: Effect.fn('Galleries.roots')(function* () {
        yield* reconcile

        return yield* currentRoots
      }),
      addGalleryRoot: addRoot,
      removeGalleryRoot: removeRoot,
      watchGalleryIndex: () => Stream.unwrap(Effect.as(reconcile, Stream.fromPubSub(changes))),
    })
  }),
)
