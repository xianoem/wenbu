import * as NodeServices from '@effect/platform-node/NodeServices'
import { Cause, Effect, Layer, Option, Predicate, Queue, Schema, Stream } from 'effect'
import { PROTOCOL, WorkerLine, WorkerMessage } from '../MangaRuntime'
import { EngineOps } from './EngineOps'
import { Onnx } from './Onnx'

// onnxruntime-node 1.31 turns float16 data into Float16Array when the global exists, then its
// native binding refuses that array type. Removing the global before it loads keeps Uint16Array.
Reflect.deleteProperty(globalThis, 'Float16Array')

const firstLine = (text: string) => text.split(/\r?\n/)[0] ?? 'The engine failed.'

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(WorkerMessage))

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(WorkerLine))

const serve = (port: Electron.MessagePortMain) =>
  Effect.gen(function* () {
    const ops = yield* EngineOps
    const inbox = yield* Queue.unbounded<string>()

    const send = (event: WorkerLine) =>
      encodeLine(event).pipe(
        Effect.orDie,
        Effect.flatMap((line) => Effect.sync(() => port.postMessage(line))),
      )

    port.on('message', (event) => {
      if (Predicate.isString(event.data)) {
        Queue.offerUnsafe(inbox, event.data)
      }
    })

    port.on('close', () => process.exit(0))
    port.start()
    yield* send({ event: 'ready', protocol: PROTOCOL })

    yield* Stream.fromQueue(inbox).pipe(
      Stream.runForEach((line) =>
        Option.match(decodeMessage(line), {
          onNone: () =>
            send({ event: 'error', message: 'Wenbu sent a message the engine could not read.' }),
          onSome: (message) => {
            if (message.type === 'editor') {
              const { id, type: _, ...request } = message

              return ops.editor(request).pipe(
                Effect.flatMap((result) => send({ event: 'editor-done', id, result })),
                Effect.catchTag('MangaError', (error) =>
                  send({ event: 'editor-failed', id, message: error.message }),
                ),
                Effect.catchCause((cause) =>
                  send({ event: 'editor-failed', id, message: firstLine(Cause.pretty(cause)) }),
                ),
                Effect.forkDetach,
              )
            }

            if (message.type === 'run') {
              return send({
                event: 'run-failed',
                run: message.run,
                message: 'Folder runs are not ported to the native engine yet.',
              })
            }

            return Effect.void
          },
        }),
      ),
    )
  })

process.parentPort.once('message', (event) => {
  const [port] = event.ports

  if (port === undefined) {
    process.exit(1)
  }

  void Effect.runPromise(
    serve(port).pipe(
      Effect.provide(
        EngineOps.layer.pipe(
          Layer.provideMerge(Onnx.layer),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  )
})
