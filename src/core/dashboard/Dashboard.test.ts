import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import {
  ConnectionFailed,
  DashboardRpc,
  DetailsToReview,
  GameUpdated,
  LinesSkipped,
  RunStopped,
  WatchedReleased,
} from '#contract/Dashboard'
import * as Database from '../platform/Database'
import { DashboardRpcLive } from './Dashboard'

const TestLayer = DashboardRpcLive.pipe(Layer.provideMerge(Database.layer(':memory:')))

const client = RpcTest.makeClient(DashboardRpc)

const toJson = (value: object) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie)

const addGame = Effect.fnUntraced(function* (id: string, title: string) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO games ${sql.insert({
    id,
    title,
    folder_path: `C:/Games/${id}`,
    folder_key: `c:/games/${id}`,
    executable_path: `C:/Games/${id}/Game.exe`,
    engine: 'rpg-maker-mv',
    size_bytes: 1,
    translation: 'partial',
    added_at: '2026-09-01T00:00:00.000Z',
  })}`
})

interface Usage {
  readonly day: string
  readonly feature?: string
  readonly preset?: string
  readonly model?: string
  readonly game?: string
  readonly tokens?: number
  readonly cost?: number
  readonly unpriced?: boolean
}

const addUsage = Effect.fnUntraced(function* (usage: Usage) {
  const sql = yield* SqlClient.SqlClient
  const tokens = usage.tokens ?? 1000

  yield* sql`INSERT INTO llm_usage ${sql.insert({
    day: usage.day,
    feature: usage.feature ?? 'rpg-translation',
    preset_id: usage.preset ?? 'fast',
    preset_name: usage.preset ?? 'fast',
    model_id: usage.model ?? 'deepseek-chat',
    game_id: usage.game ?? '',
    requests: 2,
    unpriced_requests: usage.unpriced === true ? 2 : 0,
    input_tokens: tokens * 0.8,
    cached_tokens: 0,
    output_tokens: tokens * 0.2,
    cost_usd: usage.cost ?? 0,
  })}`
})

interface Line {
  readonly translated?: boolean
  readonly change?: 'new' | 'changed'
  readonly skipped?: boolean
}

const addLines = Effect.fnUntraced(function* (gameId: string, lines: ReadonlyArray<Line>) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO translation_lines ${sql.insert(
    lines.map((line, index) => ({
      game_id: gameId,
      entry_id: `Map001.json::${index}`,
      file: 'Map001.json',
      pointer: `${index}`,
      context: 'dialogue',
      source_text: `行${index}`,
      translated_text: line.translated === true ? `Line ${index}` : null,
      change: line.change ?? null,
      write_skipped: line.skipped === true ? 'broken-formatting' : null,
      updated_at: '2026-10-01T00:00:00.000Z',
    })),
  )}`
})

