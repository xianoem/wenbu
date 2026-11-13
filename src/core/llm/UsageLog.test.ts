import { assert, describe, it } from '@effect/vitest'
import { DateTime, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import * as Database from '../platform/Database'
import { backfillFromRuns, type UsageRecord, UsageLog } from './UsageLog'

const request: UsageRecord = {
  feature: 'overlay',
  gameId: 'game-1',
  presetId: 'preset-1',
  presetName: 'Overlay',
  modelId: 'gemini-2.5-flash',
  inputTokens: 1000,
  cachedTokens: 200,
  outputTokens: 100,
  costUsd: 0.002,
}

const rows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return yield* sql`
    SELECT day, feature, preset_id, preset_name, model_id, game_id, requests, unpriced_requests,
      input_tokens, cached_tokens, output_tokens, cost_usd
    FROM llm_usage ORDER BY day, feature, game_id
  `
})

const toJson = (value: object) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie)

const usageIn = (timeZone: DateTime.TimeZone) =>
  Layer.effect(UsageLog, UsageLog.make({ timeZone })).pipe(
    Layer.provideMerge(Database.layer(':memory:')),
  )

const utc = usageIn(DateTime.zoneMakeOffset(0))

// The clock is set before the log starts, or its five-second timer replays the years skipped.
const on =
  (iso: string, layer = utc) =>
  <A, E>(body: Effect.Effect<A, E, UsageLog | SqlClient.SqlClient>) =>
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(iso))).pipe(
      Effect.andThen(body.pipe(Effect.provide(layer))),
    )

describe('UsageLog', () => {
  it.effect('adds requests of the same day, feature, preset, model and game into one row', () =>
    Effect.gen(function* () {
      const usage = yield* UsageLog

      yield* usage.record(request)
      yield* usage.record({ ...request, inputTokens: 500, cachedTokens: 0, costUsd: 0.001 })
      yield* usage.record({ ...request, feature: 'game-guide' })
      yield* usage.flush

      assert.deepStrictEqual(yield* rows, [
        {
          day: '2026-10-29',
          feature: 'game-guide',
          preset_id: 'preset-1',
          preset_name: 'Overlay',
          model_id: 'gemini-2.5-flash',
          game_id: 'game-1',
          requests: 1,
          unpriced_requests: 0,
          input_tokens: 1000,
          cached_tokens: 200,
          output_tokens: 100,
          cost_usd: 0.002,
        },
        {
          day: '2026-10-29',
          feature: 'overlay',
          preset_id: 'preset-1',
          preset_name: 'Overlay',
          model_id: 'gemini-2.5-flash',
          game_id: 'game-1',
          requests: 2,
          unpriced_requests: 0,
          input_tokens: 1500,
          cached_tokens: 200,
          output_tokens: 200,
          cost_usd: 0.003,
        },
      ])
    }).pipe(on('2026-10-29T10:00:00Z')),
  )

  it.effect('adds to the totals already saved for the day', () =>
    Effect.gen(function* () {
      const usage = yield* UsageLog

      yield* usage.record(request)
      yield* usage.flush
      yield* usage.record({ ...request, presetName: 'Overlay (fast)' })
      yield* usage.flush

      const [row] = yield* rows

      assert.strictEqual(row?.['requests'], 2)
      assert.strictEqual(row?.['input_tokens'], 2000)
      assert.strictEqual(row?.['preset_name'], 'Overlay (fast)')
    }).pipe(on('2026-10-29T10:00:00Z')),
  )

  it.effect('dates each request by the local day', () =>
    Effect.gen(function* () {
      const usage = yield* UsageLog

      yield* usage.record(request)
      yield* usage.flush

      const [row] = yield* rows

      assert.strictEqual(row?.['day'], '2026-10-30')
    }).pipe(on('2026-10-29T23:30:00Z', usageIn(DateTime.zoneMakeOffset(2 * 60 * 60 * 1000)))),
  )

  it.effect('counts requests to unpriced models in tokens only', () =>
    Effect.gen(function* () {
      const usage = yield* UsageLog

      yield* usage.record({ ...request, costUsd: undefined })
      yield* usage.record({ ...request, gameId: undefined })
      yield* usage.flush

      const [noGame, game] = yield* rows

      assert.strictEqual(noGame?.['game_id'], '')
      assert.strictEqual(noGame?.['unpriced_requests'], 0)
      assert.strictEqual(game?.['unpriced_requests'], 1)
      assert.strictEqual(game?.['cost_usd'], 0)
    }).pipe(Effect.provide(utc)),
  )

  it.effect('writes what it holds every five seconds and when it closes', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()

      const usage = yield* UsageLog.make({ timeZone: DateTime.zoneMakeOffset(0) }).pipe(
        Scope.provide(scope),
      )

      yield* usage.record(request)

      assert.lengthOf(yield* rows, 0)

      yield* TestClock.adjust('5 seconds')

      assert.lengthOf(yield* rows, 1)

      yield* usage.record({ ...request, feature: 'subtitles' })
      yield* Scope.close(scope, Exit.void)

      assert.lengthOf(yield* rows, 2)
    }).pipe(Effect.provide(Database.layer(':memory:'))),
  )

  it.effect('backfills daily totals from earlier RPG Maker and manga runs', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const run = (presetName: string, usage: object) =>
        toJson({ presetName, usage, startedAt: '2026-09-02T08:00:00.000Z' })

      yield* sql`INSERT INTO games ${sql.insert({
        id: 'game-1',
        title: '魔法の森',
        folder_path: 'C:/Games/Mahou',
        folder_key: 'c:/games/mahou',
        executable_path: 'C:/Games/Mahou/Game.exe',
        engine: 'rpg-maker-mv',
        size_bytes: 1,
        translation: 'translated',
        added_at: '2026-09-01T00:00:00.000Z',
      })}`

      yield* sql`INSERT INTO translation_runs ${sql.insert([
        {
          id: 'run-1',
          game_id: 'game-1',
          started_at: '2026-09-02T08:00:00.000Z',
          status: 'translated',
          run: yield* run('Fast batch', { inputTokens: 1000, outputTokens: 400, costUsd: 0.5 }),
        },
        {
          id: 'run-2',
          game_id: 'game-1',
          started_at: '2026-09-02T20:00:00.000Z',
          status: 'partial',
          run: yield* run('Fast batch', { inputTokens: 500, outputTokens: 100, costUsd: 0.25 }),
        },
      ])}`

      yield* sql`INSERT INTO manga_runs ${sql.insert({
        id: 'manga-1',
        started_at: '2026-09-03T08:00:00.000Z',
        status: 'done',
        run: yield* run('Local', { inputTokens: 300, outputTokens: 30 }),
      })}`

      yield* sql`DELETE FROM llm_usage`
      yield* backfillFromRuns

      assert.deepStrictEqual(yield* rows, [
        {
          day: '2026-09-02',
          feature: 'rpg-translation',
          preset_id: '',
          preset_name: 'Fast batch',
          model_id: '',
          game_id: 'game-1',
          requests: 2,
          unpriced_requests: 0,
          input_tokens: 1500,
          cached_tokens: 0,
          output_tokens: 500,
          cost_usd: 0.75,
        },
        {
          day: '2026-09-03',
          feature: 'manga',
          preset_id: '',
          preset_name: 'Local',
          model_id: '',
          game_id: '',
          requests: 1,
          unpriced_requests: 1,
          input_tokens: 300,
          cached_tokens: 0,
          output_tokens: 30,
          cost_usd: 0,
        },
      ])
    }).pipe(Effect.provide(Database.layer(':memory:'))),
  )
})
