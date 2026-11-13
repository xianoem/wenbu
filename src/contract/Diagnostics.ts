import { Schema } from 'effect'
import { Rpc, RpcGroup, RpcMiddleware } from 'effect/rpc'

export const LogLevel = Schema.Literals(['debug', 'info', 'warn', 'error', 'fatal'])

export type LogLevel = typeof LogLevel.Type

export const LogProcess = Schema.Literals(['main', 'core', 'renderer'])

export type LogProcess = typeof LogProcess.Type

export const LogEntry = Schema.Struct({
  /** Milliseconds since the epoch. */
  at: Schema.Number,
  level: LogLevel,
  process: LogProcess,
  /** Core's restart count from 1; 0 for main and the renderer. */
  run: Schema.Int,
  feature: Schema.String,
  message: Schema.String,
  fields: Schema.Record(Schema.String, Schema.String),
  cause: Schema.optional(Schema.String),
})

export type LogEntry = typeof LogEntry.Type

export const Launch = Schema.Struct({ id: Schema.String, current: Schema.Boolean })

export type Launch = typeof Launch.Type

export const LogBatch = Schema.Struct({ reset: Schema.Boolean, entries: Schema.Array(LogEntry) })

export type LogBatch = typeof LogBatch.Type

export const RendererError = Schema.Struct({
  window: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
})

export type RendererError = typeof RendererError.Type

export const ProblemCount = Schema.Struct({
  warnings: Schema.Int,
  errors: Schema.Int,
  lastError: Schema.optional(
    Schema.Struct({ at: Schema.Number, feature: Schema.String, message: Schema.String }),
  ),
})

export type ProblemCount = typeof ProblemCount.Type

export class RpcLogging extends RpcMiddleware.Service<RpcLogging>()('RpcLogging') {}

export class DiagnosticsRpc extends RpcGroup.make(
  Rpc.make('listLaunches', { success: Schema.Array(Launch) }),
  Rpc.make('watchLog', {
    payload: { launch: Schema.optional(Schema.String) },
    success: LogBatch,
    stream: true,
  }),
  Rpc.make('getVerboseLogging', { success: Schema.Boolean }),
  Rpc.make('setVerboseLogging', { payload: { verbose: Schema.Boolean } }),
  Rpc.make('reportRendererError', { payload: RendererError }),
  Rpc.make('watchProblemCount', { success: ProblemCount, stream: true }),
) {}
