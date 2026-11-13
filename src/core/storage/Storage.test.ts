import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Stream } from 'effect'
import { RpcTest } from 'effect/rpc'
import { StorageRpc } from '#contract/Storage'
import { DiskSpace } from '../platform/DiskSpace'
import { StorageRpcLive } from './Storage'

const gb = 1024 ** 3

const TestLayer = StorageRpcLive.pipe(
  Layer.provideMerge(DiskSpace.fixed(gb)),
  Layer.provideMerge(NodeServices.layer),
)

describe('Storage', () => {
  it.effect('streams the space left on each drive Wenbu writes to', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(StorageRpc)
      const disk = yield* DiskSpace

      yield* Effect.ignore(disk.ensure('D:\\Downloads', 0))

      const drives = yield* client.watchStorage().pipe(Stream.runHead)

      expect(Option.getOrThrow(drives)).toContainEqual({
        drive: 'D:\\',
        freeBytes: gb,
        totalBytes: 2 * gb,
        level: 'low',
      })
    }).pipe(Effect.provide(TestLayer)),
  )
})
