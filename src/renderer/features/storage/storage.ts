import { Effect, Stream } from 'effect'
import type { DriveSpace } from '#contract/Storage'
import { Core } from '#lib/rpc'

export const storageAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchStorage', undefined)
    }),
  ),
)

export const fullestDrive = (drives: ReadonlyArray<DriveSpace>) =>
  drives
    .filter((drive) => drive.level !== 'ok')
    .toSorted((left, right) => left.freeBytes - right.freeBytes)[0]
