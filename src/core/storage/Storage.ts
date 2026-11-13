import { Effect, Layer, Stream } from 'effect'
import { driveLabel, type SpaceLevel, StorageRpc } from '#contract/Storage'
import { LogBook } from '../diagnostics/LogBook'
import { DiskSpace } from '../platform/DiskSpace'

export const StorageRpcLive = StorageRpc.toLayer(
  Effect.gen(function* () {
    const disk = yield* DiskSpace

    return StorageRpc.of({ watchStorage: () => disk.drives })
  }),
)

const LowSpaceLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const disk = yield* DiskSpace
    const book = yield* LogBook
    const levels = new Map<string, SpaceLevel>()

    yield* disk.drives.pipe(
      Stream.runForEach((drives) =>
        Effect.gen(function* () {
          for (const space of drives) {
            const before = levels.get(space.drive)

            levels.set(space.drive, space.level)

            if (before === space.level || (before === undefined && space.level === 'ok')) {
              continue
            }

            yield* Effect.logWarning('Drive space changed').pipe(
              Effect.annotateLogs({
                drive: driveLabel(space.drive),
                level: space.level,
                freeBytes: space.freeBytes,
              }),
            )
          }

          yield* book.setLowSpace((yield* disk.dataLevel) === 'critical')
        }),
      ),
      Effect.forkScoped,
    )
  }),
)

export const StorageLive = Layer.mergeAll(StorageRpcLive, LowSpaceLive)
