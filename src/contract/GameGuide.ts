import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const FactStatus = Schema.Literals(['open', 'needs', 'later', 'passed', 'unknown'])

export type FactStatus = typeof FactStatus.Type

export const FactKind = Schema.Literals([
  'gives',
  'takes',
  'sells',
  'drops',
  'fights',
  'leads-to',
  'sets',
  'joins',
  'leaves',
  'person',
  'dialogue',
  'script',
])

export type FactKind = typeof FactKind.Type

export const SubjectKind = Schema.Literals([
  'item',
  'weapon',
  'armor',
  'gold',
  'enemy',
  'troop',
  'switch',
  'variable',
  'actor',
])

export type SubjectKind = typeof SubjectKind.Type

export const GuideSubject = Schema.Struct({
  kind: SubjectKind,
  id: Schema.Int,
  name: Schema.String,
})

export type GuideSubject = typeof GuideSubject.Type

export const GuidePlace = Schema.Struct({
  mapId: Schema.Int,
  mapName: Schema.String,
  eventId: Schema.optional(Schema.Int),
  eventName: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Int),
  y: Schema.optional(Schema.Int),
})

export type GuidePlace = typeof GuidePlace.Type

export const GateItem = Schema.Struct({
  text: Schema.String,
  holds: Schema.optional(Schema.Boolean),
})

export type GateItem = typeof GateItem.Type

export const GameFact = Schema.Struct({
  id: Schema.String,
  kind: FactKind,
  summary: Schema.String,
  place: Schema.optional(GuidePlace),
  subject: Schema.optional(GuideSubject),
  amount: Schema.optional(Schema.Number),
  to: Schema.optional(GuidePlace),
  gate: Schema.Array(GateItem),
  status: FactStatus,
  text: Schema.optional(Schema.String),
})

export type GameFact = typeof GameFact.Type

export const GuideIndexStatus = Schema.Literals(['none', 'building', 'ready', 'failed'])

export type GuideIndexStatus = typeof GuideIndexStatus.Type

export const GuideIndexState = Schema.Struct({
  status: GuideIndexStatus,
  message: Schema.String,
  maps: Schema.Int,
  events: Schema.Int,
  facts: Schema.Int,
  lines: Schema.Int,
})

export type GuideIndexState = typeof GuideIndexState.Type

export const SketchMarkKind = Schema.Literals([
  'person',
  'thing',
  'shop',
  'exit',
  'battle',
  'other',
])

export type SketchMarkKind = typeof SketchMarkKind.Type

export const SketchMark = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  kind: SketchMarkKind,
  label: Schema.String,
  status: FactStatus,
})

export type SketchMark = typeof SketchMark.Type

export const MapSketch = Schema.Struct({
  mapId: Schema.Int,
  name: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  /** One bit per tile, row by row, base64: set where the player can walk. */
  passable: Schema.optional(Schema.String),
  marks: Schema.Array(SketchMark),
  route: Schema.Array(Schema.String),
  player: Schema.optional(Schema.Struct({ x: Schema.Int, y: Schema.Int })),
  target: Schema.optional(Schema.Struct({ x: Schema.Int, y: Schema.Int })),
})

export type MapSketch = typeof MapSketch.Type

export const GuideHere = Schema.Struct({
  mapId: Schema.Int,
  mapName: Schema.String,
  x: Schema.Int,
  y: Schema.Int,
  inBattle: Schema.Boolean,
  around: Schema.Array(GameFact),
  next: Schema.Array(GameFact),
  enemies: Schema.Array(GameFact),
})

export type GuideHere = typeof GuideHere.Type

export const FinderSubject = Schema.Struct({
  subject: GuideSubject,
  description: Schema.String,
  held: Schema.optional(Schema.Int),
  facts: Schema.Array(GameFact),
})

export type FinderSubject = typeof FinderSubject.Type

export const FinderResults = Schema.Struct({
  query: Schema.String,
  subjects: Schema.Array(FinderSubject),
  people: Schema.Array(GameFact),
  places: Schema.Array(GameFact),
  dialogue: Schema.Array(GameFact),
})

export type FinderResults = typeof FinderResults.Type

export const GuideAnswer = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  text: Schema.String,
  facts: Schema.Array(GameFact),
  sketch: Schema.optional(MapSketch),
  modelName: Schema.String,
  seconds: Schema.Number,
  costUsd: Schema.optional(Schema.Number),
})

export type GuideAnswer = typeof GuideAnswer.Type

export const AskEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('step'), label: Schema.String }),
  Schema.Struct({ type: Schema.Literal('answer'), answer: GuideAnswer }),
])

export type AskEvent = typeof AskEvent.Type

export const GuideSettings = Schema.Struct({
  presetId: Schema.String,
})

export type GuideSettings = typeof GuideSettings.Type

export const defaultGuideSettings: GuideSettings = { presetId: '' }

export class GameGuideError extends Schema.TaggedError<GameGuideError>()('GameGuideError', {
  reason: Schema.Literals(['not-connected', 'not-ready', 'no-index', 'no-preset', 'failed']),
  message: Schema.String,
}) {}

export class GameGuideRpc extends RpcGroup.make(
  Rpc.make('watchGuideIndex', { success: GuideIndexState, stream: true }),
  Rpc.make('rebuildGuideIndex', { error: GameGuideError }),
  Rpc.make('guideHere', { success: GuideHere, error: GameGuideError }),
  Rpc.make('findInGame', {
    payload: { query: Schema.String },
    success: FinderResults,
    error: GameGuideError,
  }),
  Rpc.make('mapSketch', {
    payload: {
      mapId: Schema.Int,
      target: Schema.optional(Schema.Struct({ x: Schema.Int, y: Schema.Int })),
    },
    success: MapSketch,
    error: GameGuideError,
  }),
  Rpc.make('askGuide', {
    payload: { question: Schema.String },
    success: AskEvent,
    error: GameGuideError,
    stream: true,
  }),
  Rpc.make('guideConversation', { success: Schema.Array(GuideAnswer) }),
  Rpc.make('clearGuideConversation'),
  Rpc.make('getGuideSettings', { success: GuideSettings }),
  Rpc.make('saveGuideSettings', { payload: { settings: GuideSettings } }),
) {}
