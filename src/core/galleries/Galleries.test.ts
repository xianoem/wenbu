import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import {
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Schedule,
  type Scope,
  Stream,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { defaultDownloadSettings, DownloadSettings } from '#contract/Downloads'
import { type EntryListing, GalleriesRpc, type ListEntries } from '#contract/Galleries'
import { encodeDetails } from '../downloads/GalleryFiles'
import * as Database from '../platform/Database'
import * as SettingsStore from '../platform/SettingsStore'
import { GalleriesRpcLive } from './Galleries'
import { RootWatcher } from './RootWatcher'

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  view.setUint32(16, width)
  view.setUint32(20, height)

  return bytes
}

const details = {
  source: 'Hitomi',
  url: 'https://hitomi.la/galleries/1.html',
  id: '1',
  title: 'Summer Festival',
  titleJapanese: '夏祭り',
  artists: ['Koari'],
  tags: ['female:glasses'],
  pages: 3,
  downloadedAt: '2026-10-01T00:00:00.000Z',
}

const everything: ListEntries = { filter: 'all', sort: 'title', search: '' }

const drivenWatcher = Effect.map(Queue.unbounded<Option.Option<string>>(), (changes) => ({
  changes,
  layer: Layer.succeed(RootWatcher)({ watch: () => Stream.fromQueue(changes) }),
}))

const setup = Effect.fn(function* (watcher?: Layer.Layer<RootWatcher>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const temp = yield* fs.makeTempDirectoryScoped()
  const downloads = path.join(temp, 'Downloads')

  const storage = yield* Layer.build(
    KeyValueStore.layerSql({ table: 'settings' }).pipe(
      Layer.provideMerge(Database.layer(':memory:')),
    ),
  )

  yield* Effect.gen(function* () {
    yield* SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      DownloadSettings,
      defaultDownloadSettings,
    ).set('downloads', { ...defaultDownloadSettings, folder: downloads })
  }).pipe(Effect.provideContext(storage), Effect.orDie)

  const pages = Effect.fnUntraced(function* (
    folder: string,
    names: ReadonlyArray<string>,
    size: readonly [number, number] = [800, 1200],
  ) {
    yield* fs.makeDirectory(folder, { recursive: true })

    for (const name of names) {
      yield* fs.writeFile(path.join(folder, name), png(...size))
    }
  })

  const summer = path.join(downloads, 'Summer')

  yield* pages(summer, ['10.png', '2.png', '1.png'])
  yield* pages(path.join(summer, 'translated'), ['1.png'], [900, 1300])
  yield* fs.writeFileString(path.join(summer, 'info.json'), yield* encodeDetails(details))
  yield* pages(path.join(downloads, 'Series', 'Vol 1'), ['1.png', '2.png'])
  yield* pages(path.join(downloads, 'Series', 'Vol 2'), ['1.png'])
  yield* fs.makeDirectory(path.join(downloads, 'Empty', 'Nothing'), { recursive: true })

  const layer = GalleriesRpcLive.pipe(
    Layer.provide([watcher ?? RootWatcher.live, Layer.succeedContext(storage)]),
  )

  const client = yield* RpcTest.makeClient(GalleriesRpc).pipe(
    Effect.provideContext(yield* Layer.build(layer)),
  )

  const listUntil = (request: ListEntries, predicate: (listing: EntryListing) => boolean) =>
    client
      .listGalleryEntries(request)
      .pipe(
        Effect.repeat({ schedule: Schedule.spaced('50 millis'), until: predicate }),
        Effect.timeout('10 seconds'),
      )

  const titles = (listing: EntryListing) => listing.entries.map((entry) => entry.title)

  const indexed = listUntil(everything, (listing) => listing.entries.length === 2)

  return { client, fs, path, temp, downloads, summer, pages, listUntil, titles, indexed }
})

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped)