const addRun = Effect.fnUntraced(function* (
  gameId: string,
  id: string,
  run: {
    readonly status: string
    readonly startedAt: string
    readonly lines?: { readonly total: number; readonly translated: number }
    readonly stopped?: boolean
    readonly error?: string
  },
) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO translation_runs ${sql.insert({
    id,
    game_id: gameId,
    started_at: run.startedAt,
    status: run.status,
    run: yield* toJson({
      status: run.status,
      startedAt: run.startedAt,
      presetName: 'fast',
      lines: { written: 0, ...(run.lines ?? { total: 10, translated: 10 }) },
      usage: { inputTokens: 0, outputTokens: 0 },
      ...(run.stopped === true ? { stopped: { reason: 'spend-limit', limit: { usd: 5 } } } : {}),
      ...(run.error === undefined ? {} : { error: run.error }),
    }),
  })}`
})

const october = { from: '2026-10-01', to: '2026-10-31' }
const september = { from: '2026-09-01', to: '2026-09-30' }

describe('Dashboard', () => {
  it.effect('sums LLM Usage for the period and the one before it', () =>
    Effect.gen(function* () {
      const dashboard = yield* client

      yield* addGame('dawn', 'Labyrinth of Dawn')
      yield* addGame('garden', "The Witch's Garden")
      yield* addUsage({ day: '2026-10-02', game: 'dawn', cost: 3 })

      yield* addUsage({
        day: '2026-10-02',
        feature: 'overlay',
        preset: 'overlay',
        model: 'gemini',
        game: 'garden',
        cost: 1,
      })

      yield* addUsage({ day: '2026-10-05', game: 'dawn', cost: 2 })

      yield* addUsage({
        day: '2026-10-06',
        feature: 'manga',
        preset: 'local',
        model: 'qwen3',
        unpriced: true,
        tokens: 5000,
      })

      yield* addUsage({ day: '2026-09-20', game: 'dawn', cost: 4 })
      yield* addUsage({ day: '2026-11-01', game: 'dawn', cost: 100 })

      const usage = yield* dashboard.dashboardUsage({ period: october, previous: september })

      assert.deepStrictEqual(usage.totals, {
        requests: 8,
        inputTokens: 6400,
        outputTokens: 1600,
        costUsd: 6,
        unpricedTokens: 5000,
      })

      assert.strictEqual(usage.previous.costUsd, 4)

      assert.deepStrictEqual(usage.days, [
        { day: '2026-10-02', feature: 'overlay', costUsd: 1, tokens: 1000 },
        { day: '2026-10-02', feature: 'rpg-translation', costUsd: 3, tokens: 1000 },
        { day: '2026-10-05', feature: 'rpg-translation', costUsd: 2, tokens: 1000 },
        { day: '2026-10-06', feature: 'manga', costUsd: 0, tokens: 5000 },
      ])

      assert.deepStrictEqual(usage.presets, [
        {
          presetName: 'fast',
          modelId: 'deepseek-chat',
          requests: 4,
          tokens: 2000,
          costUsd: 5,
          unpriced: false,
        },
        {
          presetName: 'overlay',
          modelId: 'gemini',
          requests: 2,
          tokens: 1000,
          costUsd: 1,
          unpriced: false,
        },
        {
          presetName: 'local',
          modelId: 'qwen3',
          requests: 2,
          tokens: 5000,
          costUsd: 0,
          unpriced: true,
        },
      ])

      assert.deepStrictEqual(usage.games, [
        { gameId: 'dawn', title: 'Labyrinth of Dawn', tokens: 2000, costUsd: 5 },
        { gameId: 'garden', title: "The Witch's Garden", tokens: 1000, costUsd: 1 },
        { title: 'No game', tokens: 5000, costUsd: 0 },
      ])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect("counts each game's lines and shows its last run and spend", () =>
    Effect.gen(function* () {
      const dashboard = yield* client

      yield* addGame('dawn', 'Labyrinth of Dawn')
      yield* addGame('silver', 'Silver Promise')
      yield* addGame('untouched', 'Never translated')

      yield* addLines('dawn', [
        { translated: true },
        { translated: true, skipped: true },
        { change: 'new' },
        { change: 'changed', translated: true },
        {},
      ])

      yield* addLines('silver', [{ translated: true }])
      yield* addRun('dawn', 'run-1', { status: 'failed', startedAt: '2026-10-01T10:00:00.000Z' })

      yield* addRun('dawn', 'run-2', {
        status: 'partial',
        startedAt: '2026-10-03T10:00:00.000Z',
        stopped: true,
      })

      yield* addUsage({ day: '2026-10-03', game: 'dawn', cost: 5 })

      const progress = yield* dashboard.translationProgress({ period: october })

      assert.deepStrictEqual(progress, [
        {
          gameId: 'dawn',
          title: 'Labyrinth of Dawn',
          engine: 'rpg-maker-mv',
          lines: 5,
          translated: 3,
          pending: 1,
          skipped: 1,
          lastRun: {
            status: 'partial',
            stoppedAtLimit: true,
            startedAt: '2026-10-03T10:00:00.000Z',
          },
          costUsd: 5,
        },
        {
          gameId: 'silver',
          title: 'Silver Promise',
          engine: 'rpg-maker-mv',
          lines: 1,
          translated: 1,
          pending: 0,
          skipped: 0,
          costUsd: 0,
        },
      ])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('lists stopped runs, game updates, skipped lines and failed connections', () =>
    Effect.gen(function* () {
      const dashboard = yield* client
      const sql = yield* SqlClient.SqlClient

      yield* addGame('dawn', 'Labyrinth of Dawn')
      yield* addGame('garden', "The Witch's Garden")
      yield* addGame('star', 'Starfall Village Tale')

      yield* addRun('dawn', 'run-1', {
        status: 'partial',
        startedAt: '2026-10-21T10:00:00.000Z',
        lines: { total: 100, translated: 70 },
        stopped: true,
      })

      yield* addRun('star', 'run-2', {
        status: 'failed',
        startedAt: '2026-10-20T10:00:00.000Z',
        error: 'Timed out',
      })

      yield* addRun('star', 'run-3', {
        status: 'translated',
        startedAt: '2026-10-22T10:00:00.000Z',
      })

      yield* addRun('garden', 'run-4', {
        status: 'partial',
        startedAt: '2026-10-23T10:00:00.000Z',
        lines: { total: 3, translated: 3 },
      })

      yield* addLines('garden', [
        { change: 'changed' },
        { change: 'new' },
        { translated: true, skipped: true },
      ])

      yield* sql`INSERT INTO game_updates ${sql.insert({
        id: 'update-1',
        game_id: 'garden',
        detected_at: '2026-10-25T09:00:00.000Z',
        report: '{}',
      })}`

      yield* sql`INSERT INTO llm_connections ${sql.insert([
        {
          id: 'c1',
          name: 'DeepSeek',
          name_key: 'deepseek',
          provider: 'deepseek',
          api_key: 'x',
          verification: 'failed',
          verification_message: 'The API key was rejected.',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'c2',
          name: 'Gemini',
          name_key: 'gemini',
          provider: 'google',
          api_key: 'x',
          verification: 'verified',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
      ])}`

      assert.deepStrictEqual(yield* dashboard.dashboardAttention(), [
        new RunStopped({
          gameId: 'dawn',
          title: 'Labyrinth of Dawn',
          status: 'partial',
          stoppedAtLimit: true,
          linesLeft: 30,
          at: '2026-10-21T10:00:00.000Z',
        }),
        new GameUpdated({
          gameId: 'garden',
          title: "The Witch's Garden",
          lines: 2,
          at: '2026-10-25T09:00:00.000Z',
        }),
        new LinesSkipped({ gameId: 'garden', title: "The Witch's Garden", lines: 1 }),
        new ConnectionFailed({
          connectionId: 'c1',
          name: 'DeepSeek',
          message: 'The API key was rejected.',
        }),
      ])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('keeps line counts right as lines are translated, changed and removed', () =>
    Effect.gen(function* () {
      const dashboard = yield* client
      const sql = yield* SqlClient.SqlClient

      yield* addGame('dawn', 'Labyrinth of Dawn')
      yield* addLines('dawn', [{}, { change: 'new' }, { translated: true, skipped: true }, {}])

      yield* sql`
        UPDATE translation_lines SET translated_text = 'Hello', change = NULL
        WHERE game_id = 'dawn' AND entry_id IN ('Map001.json::0', 'Map001.json::1')
      `

      yield* sql`UPDATE translation_lines SET write_skipped = NULL WHERE game_id = 'dawn'`
      yield* sql`DELETE FROM translation_lines WHERE entry_id = 'Map001.json::3'`

      const [game] = yield* dashboard.translationProgress({ period: october })

      assert.deepInclude(game, { lines: 3, translated: 3, pending: 0, skipped: 0 })
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('asks for details matches to review and tells of watched games that came out', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const dashboard = yield* client

      yield* addGame('moon', 'Moonlit Harvest 2')
      yield* addGame('shrine', 'Shrine Maiden North')

      yield* sql`INSERT INTO game_detail_finds ${sql.insert([
        { game_id: 'moon', state: 'needs-review', updated_at: '2026-10-29T00:00:00.000Z' },
        { game_id: 'shrine', state: 'no-match', updated_at: '2026-10-29T00:00:00.000Z' },
      ])}`

      yield* sql`INSERT INTO dlsite_watched ${sql.insert([
        {
          code: 'RJ01355199',
          title: '守護戦姫スズネ',
          watched_at: '2026-10-01T00:00:00.000Z',
          released_on: '2026-10-30',
        },
        { code: 'RJ01413115', title: 'Desire Colosseum', watched_at: '2026-10-01T00:00:00.000Z' },
      ])}`

      assert.deepStrictEqual(yield* dashboard.dashboardAttention(), [
        new DetailsToReview({ games: 1 }),
        new WatchedReleased({
          code: 'RJ01355199',
          title: '守護戦姫スズネ',
          releasedOn: '2026-10-30',
        }),
      ])
    }).pipe(Effect.provide(TestLayer)),
  )
})
