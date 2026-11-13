import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { LiveControlsError } from './LiveControls'

export const MemorySource = Schema.Literals([
  'shared-save',
  'recollection-plugin',
  'unlock-event',
  'room',
])

export type MemorySource = typeof MemorySource.Type

export const MemorySwitch = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  unlocked: Schema.Boolean,
  sources: Schema.Array(MemorySource),
  suggested: Schema.Boolean,
})

export type MemorySwitch = typeof MemorySwitch.Type

export const Memories = Schema.Struct({
  sharedSave: Schema.optional(Schema.String),
  unlockEvent: Schema.optional(Schema.String),
  rooms: Schema.Array(Schema.String),
  switches: Schema.Array(MemorySwitch),
})

export type Memories = typeof Memories.Type

export const MemoriesUnlocked = Schema.Struct({
  unlocked: Schema.Int,
  persisted: Schema.Boolean,
})

export type MemoriesUnlocked = typeof MemoriesUnlocked.Type

export class MemoriesRpc extends RpcGroup.make(
  Rpc.make('findMemories', { success: Memories, error: LiveControlsError }),
  Rpc.make('unlockMemories', {
    payload: { switchIds: Schema.Array(Schema.Int) },
    success: MemoriesUnlocked,
    error: LiveControlsError,
  }),
) {}
