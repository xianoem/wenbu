import { Schema } from 'effect'

export const GlossaryEntryKind = Schema.Literals(['character', 'place', 'item', 'skill', 'other'])

export type GlossaryEntryKind = typeof GlossaryEntryKind.Type

export const GameGlossaryEntry = Schema.Struct({
  id: Schema.String,
  kind: GlossaryEntryKind,
  original: Schema.String,
  translation: Schema.String,
  /** How a character talks, or how a term is used. */
  note: Schema.String,
  /** Speaker keys that identify a character, such as `name:リナ` or `face:Actor1:0`. */
  speakers: Schema.Array(Schema.String),
  lines: Schema.Int,
})

export type GameGlossaryEntry = typeof GameGlossaryEntry.Type

export const GameGlossary = Schema.Struct({
  gameId: Schema.String,
  enabled: Schema.Boolean,
  preparedAt: Schema.optional(Schema.String),
  costUsd: Schema.optional(Schema.Finite),
  entries: Schema.Array(GameGlossaryEntry),
})

export type GameGlossary = typeof GameGlossary.Type

export const GlossaryEntryInput = Schema.Struct({
  kind: GlossaryEntryKind,
  original: Schema.String,
  translation: Schema.String,
  note: Schema.String,
})

export type GlossaryEntryInput = typeof GlossaryEntryInput.Type

export const GlossaryCost = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.optional(Schema.Finite),
})

export type GlossaryCost = typeof GlossaryCost.Type

export const GlossaryEstimate = Schema.Struct({
  enabled: Schema.Boolean,
  prepared: Schema.Boolean,
  prepare: GlossaryCost,
  extraInputTokens: Schema.Int,
  extraCostUsd: Schema.optional(Schema.Finite),
  baseCostUsd: Schema.optional(Schema.Finite),
})

export type GlossaryEstimate = typeof GlossaryEstimate.Type
