import {
  type Cause,
  Config,
  Context,
  type Duration,
  Effect,
  Exit,
  Layer,
  Path,
  Queue,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { DetectionError, type OcrResult, type RgbaImage } from '#contract/Detections'
import { watchSidecar } from '../platform/SidecarOutput'
import { fitWithin } from './RgbaImages'
import { decodeScreenAiAnnotation } from './ScreenAiAnnotation'

export type HelperCommand = (folder: string) => {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const Reply = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      ready: Schema.Literal(true),
      version: Schema.String,
      maxDimension: Schema.Int,
    }),
    Schema.Struct({ annotation: Schema.String }),
    Schema.Struct({ error: Schema.String }),
  ]),
)

const decodeReply = Schema.decodeUnknownEffect(Reply)

const failed = (message: string) => new DetectionError({ reason: 'failed', message })

const isDetectionError = Schema.is(DetectionError)

interface Helper {
  readonly folder: string
  readonly maxDimension: number
  readonly scope: Scope.Closeable
  readonly send: (frame: Uint8Array) => Effect.Effect<typeof Reply.Type, DetectionError>
}

const frameOf = (image: RgbaImage) => {
  const frame = new Uint8Array(8 + image.pixels.length)
  const view = new DataView(frame.buffer)

  view.setUint32(0, image.width, true)
  view.setUint32(4, image.height, true)
  frame.set(image.pixels, 8)

  return frame
}

export class ScreenAiOcr extends Context.Service<
  ScreenAiOcr,
  {
    readonly recognize: (
      folder: string,
      image: RgbaImage,
    ) => Effect.Effect<OcrResult, DetectionError>
    readonly stop: Effect.Effect<void>
  }
>()('wenbu/core/detections/ScreenAiOcr') {
  static readonly layer = (helperCommand: HelperCommand) =>
    Layer.effect(
      ScreenAiOcr,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const lock = yield* Semaphore.make(1)
        let current: Helper | undefined

        const stopCurrent = Effect.suspend(() => {
          const helper = current

          current = undefined

          return helper === undefined ? Effect.void : Scope.close(helper.scope, Exit.void)
        })

        yield* Effect.addFinalizer(() => stopCurrent)

        const start = Effect.fnUntraced(function* (folder: string) {
          const scope = yield* Scope.make()
          const input = yield* Queue.unbounded<Uint8Array>()
          const lines = yield* Queue.unbounded<string, Cause.Done>()
          const { command, args } = helperCommand(folder)

          const handle = yield* spawner
            .spawn(
              ChildProcess.make(command, args, {
                stdin: Stream.fromQueue(input),
                stdout: 'pipe',
                stderr: 'pipe',
              }),
            )
            .pipe(
              Scope.provide(scope),
              Effect.mapError(() => failed('The Screen AI helper could not be started.')),
            )

          yield* watchSidecar('screen-ai', handle).pipe(Scope.provide(scope))

          yield* handle.stdout.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.runForEach((line) => Queue.offer(lines, line)),
            Effect.ignore,
            Effect.ensuring(Queue.end(lines)),
            Effect.forkIn(scope),
          )

          const next = (timeout: Duration.Input, stopped: string) =>
            Queue.take(lines).pipe(
              Effect.timeoutOrElse({
                duration: timeout,
                orElse: () => Effect.fail(failed('Screen AI did not answer in time.')),
              }),
              Effect.mapError((error) => (isDetectionError(error) ? error : failed(stopped))),
              Effect.flatMap((line) =>
                Effect.mapError(decodeReply(line), () =>
                  failed('Screen AI sent a reply Wenbu could not read.'),
                ),
              ),
            )

          const ready = yield* next('30 seconds', 'Screen AI stopped while loading.').pipe(
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          )

          if (!('ready' in ready)) {
            yield* Scope.close(scope, Exit.void)

            return yield* failed('error' in ready ? ready.error : 'Screen AI did not start.')
          }

          yield* Effect.logInfo('Screen AI ready').pipe(
            Effect.annotateLogs({ version: ready.version, maxDimension: ready.maxDimension }),
          )

          const helper: Helper = {
            folder,
            maxDimension: ready.maxDimension,
            scope,
            send: (frame) =>
              Queue.offer(input, frame).pipe(
                Effect.andThen(next('60 seconds', 'Screen AI stopped while reading the image.')),
              ),
          }

          return helper
        })

        const helperFor = Effect.fnUntraced(function* (folder: string) {
          if (current?.folder === folder) {
            return current
          }

          yield* stopCurrent
          current = yield* start(folder)

          return current
        })

        const recognize = Effect.fn('ScreenAiOcr.recognize')(function* (
          folder: string,
          image: RgbaImage,
        ) {
          const helper = yield* helperFor(folder)
          const sent = fitWithin(image, helper.maxDimension)

          const reply = yield* helper.send(frameOf(sent)).pipe(Effect.tapError(() => stopCurrent))

          if ('error' in reply) {
            return yield* failed(reply.error)
          }

          if (!('annotation' in reply)) {
            return yield* failed('Screen AI sent a reply Wenbu could not read.')
          }

          return yield* decodeScreenAiAnnotation(reply.annotation, sent, image)
        }, lock.withPermits(1))

        return ScreenAiOcr.of({ recognize, stop: lock.withPermits(1)(stopCurrent) })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path
      const name = process.platform === 'win32' ? 'wenbu-screen-ai-ocr.exe' : 'wenbu-screen-ai-ocr'
      const helper = path.join(resources, 'native', `${process.platform}-${process.arch}`, name)

      return ScreenAiOcr.layer((folder) => ({ command: helper, args: ['--resources', folder] }))
    }),
  )
}
