import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, expect, it } from '@effect/vitest'
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  PlatformError,
  Ref,
  Schedule,
  Stream,
} from 'effect'
import { NotEnoughSpace, reserveBytes } from '#contract/Storage'
import { DiskSpace } from './DiskSpace'

const gb = 1024 ** 3

const withFree = (free: Ref.Ref<number>) =>
  DiskSpace.layerWith({
    stat: () =>
      Effect.map(Ref.get(free), (freeBytes) => Option.some({ freeBytes, totalBytes: 100 * gb })),
    dataFolder: 'C:\\Wenbu',
    every: Schedule.spaced('1 hour'),
  }).pipe(Layer.provide(NodeServices.layer))

// Node reports a full disk as `Unknown` with ENOSPC as the cause, and no test can fill a real disk.
// oxlint-disable-next-line wenbu/no-manual-tagged-construction -- SystemError takes its tag as data.
const diskFull = PlatformError.systemError({
  _tag: 'Unknown',
  module: 'FileSystem',
  method: 'writeFile',
  cause: Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
})

describe('DiskSpace', () => {
  it.effect('lets a write through when the drive keeps the reserve free', () =>
    Effect.gen(function* () {
      const disk = yield* DiskSpace

      yield* disk.ensure('C:\\Games\\Quest', gb)
    }).pipe(Effect.provide(DiskSpace.fixed(10 * gb).pipe(Layer.provide(NodeServices.layer)))),
  )

  it.effect('refuses a write that would eat into the reserve', () =>
    Effect.gen(function* () {
      const disk = yield* DiskSpace
      const exit = yield* Effect.exit(disk.ensure('C:\\Games\\Quest', gb))

      assert(Exit.isFailure(exit))

      expect(exit.cause.reasons[0]).toMatchObject({
        error: new NotEnoughSpace({
          drive: 'C:\\',
          neededBytes: gb,
          freeBytes: gb + reserveBytes / 2,
        }),
      })
    }).pipe(
      Effect.provide(
        DiskSpace.fixed(gb + reserveBytes / 2).pipe(Layer.provide(NodeServices.layer)),
      ),
    ),
  )

  it.effect('lets writes through when the drive cannot be read', () =>
    Effect.gen(function* () {
      const disk = yield* DiskSpace

      yield* disk.ensure('\\\\server\\share\\folder', 100 * gb)
    }).pipe(
      Effect.provide(
        DiskSpace.layerWith({ stat: () => Effect.succeed(Option.none()) }).pipe(
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
  )

  it.effect('turns a disk-full write error into NotEnoughSpace', () =>
    Effect.gen(function* () {
      const disk = yield* DiskSpace
      const exit = yield* Effect.exit(disk.refine('C:\\Games')(Effect.fail(diskFull)))

      assert(Exit.isFailure(exit))

      expect(exit.cause.reasons[0]).toMatchObject({
        error: new NotEnoughSpace({ drive: 'C:\\', neededBytes: 0, freeBytes: 0 }),
      })
    }).pipe(Effect.provide(DiskSpace.fixed(0).pipe(Layer.provide(NodeServices.layer)))),
  )

  it.effect('keeps other write errors as they are', () =>
    Effect.gen(function* () {
      const disk = yield* DiskSpace
      const fs = yield* FileSystem.FileSystem
      const missing = fs.readFile('C:\\wenbu-missing\\file.txt')
      const exit = yield* Effect.exit(disk.refine('C:\\wenbu-missing')(missing))

      assert(Exit.isFailure(exit))

      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBeInstanceOf(
        PlatformError.PlatformError,
      )
    }).pipe(Effect.provide(DiskSpace.fixed(10 * gb).pipe(Layer.provideMerge(NodeServices.layer)))),
  )

  it.effect('reports the level of every drive Wenbu writes to', () =>
    Effect.gen(function* () {
      const free = yield* Ref.make(10 * gb)

      yield* Effect.gen(function* () {
        const disk = yield* DiskSpace

        expect(yield* disk.levelOf('C:\\Wenbu\\logs')).toBe('ok')

        yield* Ref.set(free, gb)
        yield* disk.ensure('D:\\Downloads', 0)

        const drives = yield* disk.drives.pipe(Stream.runHead, Effect.map(Option.getOrThrow))

        expect(drives).toEqual([
          { drive: 'C:\\', freeBytes: 10 * gb, totalBytes: 100 * gb, level: 'ok' },
          { drive: 'D:\\', freeBytes: gb, totalBytes: 100 * gb, level: 'low' },
        ])

        expect(yield* disk.levelOf('D:\\Other')).toBe('low')
      }).pipe(Effect.provide(withFree(free)))
    }),
  )
})
