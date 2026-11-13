import { DateTime, Effect, FileSystem, Option, Path, Schema, type Semaphore } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { detailsFile, GalleryDetails } from '../downloads/GalleryFiles'
import { type ImageSize, imageSizeOf } from '../mangaEditor/ImageHeader'
import {
  type Classified,
  type ClassifiedGallery,
  classify,
  type Listing,
  naturalOrder,
  summarizeFolders,
} from './GalleryTree'

const pageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])

const headerBytes = 64 * 1024

/** SQLite takes about 32,000 values per statement. */
const rowsPerInsert = 500

interface StoredListing {
  readonly folder: string
  readonly modifiedMs: number
  readonly createdMs: number | undefined
  readonly images: ReadonlyArray<string>
  readonly folders: ReadonlyArray<string>
  readonly details: boolean
}

const Names = Schema.fromJsonString(Schema.Array(Schema.String))

const ListingRow = Schema.Struct({
  folder: Schema.String,
  modified_ms: Schema.Number,
  created_ms: Schema.NullOr(Schema.Number),
  images: Names,
  folders: Names,
  details: Schema.Int,
})

const EntryRow = Schema.Struct({
  folder: Schema.String,
  parent: Schema.String,
  kind: Schema.Literals(['gallery', 'folder']),
  title: Schema.String,
  title_japanese: Schema.NullOr(Schema.String),
  artists: Names,
  tags: Names,
  source: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  search: Schema.String,
  original_pages: Schema.Int,
  translated_pages: Schema.Int,
  cover: Schema.NullOr(Schema.String),
  covers: Names,
  galleries: Schema.Int,
  pages: Schema.Int,
  added_at: Schema.String,
  downloaded: Schema.Int,
  pages_synced: Schema.Int,
})

type EntryRow = typeof EntryRow.Type

const PageRow = Schema.Struct({
  version: Schema.Literals(['original', 'translated']),
  name: Schema.String,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  bytes: Schema.Number,
  modified_ms: Schema.Number,
})

const encodeEntry = Schema.encodeEffect(EntryRow)

const encodeListing = Schema.encodeEffect(ListingRow)

const fromRow = (row: typeof ListingRow.Type): StoredListing => ({
  folder: row.folder,
  modifiedMs: row.modified_ms,
  createdMs: row.created_ms ?? undefined,
  images: row.images,
  folders: row.folders,
  details: row.details === 1,
})

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(GalleryDetails))

const millisOf = (date: Option.Option<Date>) =>
  Option.getOrUndefined(
    Option.map(date, (value) => DateTime.toEpochMillis(DateTime.fromDateUnsafe(value))),
  )

const isoOf = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis))

const millisOfIso = (iso: string) =>
  Option.getOrElse(
    Option.map(DateTime.make(iso), (time) => DateTime.toEpochMillis(time)),
    () => 0,
  )

const chunks = <A>(rows: ReadonlyArray<A>, size: number) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, at) =>
    rows.slice(at * size, (at + 1) * size),
  )

export const overlaps = (left: string, right: string, separator: string) => {
  const a = left.toLowerCase()
  const b = right.toLowerCase()

  return a === b || a.startsWith(`${b}${separator}`) || b.startsWith(`${a}${separator}`)
}

const searchText = (parts: ReadonlyArray<string | null>) =>
  parts
    .filter((part) => part !== null)
    .join('\n')
    .toLowerCase()

export interface ScanResult {
  readonly changed: ReadonlySet<string>
  readonly unsynced: ReadonlyArray<string>
}

