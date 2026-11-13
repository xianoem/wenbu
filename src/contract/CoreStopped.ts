import { Schema } from 'effect'

export const CoreStopped = Schema.Struct({
  crashes: Schema.Number,
  withinMillis: Schema.Number,
  exitCode: Schema.Number,
})

export type CoreStopped = typeof CoreStopped.Type
