import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { PictureStore, type StoredPicture } from './PictureStore'

const TestLayer = PictureStore.layer.pipe(
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
  Layer.provideMerge(NodeServices.layer),
)

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

const log: StoredPicture = {
  picture: 'pictures/background_log',
  fileSize: 1000,
  modifiedAt: '2026-11-01T00:00:00.000Z',
  width: 1280,
  height: 720,
  lines: [
    {
      id: 1,
      x: 103,
      y: 17,
      w: 223,
      h: 31,
      ocr: 'メッセージログ',
      source: 'メッセージログ',
      keep: false,
    },
  ],
  group: 'メッセージログ',
  status: 'to-review',
  cleanedKey: undefined,
  translatedFile: undefined,
}

const plain: StoredPicture = {
  ...log,
  picture: 'pictures/cg01',
  lines: [],
  group: '',
}

describe('PictureStore', () => {
  it.effect('keeps scanned pictures and changes their review state', () =>
    Effect.gen(function* () {
      const store = yield* PictureStore

      yield* addGame('game')
      yield* store.save('game', log)
      yield* store.save('game', plain)

      expect((yield* store.pictures('game')).map((picture) => picture.picture)).toEqual([
        'pictures/background_log',
        'pictures/cg01',
      ])

      const approved = yield* store.update('game', log.picture, {
        status: 'approved',
        cleanedKey: 'clean-1',
        translatedFile: 'C:\\data\\translated.png',
      })

      expect(approved).toEqual(
        Option.some({
          ...log,
          status: 'approved',
          cleanedKey: 'clean-1',
          translatedFile: 'C:\\data\\translated.png',
        }),
      )

      const reopened = yield* store.update('game', log.picture, {
        status: 'to-review',
        translatedFile: undefined,
      })

      expect(Option.map(reopened, (picture) => [picture.status, picture.translatedFile])).toEqual(
        Option.some(['to-review', undefined]),
      )

      expect(yield* store.update('game', 'pictures/gone', { status: 'kept' })).toEqual(
        Option.none(),
      )

      yield* store.remove('game', ['pictures/cg01'])

      expect((yield* store.pictures('game')).map((picture) => picture.picture)).toEqual([
        'pictures/background_log',
      ])
    }).pipe(Effect.provide(TestLayer)),
  )
})
