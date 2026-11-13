import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const reserveBytes = 512 * 1024 * 1024

export const lowBytes = 2 * 1024 * 1024 * 1024

export const SpaceLevel = Schema.Literals(['ok', 'low', 'critical'])

export type SpaceLevel = typeof SpaceLevel.Type

export const DriveSpace = Schema.Struct({
  drive: Schema.String,
  freeBytes: Schema.Number,
  totalBytes: Schema.Number,
  level: SpaceLevel,
})

export type DriveSpace = typeof DriveSpace.Type

export const levelOf = (freeBytes: number): SpaceLevel => {
  if (freeBytes < reserveBytes) {
    return 'critical'
  }

  return freeBytes < lowBytes ? 'low' : 'ok'
}

export const driveLabel = (drive: string) => drive.replace(/^([A-Za-z]:)[\\/]$/, '$1')

/** `neededBytes` is 0 when the drive filled up midway. */
export const SpaceShortfall = Schema.Struct({
  drive: Schema.String,
  neededBytes: Schema.Number,
  freeBytes: Schema.Number,
})

export type SpaceShortfall = typeof SpaceShortfall.Type

export class NotEnoughSpace extends Schema.TaggedError<NotEnoughSpace>()(
  'NotEnoughSpace',
  SpaceShortfall.fields,
) {
  get shortfall(): SpaceShortfall {
    return { drive: this.drive, neededBytes: this.neededBytes, freeBytes: this.freeBytes }
  }

  override get message() {
    return `There isn't enough space on ${driveLabel(this.drive)}. Free up some space and try again.`
  }
}

export class StorageRpc extends RpcGroup.make(
  Rpc.make('watchStorage', { success: Schema.Array(DriveSpace), stream: true }),
) {}
