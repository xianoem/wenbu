import { createRequire } from 'node:module'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Cause, Effect, Layer, Option, Predicate, Queue, Schema, Stream } from 'effect'
import { PROTOCOL, WorkerLine, WorkerMessage } from '../MangaRuntime'
import { EngineOps } from './EngineOps'
import { Detector } from './Detector'
import { Images } from './Images'
import { Inpainter } from './Inpaint'
import { Lettering } from './Lettering'
import { MangaCv } from './MangaCv'
import { Onnx } from './Onnx'
import { OpenCv } from './OpenCv'
import { Reader } from './Reader'
import { Scanner } from './Scanner'
import { ScreenAiOcr } from '../../detections/ScreenAiOcr'

// onnxruntime-node 1.31 turns float16 data into Float16Array when the global exists, then its
// native binding refuses that array type. Removing the global before it loads keeps Uint16Array.
Reflect.deleteProperty(globalThis, 'Float16Array')

const modules = createRequire(import.meta.url)

const codecs = {
  jpeg: modules.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  webp: modules.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
}

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

  // Stops at once with the reason: closing the layers already built could otherwise keep the process alive.
  const stop = (cause: Cause.Cause<unknown>) =>
    Effect.sync(() => {
      process.stderr.write(`${Cause.pretty(cause)}\n`)
      process.exit(1)
    })

  void Effect.runPromise(
    serve(port).pipe(
      Effect.provide(
        EngineOps.layer.pipe(
          Layer.provideMerge(Scanner.layer),
          Layer.provideMerge(ScreenAiOcr.live),
          Layer.provideMerge(
            Layer.mergeAll(Inpainter.layer, Detector.layer, Reader.layer, Lettering.layer),
          ),
          Layer.provideMerge(Images.layer(codecs)),
          Layer.provideMerge(Layer.mergeAll(Onnx.layer, OpenCv.layer, MangaCv.live)),
          Layer.provideMerge(NodeServices.layer),
          Layer.tapCause(stop),
        ),
      ),
      Effect.catchCause(stop),
    ),
  )
})
