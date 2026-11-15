import { type Cause, Config, Context, Effect, Layer, Path, Queue, Semaphore, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { MangaError } from '#contract/Manga'
import type { Point } from './DbBoxes'

/** Full-page OpenCV and dense CRF work, done by wenbu-manga-cv.exe with the OpenCV build the plugin used. */

export interface Pixels {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly data: Uint8Array
}

export interface PanelFeatures {
  readonly contours: ReadonlyArray<ReadonlyArray<Point>>
  /** x0, y0, x1, y1 per segment. */
  readonly segments: Float32Array
}

export interface CrfOptions {
  readonly gaussianXy: number
  readonly gaussianCompat: number
  readonly bilateralXy: number
  readonly bilateralRgb: number
  readonly bilateralCompat: number
  readonly iterations: number
}

const linear = 1

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const op = { put: 1, get: 2, drop: 3, resize: 4, bilateral: 5, panelFeatures: 6, crf: 7 } as const

interface Reply {
  readonly params: ReadonlyArray<number>
  readonly buffers: ReadonlyArray<Uint8Array>
}

const encode = (
  code: number,
  params: ReadonlyArray<number>,
  buffers: ReadonlyArray<Uint8Array>,
) => {
  const size =
    8 + params.length * 8 + 4 + buffers.reduce((total, buffer) => total + 8 + buffer.length, 0)

  const frame = new Uint8Array(size)
  const view = new DataView(frame.buffer)
  let offset = 0

  view.setUint32(offset, code, true)
  view.setUint32(offset + 4, params.length, true)
  offset += 8

  for (const value of params) {
    view.setFloat64(offset, value, true)
    offset += 8
  }

  view.setUint32(offset, buffers.length, true)
  offset += 4

  for (const buffer of buffers) {
    view.setBigUint64(offset, BigInt(buffer.length), true)
    frame.set(buffer, offset + 8)
    offset += 8 + buffer.length
  }

  return frame
}

export class MangaCv extends Context.Service<
  MangaCv,
  {
    readonly put: (id: number, pixels: Pixels) => Effect.Effect<void, MangaError>
    readonly get: (id: number) => Effect.Effect<Pixels, MangaError>
    readonly drop: (id: number) => Effect.Effect<void, MangaError>
    readonly resize: (
      source: number,
      target: number,
      width: number,
      height: number,
    ) => Effect.Effect<void, MangaError>
    readonly bilateral: (
      source: number,
      target: number,
      diameter: number,
      sigmaColor: number,
      sigmaSpace: number,
    ) => Effect.Effect<void, MangaError>
    readonly panelFeatures: (source: number) => Effect.Effect<PanelFeatures, MangaError>
    readonly crf: (
      rgb: Pixels,
      mask: Uint8Array,
      options: CrfOptions,
    ) => Effect.Effect<Uint8Array, MangaError>
  }
>()('wenbu/core/manga/engine/MangaCv') {
  static readonly layer = (command: string, args: ReadonlyArray<string> = []) =>
    Layer.effect(
      MangaCv,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const input = yield* Queue.unbounded<Uint8Array>()
        const chunks = yield* Queue.unbounded<Uint8Array, Cause.Done>()
        const lock = yield* Semaphore.make(1)

        const handle = yield* spawner
          .spawn(
            ChildProcess.make(command, args, {
              stdin: Stream.fromQueue(input),
              stdout: 'pipe',
              stderr: 'pipe',
            }),
          )
          .pipe(Effect.mapError(() => failed('The manga image helper could not be started.')))

        yield* handle.stdout.pipe(
          Stream.runForEach((chunk) => Queue.offer(chunks, chunk)),
          Effect.ignore,
          Effect.ensuring(Queue.end(chunks)),
          Effect.forkScoped,
        )

        const pending: Array<Uint8Array> = []
        let available = 0

        const take = Effect.fnUntraced(function* (size: number) {
          while (available < size) {
            const chunk = yield* Queue.take(chunks).pipe(
              Effect.mapError(() => failed('The manga image helper stopped.')),
            )

            pending.push(chunk)
            available += chunk.length
          }

          const taken = new Uint8Array(size)
          let filled = 0

          while (filled < size) {
            const head = pending[0] ?? new Uint8Array(0)
            const used = Math.min(head.length, size - filled)

            taken.set(head.subarray(0, used), filled)
            filled += used

            if (used === head.length) {
              pending.shift()
            } else {
              pending[0] = head.subarray(used)
            }
          }

          available -= size

          return taken
        })

        const read = Effect.fnUntraced(function* () {
          const head = new DataView((yield* take(8)).buffer)
          const status = head.getUint32(0, true)
          const params: Array<number> = []

          for (let index = 0; index < head.getUint32(4, true); index += 1) {
            params.push(new DataView((yield* take(8)).buffer).getFloat64(0, true))
          }

          const buffers: Array<Uint8Array> = []
          const count = new DataView((yield* take(4)).buffer).getUint32(0, true)

          for (let index = 0; index < count; index += 1) {
            const size = Number(new DataView((yield* take(8)).buffer).getBigUint64(0, true))

            buffers.push(yield* take(size))
          }

          if (status !== 0) {
            return yield* failed(
              `The manga image helper failed: ${new TextDecoder().decode(buffers[0])}`,
            )
          }

          return { params, buffers } satisfies Reply
        })

        const call = (
          code: number,
          params: ReadonlyArray<number>,
          buffers: ReadonlyArray<Uint8Array> = [],
        ) =>
          lock.withPermits(1)(
            Queue.offer(input, encode(code, params, buffers)).pipe(Effect.andThen(read())),
          )

        return MangaCv.of({
          put: (id, pixels) =>
            Effect.asVoid(
              call(op.put, [id, pixels.width, pixels.height, pixels.channels, 1], [pixels.data]),
            ),
          get: (id) =>
            Effect.map(call(op.get, [id]), (reply) => ({
              width: reply.params[0] ?? 0,
              height: reply.params[1] ?? 0,
              channels: reply.params[2] ?? 0,
              data: reply.buffers[0] ?? new Uint8Array(0),
            })),
          drop: (id) => Effect.asVoid(call(op.drop, [id])),
          resize: (source, target, width, height) =>
            Effect.asVoid(call(op.resize, [source, target, width, height, linear])),
          bilateral: (source, target, diameter, sigmaColor, sigmaSpace) =>
            Effect.asVoid(call(op.bilateral, [source, target, diameter, sigmaColor, sigmaSpace])),
          panelFeatures: (source) =>
            Effect.map(call(op.panelFeatures, [source]), (reply) => {
              const packed = reply.buffers[0] ?? new Uint8Array(0)
              const ints = new Int32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4)
              const contours: Array<Array<Point>> = []
              let offset = 1

              for (let contour = 0; contour < (ints[0] ?? 0); contour += 1) {
                const count = ints[offset] ?? 0
                const points: Array<Point> = []

                for (let point = 0; point < count; point += 1) {
                  points.push({
                    x: ints[offset + 1 + point * 2] ?? 0,
                    y: ints[offset + 2 + point * 2] ?? 0,
                  })
                }

                contours.push(points)
                offset += 1 + count * 2
              }

              const lines = reply.buffers[1] ?? new Uint8Array(0)

              return {
                contours,
                segments: new Float32Array(lines.slice().buffer),
              }
            }),
          crf: (rgb, mask, options) =>
            Effect.map(
              call(
                op.crf,
                [
                  rgb.width,
                  rgb.height,
                  options.gaussianXy,
                  options.gaussianCompat,
                  options.bilateralXy,
                  options.bilateralRgb,
                  options.bilateralCompat,
                  options.iterations,
                ],
                [rgb.data, mask],
              ),
              (reply) => reply.buffers[0] ?? new Uint8Array(0),
            ),
        })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path

      return MangaCv.layer(
        path.join(resources, 'native', `${process.platform}-${process.arch}`, 'wenbu-manga-cv.exe'),
      )
    }),
  )
}
