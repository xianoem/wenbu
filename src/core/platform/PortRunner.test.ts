import { MessageChannel, type MessagePort } from 'node:worker_threads'
import * as BrowserWorker from '@effect/platform-browser/BrowserWorker'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer, Option, Queue, Schema, Scope } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcServer } from 'effect/rpc'
import * as PortRunner from './PortRunner'

class EchoRpc extends RpcGroup.make(
  Rpc.make('shout', { payload: { text: Schema.String }, success: Schema.String }),
) {}

const EchoLive = EchoRpc.toLayer(
  Effect.succeed(
    EchoRpc.of({
      shout: ({ text }) => Effect.succeed(text.toUpperCase()),
    }),
  ),
)

const fromNodePort = (port: MessagePort): PortRunner.Port => ({
  onMessage: (listener) => {
    port.on('message', (data) => Option.map(PortRunner.decodeIncomingFrame(data), listener))

    return () => port.removeAllListeners('message')
  },
  onClose: (listener) => {
    port.addListener('close', listener)

    return () => port.removeListener('close', listener)
  },
  post: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close(),
})

const startServer = Effect.fnUntraced(function* () {
  const ports = yield* Queue.unbounded<PortRunner.Port>()

  yield* Layer.launch(
    RpcServer.layer(EchoRpc).pipe(
      Layer.provide(EchoLive),
      Layer.provide(RpcServer.layerProtocolWorkerRunner),
      Layer.provide(PortRunner.layer(ports)),
    ),
  ).pipe(Effect.forkScoped)

  return ports
})

const connect = Effect.fnUntraced(function* (ports: Queue.Queue<PortRunner.Port>) {
  const channel = new MessageChannel()

  yield* Queue.offer(ports, fromNodePort(channel.port1))

  const scope = yield* Scope.make()

  const protocol = yield* Layer.buildWithScope(
    RpcClient.layerProtocolWorker({ size: 1 }).pipe(
      Layer.provide(BrowserWorker.layer(() => channel.port2)),
    ),
    scope,
  )

  const client = yield* RpcClient.make(EchoRpc).pipe(
    Effect.provideContext(protocol),
    Scope.provide(scope),
  )

  return { client, scope }
})

describe('PortRunner', () => {
  it.live('serves every connected port', () =>
    Effect.gen(function* () {
      const ports = yield* startServer()
      const first = yield* connect(ports)
      const second = yield* connect(ports)

      assert.strictEqual(yield* first.client.shout({ text: 'library' }), 'LIBRARY')
      assert.strictEqual(yield* second.client.shout({ text: 'overlay' }), 'OVERLAY')
    }),
  )

  it.live('keeps serving after the last window disconnects', () =>
    Effect.gen(function* () {
      const ports = yield* startServer()
      const first = yield* connect(ports)

      assert.strictEqual(yield* first.client.shout({ text: 'before' }), 'BEFORE')
      yield* Scope.close(first.scope, Exit.void)

      const next = yield* connect(ports)

      assert.strictEqual(yield* next.client.shout({ text: 'after' }), 'AFTER')
    }),
  )
})
