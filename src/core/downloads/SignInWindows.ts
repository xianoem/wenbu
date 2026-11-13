import { Context, Deferred, Effect, Layer, Schema } from 'effect'
import { SourceSession, SourceSignIn, SourceSignOut } from '#contract/CoreMessages'
import type { SourceId } from '#contract/Downloads'

const isSourceSession = Schema.is(SourceSession)

export class SignInWindows extends Context.Service<
  SignInWindows,
  {
    readonly open: (request: Omit<SourceSignIn, '_tag'>) => Effect.Effect<SourceSession>
    readonly forget: (source: SourceId) => Effect.Effect<void>
  }
>()('wenbu/core/downloads/SignInWindows') {
  static readonly live = Layer.effect(
    SignInWindows,
    Effect.gen(function* () {
      const waiting = new Map<string, Deferred.Deferred<SourceSession>>()

      const receive = (event: Electron.MessageEvent) => {
        if (!isSourceSession(event.data)) {
          return
        }

        const deferred = waiting.get(event.data.source)

        if (deferred !== undefined) {
          waiting.delete(event.data.source)
          Deferred.doneUnsafe(deferred, Effect.succeed(event.data))
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => process.parentPort.on('message', receive)),
        () => Effect.sync(() => process.parentPort.off('message', receive)),
      )

      const post = (message: SourceSignIn | SourceSignOut) =>
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
        Effect.sync(() => process.parentPort.postMessage(message))

      const open = Effect.fn('SignInWindows.open')(function* (request: Omit<SourceSignIn, '_tag'>) {
        const existing = waiting.get(request.source)
        const deferred = existing ?? (yield* Deferred.make<SourceSession>())

        waiting.set(request.source, deferred)
        yield* post(SourceSignIn.make(request))

        return yield* Deferred.await(deferred)
      })

      return SignInWindows.of({
        open,
        forget: (source) => post(SourceSignOut.make({ source })),
      })
    }),
  )
}
