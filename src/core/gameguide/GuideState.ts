import { Schema } from 'effect'

const Pair = <A extends Schema.Top, B extends Schema.Top>(first: A, second: B) =>
  Schema.Tuple([first, second])

export const GuideState = Schema.Struct({
  mapId: Schema.Int,
  mapName: Schema.String,
  x: Schema.Int,
  y: Schema.Int,
  inBattle: Schema.Boolean,
  troopId: Schema.Int,
  enemies: Schema.Array(Schema.Tuple([Schema.Int, Schema.Number, Schema.Number])),
  switches: Schema.Array(Schema.Int),
  variables: Schema.Array(
    Pair(Schema.Int, Schema.Union([Schema.Number, Schema.String, Schema.Boolean])),
  ),
  selfSwitches: Schema.Array(Schema.Tuple([Schema.Int, Schema.Int, Schema.String])),
  party: Schema.Array(Schema.Int),
  items: Schema.Array(
    Schema.Tuple([Schema.Literals(['item', 'weapon', 'armor']), Schema.Int, Schema.Int]),
  ),
  gold: Schema.Number,
  playtime: Schema.Number,
  events: Schema.Array(Schema.Tuple([Schema.Int, Schema.Int, Schema.Int, Schema.Int])),
  dialogue: Schema.Array(
    Schema.Struct({ mapId: Schema.Int, speaker: Schema.String, text: Schema.String }),
  ),
})

export type GuideState = typeof GuideState.Type