describe('Galleries', () => {
  it.live('indexes the galleries and folders under the Downloads folder', () =>
    run(
      Effect.gen(function* () {
        const { client, downloads, summer, path, indexed, titles } = yield* setup()
        const top = yield* indexed

        assert.deepStrictEqual(titles(top), ['Series', 'Summer Festival'])
        assert.isNull(top.header)
        assert.deepStrictEqual(top.counts, { all: 3, translated: 1, unread: 3 })
        assert.deepStrictEqual(top.sources, ['Hitomi'])

        assert.deepInclude(top.entries[1], {
          kind: 'gallery',
          folder: summer,
          title: 'Summer Festival',
          artists: ['Koari'],
          source: 'Hitomi',
          originalPages: 3,
          translatedPages: 1,
          cover: path.join(summer, 'translated', '1.png'),
          addedAt: '2026-10-01T00:00:00.000Z',
          reading: null,
        })

        const series = path.join(downloads, 'Series')
        const folder = yield* client.listGalleryEntries({ ...everything, folder: series })

        assert.deepInclude(top.entries[0], { kind: 'folder', galleries: 2, pages: 3 })
        assert.deepStrictEqual(titles(folder), ['Vol 1', 'Vol 2'])

        assert.deepStrictEqual(folder.header, {
          folder: series,
          title: 'Series',
          parent: null,
          galleries: 2,
          folders: 0,
          pages: 3,
        })
      }),
    ),
  )

  it.live('opens a gallery with both versions, in natural order, with every page size', () =>
    run(
      Effect.gen(function* () {
        const { client, summer, path, indexed } = yield* setup()

        yield* indexed

        const gallery = yield* client.openGallery({ folder: summer })

        assert.deepStrictEqual(
          gallery.original.map((page) => [page.name, page.width, page.height]),
          [
            ['1.png', 800, 1200],
            ['2.png', 800, 1200],
            ['10.png', 800, 1200],
          ],
        )

        assert.deepStrictEqual(
          gallery.translated.map((page) => page.file),
          [path.join(summer, 'translated', '1.png')],
        )

        assert.deepInclude(gallery, {
          titleJapanese: '夏祭り',
          tags: ['female:glasses'],
          url: details.url,
          downloaded: true,
          reading: null,
        })

        const missing = yield* client
          .openGallery({ folder: path.join(summer, 'nope') })
          .pipe(Effect.flip)

        assert.strictEqual(missing.reason, 'not-found')
      }),
    ),
  )

  it.live('searches at any depth, filters, and keeps reading progress', () =>
    run(
      Effect.gen(function* () {
        const { client, summer, indexed, titles } = yield* setup()

        yield* indexed

        const byTitle = yield* client.listGalleryEntries({ ...everything, search: 'VOL 2' })
        const byArtist = yield* client.listGalleryEntries({ ...everything, search: 'koari' })
        const byTag = yield* client.listGalleryEntries({ ...everything, search: 'glasses' })
        const translated = yield* client.listGalleryEntries({ ...everything, filter: 'translated' })

        assert.deepStrictEqual(titles(byTitle), ['Vol 2'])
        assert.deepStrictEqual(titles(byArtist), ['Summer Festival'])
        assert.deepStrictEqual(titles(byTag), ['Summer Festival'])
        assert.deepStrictEqual(titles(translated), ['Summer Festival'])

        yield* client.saveGalleryReading({
          folder: summer,
          page: 2,
          version: 'original',
          direction: 'rtl',
          shiftSpread: false,
          layout: 'spread',
        })

        const unread = yield* client.listGalleryEntries({ ...everything, filter: 'unread' })
        const [reading] = yield* client.continueReadingGalleries()

        assert.deepStrictEqual(titles(unread), ['Vol 1', 'Vol 2'])
        assert.deepStrictEqual(unread.counts, { all: 3, translated: 1, unread: 2 })
        assert.strictEqual(reading?.folder, summer)
        assert.deepInclude(reading?.reading, { page: 2, version: 'original', layout: 'spread' })
        assert.deepInclude((yield* client.openGallery({ folder: summer })).reading, { page: 2 })
      }),
    ),
  )

  it.live('adds and removes roots, but never the Downloads folder or overlapping ones', () =>
    run(
      Effect.gen(function* () {
        const { client, temp, downloads, path, pages, indexed, listUntil, titles } = yield* setup()
        const library = path.join(temp, 'Library')

        yield* indexed
        yield* pages(path.join(library, 'Old Book'), ['1.png'])

        assert.deepStrictEqual(yield* client.addGalleryRoot({ path: library }), {
          path: library,
          downloads: false,
        })

        const top = yield* listUntil(everything, (listing) => listing.entries.length === 3)

        assert.deepStrictEqual(titles(top), ['Old Book', 'Series', 'Summer Festival'])

        assert.deepStrictEqual(yield* client.galleryRoots(), [
          { path: downloads, downloads: true },
          { path: library, downloads: false },
        ])

        const inside = yield* client
          .addGalleryRoot({ path: path.join(downloads, 'Series') })
          .pipe(Effect.flip)

        const removeDownloads = yield* client
          .removeGalleryRoot({ path: downloads })
          .pipe(Effect.flip)

        assert.strictEqual(inside.reason, 'conflict')
        assert.strictEqual(removeDownloads.reason, 'invalid')

        yield* client.removeGalleryRoot({ path: library })

        assert.deepStrictEqual(titles(yield* client.listGalleryEntries(everything)), [
          'Series',
          'Summer Festival',
        ])
      }),
    ),
  )

  it.live('notices a new gallery and a rewritten page by itself', () =>
    run(
      Effect.gen(function* () {
        const { client, downloads, summer, path, pages, indexed, listUntil, titles } =
          yield* setup()

        yield* indexed

        const change = yield* client.watchGalleryIndex().pipe(
          Stream.filter((event) => event.folders.includes(downloads)),
          Stream.runHead,
          Effect.timeout('10 seconds'),
          Effect.forkScoped,
        )

        yield* Effect.sleep('200 millis')
        yield* pages(path.join(downloads, 'Arrived'), ['1.png'])

        const top = yield* listUntil(everything, (listing) => listing.entries.length === 3)

        assert.deepStrictEqual(titles(top), ['Arrived', 'Series', 'Summer Festival'])
        assert.isTrue(Option.isSome(yield* Fiber.join(change)))

        yield* pages(summer, ['1.png'], [1600, 2400])

        const rewritten = yield* client.openGallery({ folder: summer }).pipe(
          Effect.repeat({
            schedule: Schedule.spaced('50 millis'),
            until: (gallery) => gallery.original[0]?.width === 1600,
          }),
          Effect.timeout('10 seconds'),
        )

        assert.strictEqual(rewritten.original[0]?.height, 2400)
      }),
    ),
  )

  it.live('checks the whole root when the watcher loses track, and forgets gone galleries', () =>
    run(
      Effect.gen(function* () {
        const watcher = yield* drivenWatcher

        const { client, fs, downloads, summer, path, pages, indexed, listUntil, titles } =
          yield* setup(watcher.layer)

        yield* indexed

        yield* client.saveGalleryReading({
          folder: summer,
          page: 1,
          version: 'translated',
          direction: 'rtl',
          shiftSpread: false,
          layout: 'single',
        })

        yield* pages(path.join(downloads, 'Quiet'), ['1.png'])
        yield* fs.remove(summer, { recursive: true })
        yield* Queue.offer(watcher.changes, Option.none())

        const top = yield* listUntil(everything, (listing) =>
          listing.entries.some((entry) => entry.title === 'Quiet'),
        )

        assert.deepStrictEqual(titles(top), ['Quiet', 'Series'])
        assert.deepStrictEqual(yield* client.continueReadingGalleries(), [])
      }),
    ),
  )
})
