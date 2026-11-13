import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { InGameTextStore } from './InGameTextStore'

const layerWithFree = (freeBytes: number) =>
  InGameTextStore.layer.pipe(
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(freeBytes)),
    Layer.provideMerge(NodeServices.layer),
  )

const TestLayer = layerWithFree(100 * 1024 ** 3)

const addGame = Effect.fn(function* (id: string) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO games ${sql.insert({
    id,
    title: id,
    folder_path: `C:\\Games\\${id}`,
    folder_key: id,
    executable_path: `C:\\Games\\${id}\\Game.exe`,
    engine: 'rpg-maker-mv',
    size_bytes: 1,
    translation: 'original',
    added_at: '2026-10-25T00:00:00Z',
  })}`
})

const useItem = {
  gameId: 'game',
  targetLanguage: 'English',
  origin: 'ui',
  key: 'アイテムを使う',
} as const

describe('InGameTextStore', () => {
  it.effect('keeps translations per target language', () =>
    Effect.gen(function* () {
      const store = yield* InGameTextStore

      yield* addGame('game')

      yield* store.saveTranslation({
        ...useItem,
        translatedText: 'Use item',
        scene: 'Menu',
        allowedWidth: 120,
        fontSize: 22,
      })

      expect(yield* store.dictionary('game', 'English', 'ui')).toEqual([
        ['アイテムを使う', 'Use item'],
      ])

      expect(yield* store.dictionary('game', 'German', 'ui')).toEqual([])

      expect(Option.getOrThrow(yield* store.entry(useItem))).toMatchObject({
        translatedText: 'Use item',
        scene: 'Menu',
        allowedWidth: 120,
        fontSize: 22,
        fit: 'as-is',
        edited: false,
        locked: false,
      })
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('never replaces a translation the user edited or locked', () =>
    Effect.gen(function* () {
      const store = yield* InGameTextStore
      const options = { ...useItem, key: 'オプション' }

      yield* addGame('game')
      yield* store.saveTranslation({ ...useItem, translatedText: 'Use item' })
      yield* store.saveTranslation({ ...options, translatedText: 'Options' })
      yield* store.edit(useItem, 'Use')
      yield* store.setLocked(options, true)
      yield* store.saveTranslation({ ...useItem, translatedText: 'Use the item' })
      yield* store.saveShortened(options, 'Opts')

      expect(yield* store.dictionary('game', 'English', 'ui')).toEqual(
        expect.arrayContaining([
          ['アイテムを使う', 'Use'],
          ['オプション', 'Options'],
        ]),
      )
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('filters and counts strings that are too long', () =>
    Effect.gen(function* () {
      const store = yield* InGameTextStore
      const speed = { ...useItem, key: 'メッセージ速度' }

      yield* addGame('game')
      yield* store.saveTranslation({ ...useItem, translatedText: 'Use item' })
      yield* store.saveTranslation({ ...speed, translatedText: 'Message speed' })
      yield* store.recordFit(speed, 'too-long', 90)

      const tooLong = yield* store.entries('game', 'English', 'too-long', '')
      const searched = yield* store.entries('game', 'English', 'all', 'item')

      expect(tooLong.map((entry) => [entry.key, entry.allowedWidth])).toEqual([
        ['メッセージ速度', 90],
      ])

      expect(searched.map((entry) => entry.key)).toEqual(['アイテムを使う'])

      expect(yield* store.counts('game', 'English')).toEqual({
        strings: 2,
        tooLong: 1,
        images: { withText: 0, total: 0 },
      })
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('stores scanned images and counts the ones with text', () =>
    Effect.gen(function* () {
      const store = yield* InGameTextStore

      yield* addGame('game')

      yield* store.saveImage('game', {
        imagePath: 'pictures/title_logo',
        fileSize: 10,
        modifiedAt: '2026-10-25T00:00:00Z',
        boxes: [{ x: 1, y: 2, w: 30, h: 12, key: '黄昏' }],
      })

      yield* store.saveImage('game', {
        imagePath: 'pictures/forest',
        fileSize: 20,
        modifiedAt: '2026-10-25T00:00:00Z',
        boxes: [],
      })

      expect((yield* store.images('game')).map((image) => image.imagePath)).toEqual([
        'pictures/forest',
        'pictures/title_logo',
      ])

      expect((yield* store.counts('game', 'English')).images).toEqual({ withText: 1, total: 2 })
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('stops saving translations while the drive is almost full', () =>
    Effect.gen(function* () {
      const store = yield* InGameTextStore

      yield* addGame('game')
      yield* store.saveTranslation({ ...useItem, translatedText: 'Use item' })

      expect(yield* store.dictionary('game', 'English', 'ui')).toEqual([])
    }).pipe(Effect.provide(layerWithFree(1))),
  )
})
