import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { RunStatus } from './GameTranslation'
import { GameEngine } from './Library'
import { UsageFeature } from './Llm'

/** Local calendar days, both included, as `2026-10-29`. */
export const DayRange = Schema.Struct({ from: Schema.String, to: Schema.String })

export type DayRange = typeof DayRange.Type

export const UsageTotals = Schema.Struct({
  requests: Schema.Int,
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.Finite,
  unpricedTokens: Schema.Int,
})

export type UsageTotals = typeof UsageTotals.Type

export const DayUsage = Schema.Struct({
  day: Schema.String,
  feature: UsageFeature,
  costUsd: Schema.Finite,
  tokens: Schema.Int,
})

export type DayUsage = typeof DayUsage.Type

export const PresetUsage = Schema.Struct({
  presetName: Schema.String,
  modelId: Schema.String,
  requests: Schema.Int,
  tokens: Schema.Int,
  costUsd: Schema.Finite,
  unpriced: Schema.Boolean,
})

export type PresetUsage = typeof PresetUsage.Type

export const GameUsage = Schema.Struct({
  gameId: Schema.optional(Schema.String),
  title: Schema.String,
  tokens: Schema.Int,
  costUsd: Schema.Finite,
})

export type GameUsage = typeof GameUsage.Type

export const UsageSummary = Schema.Struct({
  totals: UsageTotals,
  previous: UsageTotals,
  days: Schema.Array(DayUsage),
  presets: Schema.Array(PresetUsage),
  games: Schema.Array(GameUsage),
})

export type UsageSummary = typeof UsageSummary.Type

export const GameProgress = Schema.Struct({
  gameId: Schema.String,
  title: Schema.String,
  engine: GameEngine,
  lines: Schema.Int,
  translated: Schema.Int,
  pending: Schema.Int,
  skipped: Schema.Int,
  lastRun: Schema.optional(
    Schema.Struct({ status: RunStatus, stoppedAtLimit: Schema.Boolean, startedAt: Schema.String }),
  ),
  costUsd: Schema.Finite,
})

export type GameProgress = typeof GameProgress.Type

export class RunStopped extends Schema.TaggedClass<RunStopped>()('RunStopped', {
  gameId: Schema.String,
  title: Schema.String,
  status: Schema.Literals(['partial', 'failed']),
  stoppedAtLimit: Schema.Boolean,
  linesLeft: Schema.Int,
  at: Schema.String,
  error: Schema.optional(Schema.String),
}) {}

export class GameUpdated extends Schema.TaggedClass<GameUpdated>()('GameUpdated', {
  gameId: Schema.String,
  title: Schema.String,
  lines: Schema.Int,
  at: Schema.String,
}) {}

export class LinesSkipped extends Schema.TaggedClass<LinesSkipped>()('LinesSkipped', {
  gameId: Schema.String,
  title: Schema.String,
  lines: Schema.Int,
}) {}

export class ConnectionFailed extends Schema.TaggedClass<ConnectionFailed>()('ConnectionFailed', {
  connectionId: Schema.String,
  name: Schema.String,
  message: Schema.optional(Schema.String),
}) {}

export class DetailsToReview extends Schema.TaggedClass<DetailsToReview>()('DetailsToReview', {
  games: Schema.Int,
}) {}

export class WatchedReleased extends Schema.TaggedClass<WatchedReleased>()('WatchedReleased', {
  code: Schema.String,
  title: Schema.String,
  releasedOn: Schema.String,
}) {}

export const AttentionItem = Schema.Union([
  RunStopped,
  GameUpdated,
  LinesSkipped,
  ConnectionFailed,
  DetailsToReview,
  WatchedReleased,
])

export type AttentionItem = typeof AttentionItem.Type

export class DashboardRpc extends RpcGroup.make(
  Rpc.make('dashboardUsage', {
    payload: { period: DayRange, previous: DayRange },
    success: UsageSummary,
  }),
  Rpc.make('translationProgress', {
    payload: { period: DayRange },
    success: Schema.Array(GameProgress),
  }),
  Rpc.make('dashboardAttention', { success: Schema.Array(AttentionItem) }),
) {}
