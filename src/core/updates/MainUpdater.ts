import { Context, Effect, Layer, Queue, Schema, Stream, SubscriptionRef } from 'effect'
import { UpdateInstall, UpdateWatch } from '#contract/CoreMessages'
import { UpdateStatus } from '#contract/Updates'

const isUpdateStatus = Schema.is(UpdateStatus)

export class MainUpdater extends Context.Service<
  MainUpdater,
  {
    readonly status: Stream.Stream<UpdateStatus>
    readonly install: Effect.Effect<void>
  }
>()('wenbu/core/updates/MainUpdater') {
  static readonly fixed = (status: UpdateStatus) =>
    Layer.succeed(
      MainUpdater,
      MainUpdater.of({ status: Stream.make(status), install: Effect.void }),
    )

  static readonly live = Layer.effect(
    MainUpdater,
    Effect.gen(function* () {
      const status = yield* SubscriptionRef.make(UpdateStatus.make({ state: 'idle' }))
      const reported = yield* Queue.sliding<UpdateStatus>(8)

      const receive = (event: Electron.MessageEvent) => {
        if (isUpdateStatus(event.data)) {
          Queue.offerUnsafe(reported, event.data)
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => process.parentPort.on('message', receive)),
        () => Effect.sync(() => process.parentPort.off('message', receive)),
      )

      yield* Stream.fromQueue(reported).pipe(
        Stream.runForEach((latest) => SubscriptionRef.set(status, latest)),
        Effect.forkScoped,
      )

      const post = (message: UpdateWatch | UpdateInstall) =>
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
        Effect.sync(() => process.parentPort.postMessage(message))

      yield* post(UpdateWatch.make({}))

      return MainUpdater.of({
        status: SubscriptionRef.changes(status),
        install: post(UpdateInstall.make({})),
      })
    }),
  )
}
