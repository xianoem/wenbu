import { Deferred, Effect, Ref } from 'effect'
import { LiveControlsError } from '#contract/LiveControls'
import { connectionLost } from './GameRuntime'

export const makeRequests = <A>() =>
  Effect.gen(function* () {
    const nextId = yield* Ref.make(1)
    const pending = yield* Ref.make(new Map<number, Deferred.Deferred<A>>())
    const lost = yield* Deferred.make<void>()

    const forget = (id: number) =>
      Ref.update(pending, (waiting) => {
        const next = new Map(waiting)

        next.delete(id)

        return next
      })

    const settle = (id: number, reply: A) =>
      Effect.flatMap(Ref.get(pending), (waiting) => {
        const waiter = waiting.get(id)

        return waiter === undefined ? Effect.void : Deferred.succeed(waiter, reply)
      })

    const whenLost = Effect.andThen(Deferred.await(lost), Effect.fail(connectionLost()))

    const request = Effect.fnUntraced(function* (
      send: (id: number) => Effect.Effect<void, LiveControlsError>,
    ) {
      const id = yield* Ref.getAndUpdate(nextId, (value) => value + 1)
      const reply = yield* Deferred.make<A>()

      yield* Ref.update(pending, (waiting) => new Map(waiting).set(id, reply))

      return yield* send(id).pipe(
        Effect.andThen(Deferred.await(reply)),
        Effect.raceFirst(whenLost),
        Effect.timeoutOrElse({
          duration: '15 seconds',
          orElse: () =>
            Effect.fail(
              new LiveControlsError({
                reason: 'failed',
                message: 'The game did not answer in time.',
              }),
            ),
        }),
        Effect.ensuring(forget(id)),
      )
    })

    return {
      request,
      settle,
      close: Deferred.succeed(lost, undefined),
      lost: Deferred.await(lost),
      whenLost,
    }
  })
