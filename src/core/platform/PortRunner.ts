import { Cause, Effect, Exit, Fiber, Layer, Predicate, Queue, Schema, Scope } from 'effect'
import { WorkerRunner } from 'effect/workers'

export const IncomingFrame = Schema.Union([
  Schema.Tuple([Schema.Literal(0), Schema.Unknown]),
  Schema.Tuple([Schema.Literal(1)]),
])

export type IncomingFrame = typeof IncomingFrame.Type

export type OutgoingFrame = readonly [ready: 0] | readonly [response: 1, message: unknown]

export const decodeIncomingFrame = Schema.decodeUnknownOption(IncomingFrame)

export interface Port {
  readonly onMessage: (listener: (frame: IncomingFrame) => void) => () => void
  readonly onClose: (listener: () => void) => () => void
  readonly post: (frame: OutgoingFrame) => void
  readonly start: () => void
  readonly close: () => void
}

type PortEntry = readonly [port: Port, scope: Scope.Closeable]

export const make = (
  incoming: Queue.Dequeue<Port>,
): WorkerRunner.WorkerRunnerPlatform['Service'] => ({
  start: <O, I>() =>
    Effect.gen(function* (): Effect.fn.Return<WorkerRunner.WorkerRunner<O, I>> {
      const disconnects = yield* Queue.make<number>()
      const ports = new Map<number, PortEntry>()
      let nextPortId = 0

      const sendUnsafe = (portId: number, message: O) => ports.get(portId)?.[0].post([1, message])

      const send = (portId: number, message: O) => Effect.sync(() => sendUnsafe(portId, message))

      const run = <A, E, R>(
        handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void,
      ) =>
        Effect.scopedWith(
          Effect.fnUntraced(function* (scope) {
            const runFork = Effect.runForkWith(yield* Effect.context<R>())
            const trackFiber = Fiber.runIn(scope)

            const disconnect = (portId: number) => {
              const entry = ports.get(portId)

              if (Predicate.isUndefined(entry)) {
                return
              }

              ports.delete(portId)
              Queue.offerUnsafe(disconnects, portId)
              runFork(Scope.close(entry[1], Exit.void))
            }

            const receive = (portId: number) => (frame: IncomingFrame) => {
              if (frame[0] === 1) {
                return disconnect(portId)
              }

              // SAFETY: the Effect RPC worker client is the only writer on these ports and
              // sends `[0, request]` frames whose payload is the protocol's `I`.
              const result = handler(portId, frame[1] as I)

              if (!Effect.isEffect(result)) {
                return
              }

              const fiber = runFork(result)

              fiber.addObserver((exit) => {
                if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
                  runFork(Effect.logError('Unhandled error while serving a window', exit.cause))
                }
              })

              trackFiber(fiber)
            }

            const connect = Effect.fnUntraced(function* (port: Port) {
              const portId = nextPortId++
              const portScope = yield* Scope.fork(scope)

              ports.set(portId, [port, portScope])

              const stopMessages = port.onMessage(receive(portId))
              const stopClose = port.onClose(() => disconnect(portId))

              yield* Scope.addFinalizer(
                portScope,
                Effect.sync(() => {
                  stopMessages()
                  stopClose()
                  port.close()
                }),
              )

              port.start()
              port.post([0])
            })

            return yield* Effect.forever(Effect.flatMap(Queue.take(incoming), connect))
          }),
        )

      return { run, send, sendUnsafe, disconnects }
    }),
})

export const layer = (incoming: Queue.Dequeue<Port>) =>
  Layer.succeed(WorkerRunner.WorkerRunnerPlatform)(make(incoming))
