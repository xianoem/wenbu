import { createRequire } from 'node:module'
import * as NodeServices from '@effect/platform-node/NodeServices'
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Queue,
  Schema,
  Stream,
} from 'effect'
import { MangaError } from '#contract/Manga'
import { PROTOCOL, WorkerLine, WorkerMessage } from '../MangaRuntime'
import { EngineOps, letterOptions } from './EngineOps'
import { Detector } from './Detector'
import { Images } from './Images'
import { Inpainter } from './Inpaint'
import { Lettering } from './Lettering'
import { MangaCv } from './MangaCv'
import { Onnx } from './Onnx'
import { OpenCv } from './OpenCv'
import { Reader } from './Reader'
import { Runner, type RunReport, type RunSettings } from './Runner'
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

type RunMessage = Extract<typeof WorkerMessage.Type, { readonly type: 'run' }>

type Options = RunMessage['options']

const numberOf = (options: Options, name: string, fallback: number) => {
  const value = options[name]

  return Predicate.isNumber(value) ? value : fallback
}

const formats = ['png', 'jpeg', 'webp', 'source'] as const

const settingsOf = (options: Options): RunSettings => {
  const target = options['target_language']
  const screenAi = options['screen_ai']
  const format = formats.find((candidate) => candidate === options['output_format']) ?? 'png'

  return {
    target: Predicate.isString(target) ? target : 'ENG',
    screenAi:
      Predicate.isString(screenAi) && screenAi !== '' ? Option.some(screenAi) : Option.none(),
    inpaintingSize: numberOf(options, 'inpainting_size', 2048),
    wholePage: options['inpainting'] === 'page',
    format,
    quality: numberOf(options, 'output_quality', 95),
    pagesAhead: Math.max(1, numberOf(options, 'pages_ahead', 3)),
    translationRequests: Math.max(1, numberOf(options, 'translation_requests', 3)),
    letter: letterOptions(options),
  }
}

const serve = (port: Electron.MessagePortMain) =>
  Effect.gen(function* () {
    const ops = yield* EngineOps
    const runner = yield* Runner
    const onnx = yield* Onnx
    const inbox = yield* Queue.unbounded<string>()
    const pending = new Map<number, Deferred.Deferred<ReadonlyArray<string>, MangaError>>()
    let nextRequest = 0
    let active: { readonly id: string; readonly fiber: Fiber.Fiber<void> } | undefined

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

    const failPending = (reason: string) =>
      Effect.forEach(
        [...pending.values()],
        (deferred) =>
          Deferred.fail(deferred, new MangaError({ reason: 'failed', message: reason })),
        { discard: true },
      )

    const answer = (
      message: Extract<typeof WorkerMessage.Type, { readonly type: 'translated' }>,
    ) => {
      const deferred = pending.get(message.id)

      if (deferred === undefined) {
        return Effect.void
      }

      pending.delete(message.id)

      return 'error' in message
        ? Deferred.fail(deferred, new MangaError({ reason: 'failed', message: message.error }))
        : Deferred.succeed(deferred, message.translations)
    }

    const translate = (run: string) => (page: number, texts: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        nextRequest += 1

        const id = nextRequest
        const deferred = yield* Deferred.make<ReadonlyArray<string>, MangaError>()

        pending.set(id, deferred)
        yield* send({ event: 'translate', run, id, page, texts })

        return yield* Deferred.await(deferred)
      })

    const report = (run: string) => (event: RunReport) => send({ ...event, run })

    const startRun = (message: RunMessage) =>
      Effect.gen(function* () {
        if (active !== undefined) {
          return yield* send({
            event: 'run-failed',
            run: message.run,
            message: 'Another run is still going.',
          })
        }

        const run = message.run

        const work = Effect.gen(function* () {
          yield* send({ event: 'loading-models', run })
          yield* send({ event: 'models-loaded', run, device: onnx.device })

          const result = yield* runner.run(
            message.pages,
            settingsOf(message.options),
            report(run),
            translate(run),
          )

          yield* send({ event: 'run-done', run, cancelled: false, seconds: result.seconds })
        }).pipe(
          Effect.onInterrupt(() =>
            failPending('The run was cancelled.').pipe(
              Effect.andThen(send({ event: 'run-done', run, cancelled: true })),
            ),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : failPending('The run failed.').pipe(
                  Effect.andThen(
                    send({ event: 'run-failed', run, message: firstLine(Cause.pretty(cause)) }),
                  ),
                ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              active = undefined
            }),
          ),
        )

        const fiber = yield* Effect.forkDetach(work)

        active = { id: run, fiber }
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
              return startRun(message)
            }

            if (message.type === 'translated') {
              return answer(message)
            }

            if (message.type === 'cancel' && active?.id === message.run) {
              return Fiber.interrupt(active.fiber)
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
          Layer.provideMerge(Runner.layer),
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
