import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import { defaultTextPipeline, type SavedHook } from '#contract/TranslationOverlay'
import { Games } from '../library/Games'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { OverlayStore } from './OverlayStore'

const layerWithFree = (freeBytes: number) =>
  Layer.mergeAll(OverlayStore.layer, Games.layer).pipe(
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
    engine: 'windows',
    size_bytes: 1,
    translation: 'original',
    added_at: '2026-10-23T00:00:00Z',
  })}`
})

const hook: SavedHook = {
  code: 'HS8@0:gdi32.dll:GetTextExtentPoint32A',
  name: 'GetTextExtentPoint32A',
  ctx: '4a10',
  ctx2: '0',
  inserted: false,
  savedAt: '2026-10-23T00:00:00Z',
}

describe('OverlayStore', () => {
  it.effect('caches translations per target language', () =>
    Effect.gen(function* () {
      const store = yield* OverlayStore
      const key = { gameId: 'game', targetLanguage: 'English', sourceText: 'おはよう' }

      yield* addGame('game')
      yield* store.cache(key, 'Good morning')

      expect(yield* store.cached(key)).toEqual(Option.some('Good morning'))
      expect(yield* store.cached({ ...key, targetLanguage: 'German' })).toEqual(Option.none())
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('stops caching while the drive is almost full', () =>
    Effect.gen(function* () {
      const store = yield* OverlayStore
      const key = { gameId: 'game', targetLanguage: 'English', sourceText: 'おはよう' }

      yield* addGame('game')
      yield* store.cache(key, 'Good morning')

      expect(yield* store.cached(key)).toEqual(Option.none())
    }).pipe(Effect.provide(layerWithFree(0))),
  )

  it.effect('falls back to the default pipeline until one is saved, and after a reset', () =>
    Effect.gen(function* () {
      const store = yield* OverlayStore
      const custom = { processors: defaultTextPipeline.processors.slice(0, 2) }

      yield* addGame('game')

      const before = yield* store.pipeline('game')

      yield* store.savePipeline('game', custom)

      const saved = yield* store.pipeline('game')

      yield* store.resetPipeline('game')

      expect([before, saved, yield* store.pipeline('game')]).toEqual([
        defaultTextPipeline,
        custom,
        defaultTextPipeline,
      ])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('forgets everything about a game when it leaves the library', () =>
    Effect.gen(function* () {
      const store = yield* OverlayStore
      const games = yield* Games
      const story = { summary: 'Mio meets Yuu.', lineCount: 25, updatedAt: '2026-10-23T00:00:00Z' }

      yield* addGame('game')
      yield* store.saveHook('game', hook)
      yield* store.saveHook('game', { ...hook, name: 'Dialogue' })
      yield* store.savePipeline('game', { processors: [] })
      yield* store.cache({ gameId: 'game', targetLanguage: 'English', sourceText: 'あ' }, 'Ah')
      yield* store.saveStory('game', 'English', story)

      expect(Option.map(yield* store.savedHook('game'), (saved) => saved.name)).toEqual(
        Option.some('Dialogue'),
      )

      expect(yield* store.story('game', 'English')).toEqual(Option.some(story))

      yield* games.remove('game')

      const sql = yield* SqlClient.SqlClient

      const left = yield* sql<{ count: number }>`
        SELECT (SELECT COUNT(*) FROM overlay_saved_hooks)
             + (SELECT COUNT(*) FROM overlay_pipelines)
             + (SELECT COUNT(*) FROM overlay_cache)
             + (SELECT COUNT(*) FROM overlay_stories) AS count
      `

      expect(left[0]?.count).toBe(0)
    }).pipe(Effect.provide(TestLayer)),
  )
})
