// Effect's FileSystem has no way to read a drive's free space.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { statfs } from 'node:fs/promises'
import {
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Predicate,
  Schedule,
  Stream,
  SubscriptionRef,
} from 'effect'
import {
  type DriveSpace,
  levelOf,
  NotEnoughSpace,
  reserveBytes,
  type SpaceLevel,
} from '#contract/Storage'

export interface DriveStats {
  readonly freeBytes: number
  readonly totalBytes: number
}

export type StatDrive = (drive: string) => Effect.Effect<Option.Option<DriveStats>>

const statWithNode: StatDrive = (drive) =>
  Effect.tryPromise(() => statfs(drive)).pipe(
    Effect.map((stats) =>
      Option.some({
        freeBytes: stats.bavail * stats.bsize,
        totalBytes: stats.blocks * stats.bsize,
      }),
    ),
    Effect.orElseSucceed(() => Option.none<DriveStats>()),
  )

const isDiskFull = (error: PlatformError.PlatformError) =>
  Predicate.hasProperty(error.reason, 'cause') &&
  Predicate.hasProperty(error.reason.cause, 'code') &&
  error.reason.cause.code === 'ENOSPC'

export const nextFileBytes = 64 * 1024 ** 2

export const folderSize = Effect.fn('folderSize')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(folder, { recursive: true })
  let size = 0

  for (const entry of entries) {
    const info = yield* fs.stat(path.join(folder, entry))

    size += info.type === 'File' ? Number(info.size) : 0
  }

  return size
})

export interface DiskSpaceOptions {
  readonly stat: StatDrive
  readonly dataFolder?: string
  readonly every?: Schedule.Schedule<unknown>
}

export class DiskSpace extends Context.Service<
  DiskSpace,
  {
    readonly ensure: (target: string, bytes: number) => Effect.Effect<void, NotEnoughSpace>
    readonly refine: (
      target: string,
    ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | NotEnoughSpace, R>
    readonly levelOf: (target: string) => Effect.Effect<SpaceLevel>
    readonly dataLevel: Effect.Effect<SpaceLevel>
    readonly drives: Stream.Stream<ReadonlyArray<DriveSpace>>
  }
>()('wenbu/core/platform/DiskSpace') {
  static readonly layerWith = (options: DiskSpaceOptions) =>
    Layer.effect(
      DiskSpace,
      Effect.gen(function* () {
        const path = yield* Path.Path
        const known = yield* SubscriptionRef.make<ReadonlyMap<string, DriveSpace>>(new Map())

        const driveOf = (target: string) => path.parse(path.resolve(target)).root

        const read = Effect.fnUntraced(function* (drive: string) {
          const stats = yield* options.stat(drive)

          if (Option.isNone(stats)) {
            return Option.none<DriveSpace>()
          }

          const space: DriveSpace = { drive, ...stats.value, level: levelOf(stats.value.freeBytes) }

          yield* SubscriptionRef.update(known, (drives) => new Map(drives).set(drive, space))

          return Option.some(space)
        })

        const refresh = Effect.gen(function* () {
          const drives = yield* SubscriptionRef.get(known)

          yield* Effect.forEach(drives.keys(), (drive) => read(drive), { discard: true })
        })

        if (options.dataFolder !== undefined) {
          yield* read(driveOf(options.dataFolder))
        }

        yield* refresh.pipe(
          Effect.repeat(options.every ?? Schedule.spaced('30 seconds')),
          Effect.forkScoped,
        )

        const ensure = Effect.fn('DiskSpace.ensure')(function* (target: string, bytes: number) {
          const drive = driveOf(target)
          const space = yield* read(drive)

          if (Option.isSome(space) && space.value.freeBytes - bytes < reserveBytes) {
            yield* Effect.logWarning('Not enough disk space').pipe(
              Effect.annotateLogs({
                drive,
                neededBytes: bytes,
                freeBytes: space.value.freeBytes,
              }),
            )

            return yield* new NotEnoughSpace({
              drive,
              neededBytes: bytes,
              freeBytes: space.value.freeBytes,
            })
          }
        })

        const refine =
          (target: string) =>
          <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.catchIf(
                (error) => PlatformError.isPlatformError(error) && isDiskFull(error),
                () =>
                  Effect.gen(function* () {
                    const drive = driveOf(target)
                    const space = yield* read(drive)

                    const freeBytes = Option.match(space, {
                      onNone: () => 0,
                      onSome: (found) => found.freeBytes,
                    })

                    return yield* new NotEnoughSpace({ drive, neededBytes: 0, freeBytes })
                  }),
              ),
            )

        const levelAt = (target: string) =>
          Effect.map(
            SubscriptionRef.get(known),
            (drives) => drives.get(driveOf(target))?.level ?? 'ok',
          )

        return DiskSpace.of({
          ensure,
          refine,
          levelOf: levelAt,
          dataLevel:
            options.dataFolder === undefined ? Effect.succeed('ok') : levelAt(options.dataFolder),
          drives: SubscriptionRef.changes(known).pipe(Stream.map((drives) => [...drives.values()])),
        })
      }),
    )

  static readonly fixed = (freeBytes: number) =>
    DiskSpace.layerWith({
      stat: () => Effect.succeed(Option.some({ freeBytes, totalBytes: freeBytes * 2 })),
      dataFolder: '.',
    })

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const dataDir = yield* Config.String('WENBU_DATA_DIR')

      return DiskSpace.layerWith({ stat: statWithNode, dataFolder: dataDir })
    }),
  )
}
