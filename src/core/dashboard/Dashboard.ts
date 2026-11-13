import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  type AttentionItem,
  ConnectionFailed,
  DashboardRpc,
  type DayRange,
  type GameProgress,
  DetailsToReview,
  GameUpdated,
  LinesSkipped,
  RunStopped,
  type UsageTotals,
  WatchedReleased,
} from '#contract/Dashboard'
import type { RunStatus } from '#contract/GameTranslation'
import type { GameEngine } from '#contract/Library'
import type { UsageFeature } from '#contract/Llm'

const TOP_GAMES = 5

interface LineCounts {
  readonly gameId: string
  readonly title: string
  readonly engine: GameEngine
  readonly lines: number
  readonly translated: number
  readonly pending: number
  readonly skipped: number
}

interface LastRun {
  readonly gameId: string
  readonly title: string
  readonly status: RunStatus
  readonly startedAt: string
  readonly stoppedAtLimit: number
  readonly total: number | null
  readonly translated: number | null
  readonly error: string | null
}

export const DashboardRpcLive = DashboardRpc.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const inRange = (range: DayRange) => sql`day BETWEEN ${range.from} AND ${range.to}`

    const totalsOf = (range: DayRange) =>
      sql<UsageTotals>`
        SELECT
          COALESCE(SUM(requests), 0) AS requests,
          COALESCE(SUM(input_tokens), 0) AS "inputTokens",
          COALESCE(SUM(output_tokens), 0) AS "outputTokens",
          COALESCE(SUM(cost_usd), 0) AS "costUsd",
          COALESCE(SUM(CASE WHEN unpriced_requests > 0 THEN input_tokens + output_tokens END), 0)
            AS "unpricedTokens"
        FROM llm_usage WHERE ${inRange(range)}
      `.pipe(
        Effect.map(
          ([row]) =>
            row ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedTokens: 0 },
        ),
      )

    const days = (range: DayRange) =>
      sql<{
        readonly day: string
        readonly feature: UsageFeature
        readonly costUsd: number
        readonly tokens: number
      }>`
        SELECT day, feature, SUM(cost_usd) AS "costUsd",
          SUM(input_tokens + output_tokens) AS tokens
        FROM llm_usage WHERE ${inRange(range)}
        GROUP BY day, feature ORDER BY day, feature
      `

    const presets = (range: DayRange) =>
      sql<{
        readonly presetName: string
        readonly modelId: string
        readonly requests: number
        readonly tokens: number
        readonly costUsd: number
        readonly unpriced: number
      }>`
        SELECT preset_name AS "presetName", model_id AS "modelId", SUM(requests) AS requests,
          SUM(input_tokens + output_tokens) AS tokens, SUM(cost_usd) AS "costUsd",
          SUM(unpriced_requests) > 0 AS unpriced
        FROM llm_usage WHERE ${inRange(range)}
        GROUP BY preset_name, model_id ORDER BY "costUsd" DESC, tokens DESC
      `.pipe(Effect.map((rows) => rows.map((row) => ({ ...row, unpriced: row.unpriced === 1 }))))

    const games = Effect.fnUntraced(function* (range: DayRange) {
      const top = yield* sql<{
        readonly gameId: string
        readonly title: string | null
        readonly tokens: number
        readonly costUsd: number
      }>`
        SELECT u.game_id AS "gameId", g.title, SUM(u.input_tokens + u.output_tokens) AS tokens,
          SUM(u.cost_usd) AS "costUsd"
        FROM llm_usage u LEFT JOIN games g ON g.id = u.game_id
        WHERE ${inRange(range)} AND u.game_id <> ''
        GROUP BY u.game_id ORDER BY "costUsd" DESC, tokens DESC LIMIT ${TOP_GAMES}
      `

      const [noGame] = yield* sql<{ readonly tokens: number | null; readonly costUsd: number }>`
        SELECT SUM(input_tokens + output_tokens) AS tokens, COALESCE(SUM(cost_usd), 0) AS "costUsd"
        FROM llm_usage WHERE ${inRange(range)} AND game_id = ''
      `

      const withTitles = top.map((row) => ({
        gameId: row.gameId,
        title: row.title ?? 'Removed game',
        tokens: row.tokens,
        costUsd: row.costUsd,
      }))

      if (noGame === undefined || noGame.tokens === null) {
        return withTitles
      }

      return [...withTitles, { title: 'No game', tokens: noGame.tokens, costUsd: noGame.costUsd }]
    })

    const lineCounts = sql<LineCounts>`
      SELECT g.id AS "gameId", g.title, g.engine, c.lines, c.translated, c.pending, c.skipped
      FROM translation_line_counts c JOIN games g ON g.id = c.game_id
      WHERE c.lines > 0
    `

    const lastRuns = sql<LastRun>`
      SELECT r.game_id AS "gameId", g.title, r.status, r.started_at AS "startedAt",
        COALESCE(json_extract(r.run, '$.stopped.reason') = 'spend-limit', 0) AS "stoppedAtLimit",
        json_extract(r.run, '$.lines.total') AS total,
        json_extract(r.run, '$.lines.translated') AS translated,
        json_extract(r.run, '$.error') AS error
      FROM translation_runs r JOIN games g ON g.id = r.game_id
      WHERE r.started_at = (
        SELECT MAX(started_at) FROM translation_runs WHERE game_id = r.game_id
      )
      ORDER BY r.started_at DESC
    `

    const gameSpend = (range: DayRange) =>
      sql<{ readonly gameId: string; readonly costUsd: number }>`
        SELECT game_id AS "gameId", SUM(cost_usd) AS "costUsd"
        FROM llm_usage WHERE ${inRange(range)} AND game_id <> ''
        GROUP BY game_id
      `

    const progress = Effect.fnUntraced(function* (range: DayRange) {
      const [counts, runs, spend] = yield* Effect.all([lineCounts, lastRuns, gameSpend(range)], {
        concurrency: 'unbounded',
      })

      const runOf = new Map(runs.map((run) => [run.gameId, run]))
      const costOf = new Map(spend.map((row) => [row.gameId, row.costUsd]))

      const order = (game: LineCounts) => runOf.get(game.gameId)?.startedAt ?? ''

      return counts
        .toSorted(
          (left, right) =>
            order(right).localeCompare(order(left)) || left.title.localeCompare(right.title),
        )
        .map((game): GameProgress => {
          const run = runOf.get(game.gameId)

          return {
            ...game,
            ...(run === undefined
              ? {}
              : {
                  lastRun: {
                    status: run.status,
                    stoppedAtLimit: run.stoppedAtLimit === 1,
                    startedAt: run.startedAt,
                  },
                }),
            costUsd: costOf.get(game.gameId) ?? 0,
          }
        })
    })

    const stoppedRuns = Effect.map(lastRuns, (runs) =>
      runs.flatMap((run): ReadonlyArray<AttentionItem> => {
        const linesLeft = Math.max(0, (run.total ?? 0) - (run.translated ?? 0))
        const stoppedAtLimit = run.stoppedAtLimit === 1

        const stopped =
          run.status === 'failed' || (run.status === 'partial' && (stoppedAtLimit || linesLeft > 0))

        if (!stopped) {
          return []
        }

        return [
          new RunStopped({
            gameId: run.gameId,
            title: run.title,
            status: run.status,
            stoppedAtLimit,
            linesLeft,
            at: run.startedAt,
            ...(run.error === null ? {} : { error: run.error }),
          }),
        ]
      }),
    )

    const updates = sql<{ readonly gameId: string; readonly at: string }>`
      SELECT game_id AS "gameId", MAX(detected_at) AS at FROM game_updates GROUP BY game_id
    `

    const failedConnections = sql<{
      readonly connectionId: string
      readonly name: string
      readonly message: string | null
    }>`
      SELECT id AS "connectionId", name, verification_message AS message
      FROM llm_connections WHERE verification = 'failed' ORDER BY name
    `

    const detailsToReview = sql<{ readonly games: number }>`
      SELECT COUNT(*) AS games FROM game_detail_finds f
      JOIN games g ON g.id = f.game_id WHERE f.state = 'needs-review'
    `

    const watchedReleased = sql<{
      readonly code: string
      readonly title: string
      readonly releasedOn: string
    }>`
      SELECT code, title, released_on AS "releasedOn" FROM dlsite_watched
      WHERE released_on IS NOT NULL ORDER BY released_on DESC
    `

    const attention = Effect.fnUntraced(function* () {
      const [runs, counts, updated, connections, review, released] = yield* Effect.all(
        [stoppedRuns, lineCounts, updates, failedConnections, detailsToReview, watchedReleased],
        { concurrency: 'unbounded' },
      )

      const updatedAt = new Map(updated.map((row) => [row.gameId, row.at]))

      const gameUpdates = counts.flatMap((game): ReadonlyArray<AttentionItem> => {
        const at = updatedAt.get(game.gameId)

        if (game.pending === 0 || at === undefined) {
          return []
        }

        return [
          new GameUpdated({ gameId: game.gameId, title: game.title, lines: game.pending, at }),
        ]
      })

      const skipped = counts.flatMap((game): ReadonlyArray<AttentionItem> =>
        game.skipped === 0
          ? []
          : [new LinesSkipped({ gameId: game.gameId, title: game.title, lines: game.skipped })],
      )

      const failed = connections.map(
        (connection) =>
          new ConnectionFailed({
            connectionId: connection.connectionId,
            name: connection.name,
            ...(connection.message === null ? {} : { message: connection.message }),
          }),
      )

      const toReview =
        (review[0]?.games ?? 0) === 0 ? [] : [new DetailsToReview({ games: review[0]?.games ?? 0 })]

      const out = released.map((work) => new WatchedReleased(work))

      return [...runs, ...gameUpdates, ...skipped, ...failed, ...toReview, ...out]
    })

    return DashboardRpc.of({
      dashboardUsage: Effect.fn('Dashboard.usage')(function* ({ period, previous }) {
        const [totals, before, perDay, perPreset, perGame] = yield* Effect.all(
          [totalsOf(period), totalsOf(previous), days(period), presets(period), games(period)],
          { concurrency: 'unbounded' },
        )

        return { totals, previous: before, days: perDay, presets: perPreset, games: perGame }
      }, Effect.orDie),
      translationProgress: Effect.fn('Dashboard.translationProgress')(function* ({ period }) {
        return yield* progress(period)
      }, Effect.orDie),
      dashboardAttention: Effect.fn('Dashboard.attention')(function* () {
        return yield* attention()
      }, Effect.orDie),
    })
  }),
)