export const make = Effect.fnUntraced(function* (io: Semaphore.Semaphore) {
  const sql = yield* SqlClient.SqlClient
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const gated = <A, E, R>(effect: Effect.Effect<A, E, R>) => io.withPermits(1)(effect)

  const storedListings = SqlSchema.findAll({
    Request: Schema.String,
    Result: ListingRow,
    execute: (root) => sql`SELECT * FROM gallery_listings WHERE root = ${root}`,
  })

  const storedEntries = SqlSchema.findAll({
    Request: Schema.String,
    Result: EntryRow,
    execute: (root) => sql`SELECT * FROM gallery_entries WHERE root = ${root}`,
  })

  const listingRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ListingRow,
    execute: (folder) => sql`SELECT * FROM gallery_listings WHERE folder = ${folder}`,
  })

  const listingOf = (folder: string) =>
    Effect.map(listingRow(folder), (row) => Option.map(row, (found) => fromRow(found)))

  const storedPages = SqlSchema.findAll({
    Request: Schema.String,
    Result: PageRow,
    execute: (gallery) => sql`SELECT * FROM gallery_pages WHERE gallery = ${gallery}`,
  })

  const isDirectory = (file: string) =>
    gated(fs.stat(file)).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.orElseSucceed(() => false),
    )

  const listFolder = Effect.fnUntraced(function* (
    folder: string,
    modifiedMs: number,
    createdMs: number | undefined,
  ) {
    const names = yield* gated(fs.readDirectory(folder))
    const images = names.filter((name) => pageExtensions.has(path.extname(name).toLowerCase()))
    const others = names.filter((name) => !images.includes(name))
    const details = others.some((name) => name.toLowerCase() === detailsFile)

    const folders = yield* Effect.filter(
      others.filter((name) => name.toLowerCase() !== detailsFile),
      (name) => isDirectory(path.join(folder, name)),
      { concurrency: 'unbounded' },
    )

    return { folder, modifiedMs, createdMs, images, folders, details } satisfies StoredListing
  })

  const readTree = (
    root: string,
    known: ReadonlyMap<string, StoredListing>,
    dirty: ReadonlySet<string>,
  ) => {
    const listings: Array<StoredListing> = []
    const relisted = new Set<string>()

    const read = (folder: string): Effect.Effect<Option.Option<Listing>> =>
      Effect.gen(function* () {
        const info = yield* gated(fs.stat(folder))

        if (info.type !== 'Directory') {
          return Option.none()
        }

        const modifiedMs = millisOf(info.mtime) ?? 0
        const previous = known.get(folder)

        const listing =
          previous !== undefined &&
          previous.modifiedMs === modifiedMs &&
          !dirty.has(folder.toLowerCase())
            ? previous
            : yield* listFolder(folder, modifiedMs, millisOf(info.birthtime))

        if (listing !== previous) {
          relisted.add(folder)
        }

        listings.push(listing)

        const children = yield* Effect.forEach(
          listing.folders,
          (name) => read(path.join(folder, name)),
          { concurrency: 'unbounded' },
        )

        return Option.some({
          folder,
          images: listing.images,
          children: children.flatMap((child) => Option.toArray(child)),
        })
      }).pipe(Effect.orElseSucceed(() => Option.none()))

    return Effect.map(read(root), (tree) => ({ tree, listings, relisted }))
  }

  const sizeOfFile = (file: string) =>
    gated(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(file, { flag: 'r' })
          const start = new Uint8Array(headerBytes)
          const read = yield* handle.read(start)

          return imageSizeOf(start.subarray(0, Number(read)))
        }),
      ),
    ).pipe(Effect.orElseSucceed(() => Option.none<ImageSize>()))

  const translationFolderOf = (listing: StoredListing, translationFolder: string) =>
    Option.fromNullishOr(
      listing.folders.find((name) => name.toLowerCase() === translationFolder.toLowerCase()),
    ).pipe(Option.map((name) => path.join(listing.folder, name)))

  const syncPages = Effect.fnUntraced(function* (gallery: string, translationFolder: string) {
    const own = yield* listingOf(gallery)

    if (Option.isNone(own)) {
      return
    }

    const translation = translationFolderOf(own.value, translationFolder)

    const translated = yield* Option.match(translation, {
      onNone: () => Effect.succeed([]),
      onSome: (folder) =>
        Effect.map(listingOf(folder), (listing) =>
          Option.match(listing, { onNone: () => [], onSome: (found) => found.images }),
        ),
    })

    const previous = new Map(
      (yield* storedPages(gallery)).map((row) => [`${row.version}/${row.name}`, row]),
    )

    const versions = [
      { version: 'original', folder: gallery, names: own.value.images },
      { version: 'translated', folder: Option.getOrElse(translation, () => ''), names: translated },
    ] as const

    const rows = yield* Effect.forEach(
      versions.flatMap(({ version, folder, names }) =>
        naturalOrder(names).map((name, position) => ({ version, folder, name, position })),
      ),
      ({ version, folder, name, position }) =>
        Effect.gen(function* () {
          const file = path.join(folder, name)
          const info = yield* gated(fs.stat(file))
          const bytes = Number(info.size)
          const modifiedMs = millisOf(info.mtime) ?? 0
          const known = previous.get(`${version}/${name}`)

          const size =
            known !== undefined && known.bytes === bytes && known.modified_ms === modifiedMs
              ? Option.fromNullishOr(
                  known.width === null || known.height === null
                    ? undefined
                    : { width: known.width, height: known.height },
                )
              : yield* sizeOfFile(file)

          return Option.some({
            gallery,
            version,
            position,
            name,
            file,
            width: Option.getOrNull(Option.map(size, (found) => found.width)),
            height: Option.getOrNull(Option.map(size, (found) => found.height)),
            bytes,
            modified_ms: modifiedMs,
          })
        }).pipe(Effect.orElseSucceed(() => Option.none())),
      { concurrency: 'unbounded' },
    )

    const pages = rows.flatMap((row) => Option.toArray(row))

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM gallery_pages WHERE gallery = ${gallery}`

        for (const chunk of chunks(pages, rowsPerInsert)) {
          yield* sql`INSERT INTO gallery_pages ${sql.insert(chunk)}`
        }

        yield* sql`UPDATE gallery_entries SET pages_synced = 1 WHERE folder = ${gallery}`
      }),
    )
  }, Effect.orDie)

  const coverOf = (gallery: ClassifiedGallery) => {
    const translated = gallery.translated[0]
    const original = gallery.original[0]

    if (translated !== undefined && gallery.translation !== undefined) {
      return path.join(gallery.translation, translated)
    }

    return original === undefined ? null : path.join(gallery.folder, original)
  }

  const detailsOf = (folder: string) =>
    fs.readFileString(path.join(folder, detailsFile)).pipe(
      Effect.flatMap((text) => decodeDetails(text)),
      Effect.option,
    )

  const galleryRow = Effect.fnUntraced(function* (
    gallery: ClassifiedGallery,
    listing: StoredListing | undefined,
    old: EntryRow | undefined,
    relisted: boolean,
    now: string,
  ) {
    const cover = coverOf(gallery)

    const reuse = old !== undefined && old.kind === 'gallery' && !relisted

    const details =
      reuse || listing?.details !== true ? Option.none() : yield* detailsOf(gallery.folder)

    const fallbackAdded = listing?.createdMs === undefined ? now : isoOf(listing.createdMs)

    const title = Option.match(details, {
      onNone: () => (reuse ? old.title : path.basename(gallery.folder)),
      onSome: (found) => found.title,
    })

    const described = Option.match(details, {
      onNone: () =>
        reuse
          ? {
              title_japanese: old.title_japanese,
              artists: old.artists,
              tags: old.tags,
              source: old.source,
              url: old.url,
              added_at: old.added_at,
              downloaded: old.downloaded,
            }
          : {
              title_japanese: null,
              artists: [],
              tags: [],
              source: null,
              url: null,
              added_at: fallbackAdded,
              downloaded: 0,
            },
      onSome: (found) => ({
        title_japanese: found.titleJapanese,
        artists: found.artists,
        tags: found.tags,
        source: found.source,
        url: found.url,
        added_at: found.downloadedAt,
        downloaded: 1,
      }),
    })

    const row: EntryRow = {
      folder: gallery.folder,
      parent: gallery.parent,
      kind: 'gallery',
      title,
      ...described,
      search: searchText([
        title,
        described.title_japanese,
        ...described.artists,
        ...described.tags,
      ]),
      original_pages: gallery.original.length,
      translated_pages: gallery.translated.length,
      cover,
      covers: [],
      galleries: 0,
      pages: Math.max(gallery.original.length, gallery.translated.length),
      pages_synced: 0,
    }

    return row
  })

  const sameRow = (left: typeof EntryRow.Encoded, right: typeof EntryRow.Encoded) => {
    const after = new Map(Object.entries(right))

    return Object.entries(left).every(
      ([key, value]) => key === 'pages_synced' || after.get(key) === value,
    )
  }

  /** Rewriting a page in place does not change its folder's modification time, hence `dirty`. */
  const scanRoot = Effect.fnUntraced(function* (
    root: string,
    translationFolder: string,
    dirty: ReadonlySet<string>,
    reclassify: boolean,
  ) {
    const known = new Map(
      (yield* storedListings(root)).map((row) => [row.folder, fromRow(row)] as const),
    )

    const { tree, listings, relisted } = yield* readTree(root, known, dirty)

    if (Option.isNone(tree)) {
      return { changed: new Set<string>(), unsynced: [] } satisfies ScanResult
    }

    const now = DateTime.formatIso(yield* DateTime.now)
    const byFolder = new Map(listings.map((listing) => [listing.folder, listing]))
    const old = new Map((yield* storedEntries(root)).map((row) => [row.folder, row]))
    const classified: ReadonlyArray<Classified> = classify(tree.value, translationFolder)

    const galleries = yield* Effect.forEach(
      classified.filter((entry) => entry.kind === 'gallery'),
      (gallery) => {
        const wasRelisted =
          relisted.has(gallery.folder) ||
          (gallery.translation !== undefined && relisted.has(gallery.translation))

        return Effect.map(
          galleryRow(
            gallery,
            byFolder.get(gallery.folder),
            old.get(gallery.folder),
            wasRelisted,
            now,
          ),
          (row) => {
            const previous = old.get(gallery.folder)

            const synced =
              previous !== undefined &&
              previous.pages_synced === 1 &&
              !wasRelisted &&
              !reclassify &&
              previous.original_pages === row.original_pages &&
              previous.translated_pages === row.translated_pages

            return { ...row, pages_synced: synced ? 1 : 0 }
          },
        )
      },
      { concurrency: 8 },
    )

    const folders = classified.filter((entry) => entry.kind === 'folder')

    const summaries = summarizeFolders(
      folders,
      galleries.map((gallery) => ({
        folder: gallery.folder,
        parent: gallery.parent,
        pages: gallery.pages,
        cover: gallery.cover ?? undefined,
        addedAt: millisOfIso(gallery.added_at),
      })),
    )

    const folderRows = folders.map((entry): EntryRow => {
      const summary = summaries.get(entry.folder)
      const title = path.basename(entry.folder)

      return {
        folder: entry.folder,
        parent: entry.parent,
        kind: 'folder',
        title,
        title_japanese: null,
        artists: [],
        tags: [],
        source: null,
        url: null,
        search: searchText([title]),
        original_pages: 0,
        translated_pages: 0,
        cover: summary?.covers[0] ?? null,
        covers: summary?.covers ?? [],
        galleries: summary?.galleries ?? 0,
        pages: summary?.pages ?? 0,
        added_at: summary === undefined ? now : isoOf(summary.addedAt),
        downloaded: 0,
        pages_synced: 1,
      }
    })

    const rows = yield* Effect.forEach([...galleries, ...folderRows], (row) => encodeEntry(row))
    const current = new Set(rows.map((row) => row.folder))
    const gone = [...old.values()].filter((row) => !current.has(row.folder))

    const before = new Map(
      (yield* Effect.forEach([...old.values()], (row) => encodeEntry(row))).map((row) => [
        row.folder,
        row,
      ]),
    )

    const updated = rows.filter((row) => {
      const previous = before.get(row.folder)

      return previous === undefined || !sameRow(previous, row) || row.pages_synced === 0
    })

    const changed = new Set<string>()

    for (const row of [...updated, ...gone]) {
      changed.add(row.parent)
      changed.add(row.folder)
    }

    const seen = new Set(listings.map((listing) => listing.folder))
    const vanished = [...known.keys()].filter((folder) => !seen.has(folder))
    const listed = listings.filter((listing) => relisted.has(listing.folder))

    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const chunk of chunks(vanished, rowsPerInsert)) {
          yield* sql`DELETE FROM gallery_listings WHERE ${sql.in('folder', chunk)}`
        }

        for (const chunk of chunks(listed, rowsPerInsert)) {
          const encoded = yield* Effect.forEach(chunk, (listing) =>
            encodeListing({
              folder: listing.folder,
              modified_ms: listing.modifiedMs,
              created_ms: listing.createdMs ?? null,
              images: listing.images,
              folders: listing.folders,
              details: listing.details ? 1 : 0,
            }),
          )

          yield* sql`INSERT OR REPLACE INTO gallery_listings ${sql.insert(
            encoded.map((listing) => ({ ...listing, root })),
          )}`
        }

        for (const chunk of chunks(
          gone.map((row) => row.folder),
          rowsPerInsert,
        )) {
          yield* sql`DELETE FROM gallery_entries WHERE ${sql.in('folder', chunk)}`
          yield* sql`DELETE FROM gallery_pages WHERE ${sql.in('gallery', chunk)}`
          yield* sql`DELETE FROM gallery_reading WHERE ${sql.in('gallery', chunk)}`
        }

        for (const chunk of chunks(updated, rowsPerInsert)) {
          yield* sql`INSERT OR REPLACE INTO gallery_entries ${sql.insert(
            chunk.map((row) => ({ ...row, root, indexed_at: now })),
          )}`
        }
      }),
    )

    return {
      changed,
      unsynced: galleries.filter((row) => row.pages_synced === 0).map((row) => row.folder),
    } satisfies ScanResult
  }, Effect.orDie)

  const dropRoot = Effect.fnUntraced(function* (root: string) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM gallery_pages WHERE gallery IN (SELECT folder FROM gallery_entries WHERE root = ${root})`
        yield* sql`DELETE FROM gallery_entries WHERE root = ${root}`
        yield* sql`DELETE FROM gallery_listings WHERE root = ${root}`
      }),
    )
  }, Effect.orDie)

  return { scanRoot, syncPages, dropRoot }
})
