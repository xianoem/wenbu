import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { GameEngine } from './Library'

export const liveControlsHotkey = 'F10'

export const characterSpeeds = [0.5, 0.75, 1, 1.5, 2, 3] as const

export const CharacterSpeed = Schema.Literals(characterSpeeds)

export type CharacterSpeed = typeof CharacterSpeed.Type

export const dialogueFontSizes = { min: 6, max: 48 } as const

export const HpMode = Schema.Literals(['none', 'god', 'killable'])

export type HpMode = typeof HpMode.Type

export const HookedControl = Schema.Literals([
  'hpMode',
  'oneHit',
  'fontSize',
  'speed',
  'wordWrap',
  'inGameText',
  'imageText',
])

export type HookedControl = typeof HookedControl.Type

export const UnsupportedControl = Schema.Struct({ control: HookedControl, reason: Schema.String })

export type UnsupportedControl = typeof UnsupportedControl.Type

export const LiveControlsStatus = Schema.Literals([
  'idle',
  'connecting',
  'connected',
  'disconnected',
  'stopped',
])

export type LiveControlsStatus = typeof LiveControlsStatus.Type

export const LiveControlsState = Schema.Struct({
  status: LiveControlsStatus,
  message: Schema.String,
  canRetry: Schema.Boolean,
  gameId: Schema.optional(Schema.String),
  gameTitle: Schema.optional(Schema.String),
  ready: Schema.Boolean,
  hpMode: HpMode,
  gold: Schema.Number,
  maxGold: Schema.Number,
  dialogueFontSize: Schema.Int,
  defaultFontSize: Schema.Int,
  characterSpeed: CharacterSpeed,
  unsupported: Schema.Array(UnsupportedControl),
})

export type LiveControlsState = typeof LiveControlsState.Type

export const idleLiveControls: LiveControlsState = {
  status: 'idle',
  message: 'Launch an RPG Maker game from Wenbu to control it live.',
  canRetry: false,
  ready: false,
  hpMode: 'none',
  gold: 0,
  maxGold: 0,
  dialogueFontSize: 0,
  defaultFontSize: 0,
  characterSpeed: 1,
  unsupported: [],
}

export const supportsLiveControls = (engine: GameEngine) => engine !== 'windows'

export const attachesToRunningGame = (engine: GameEngine) =>
  engine === 'rpg-maker-xp' || engine === 'rpg-maker-vx' || engine === 'rpg-maker-vx-ace'

export const ActorSummary = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  nickname: Schema.String,
})

export type ActorSummary = typeof ActorSummary.Type

export const ActorStat = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  value: Schema.Number,
})

export type ActorStat = typeof ActorStat.Type

export const Actor = Schema.Struct({
  ...ActorSummary.fields,
  stats: Schema.Array(ActorStat),
})

export type Actor = typeof Actor.Type

export const InventoryKind = Schema.Literals(['item', 'weapon', 'armor'])

export type InventoryKind = typeof InventoryKind.Type

export const InventoryEntry = Schema.Struct({
  kind: InventoryKind,
  id: Schema.Int,
  name: Schema.String,
  description: Schema.String,
  quantity: Schema.Int,
})

export type InventoryEntry = typeof InventoryEntry.Type

export const SwitchEntry = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  value: Schema.Boolean,
})

export type SwitchEntry = typeof SwitchEntry.Type

export const VariableValue = Schema.Union([Schema.Number, Schema.String, Schema.Boolean])

export type VariableValue = typeof VariableValue.Type

export const VariableEntry = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  value: VariableValue,
})

export type VariableEntry = typeof VariableEntry.Type

export class LiveControlsError extends Schema.TaggedError<LiveControlsError>()(
  'LiveControlsError',
  {
    reason: Schema.Literals(['not-connected', 'not-ready', 'invalid', 'unsupported', 'failed']),
    message: Schema.String,
  },
) {}

export class LiveControlsRpc extends RpcGroup.make(
  Rpc.make('watchLiveControls', { success: LiveControlsState, stream: true }),
  Rpc.make('attachLiveControls', {
    payload: { gameId: Schema.String, processId: Schema.Int },
    error: LiveControlsError,
  }),
  Rpc.make('retryLiveControls', { error: LiveControlsError }),
  Rpc.make('stopLiveControls'),
  Rpc.make('setHpMode', { payload: { mode: HpMode }, error: LiveControlsError }),
  Rpc.make('setGold', { payload: { gold: Schema.Number }, error: LiveControlsError }),
  Rpc.make('setDialogueFontSize', { payload: { size: Schema.Number }, error: LiveControlsError }),
  Rpc.make('setCharacterSpeed', { payload: { speed: CharacterSpeed }, error: LiveControlsError }),
  Rpc.make('resetLiveControls', { error: LiveControlsError }),
  Rpc.make('listActors', { success: Schema.Array(ActorSummary), error: LiveControlsError }),
  Rpc.make('getActor', {
    payload: { actorId: Schema.Int },
    success: Actor,
    error: LiveControlsError,
  }),
  Rpc.make('setActorStat', {
    payload: { actorId: Schema.Int, key: Schema.String, value: Schema.Number },
    success: Actor,
    error: LiveControlsError,
  }),
  Rpc.make('listInventory', { success: Schema.Array(InventoryEntry), error: LiveControlsError }),
  Rpc.make('setInventoryQuantity', {
    payload: { kind: InventoryKind, id: Schema.Int, quantity: Schema.Number },
    success: InventoryEntry,
    error: LiveControlsError,
  }),
  Rpc.make('listSwitches', { success: Schema.Array(SwitchEntry), error: LiveControlsError }),
  Rpc.make('setSwitch', {
    payload: { id: Schema.Int, value: Schema.Boolean },
    success: SwitchEntry,
    error: LiveControlsError,
  }),
  Rpc.make('listVariables', { success: Schema.Array(VariableEntry), error: LiveControlsError }),
  Rpc.make('setVariable', {
    payload: { id: Schema.Int, value: VariableValue },
    success: VariableEntry,
    error: LiveControlsError,
  }),
) {}
