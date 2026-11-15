import { Context, Effect, Layer, Ref } from 'effect'
import { MangaError } from '#contract/Manga'
import { dbBoxes, roundHalfEven } from './DbBoxes'
import type { RgbImage } from './Images'
import { Onnx, type Session } from './Onnx'
import { OpenCv, type Cv } from './OpenCv'
import { quad, quadArea, type Quad } from './Quad'

/** A port of manga-image-translator's default detector (DBNet ResNet34) without its rearranged path for tall strips. */

export interface GreyImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export interface Detection {
  readonly lines: ReadonlyArray<Quad>
  /** The detector's text mask, at the detection size without padding. */
  readonly rawMask: GreyImage
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const detectSize = 2048
const minimumSide = 400
const tile = 1024
const halo = 8
const f = Math.fround

const reflect = (index: number, size: number) => {
  if (index < 0) {
    return Math.min(-index, size - 1)
  }

  if (index >= size) {
    return Math.max(2 * size - 2 - index, 0)
  }

  return index
}

/** _add_border: small pages sit in the top-left corner of a black square. */
const withBorder = (image: RgbImage): RgbImage => {
  const side = Math.max(image.width, image.height, minimumSide)
  const data = new Uint8Array(side * side * 3)

  for (let y = 0; y < image.height; y += 1) {
    data.set(image.data.subarray(y * image.width * 3, (y + 1) * image.width * 3), y * side * 3)
  }

  return { width: side, height: side, data }
}

const resized = (cv: Cv, image: RgbImage, width: number, height: number) => {
  const source = cv.matFromArray(image.height, image.width, cv.CV_8UC3, image.data)
  const target = new cv.Mat()

  cv.resize(source, target, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)

  const data = Uint8Array.from(target.data)

  source.delete()
  target.delete()

  return { width, height, data }
}

export class Detector extends Context.Service<
  Detector,
  { readonly detect: (image: RgbImage) => Effect.Effect<Detection, MangaError> }
>()('wenbu/core/manga/engine/Detector') {
  static readonly layer = Layer.effect(
    Detector,
    Effect.gen(function* () {
      const onnx = yield* Onnx
      const { cv } = yield* OpenCv
      const bilateralSession = yield* onnx.session('bilateral.onnx')
      const sessions = yield* Ref.make(new Map<string, Session>())

      const sessionFor = Effect.fnUntraced(function* (height: number, width: number) {
        const key = `${height}x${width}`
        const cached = (yield* Ref.get(sessions)).get(key)

        if (cached !== undefined) {
          return cached
        }

        const created = yield* onnx.session('detect.onnx', { height, width })

        yield* Ref.update(sessions, (all) => new Map(all).set(key, created))

        return created
      })

      /** cv::bilateralFilter(17, 80, 80) on the GPU, tile by tile, with reflect-101 borders. */
      const bilateral = Effect.fnUntraced(function* (image: RgbImage) {
        const { width, height } = image
        const out = new Uint8Array(width * height * 3)
        const side = tile + 2 * halo
        const input = new Uint8Array(side * side * 3)

        for (let top = 0; top < height; top += tile) {
          for (let left = 0; left < width; left += tile) {
            for (let y = 0; y < side; y += 1) {
              const sy = reflect(top + y - halo, height)

              for (let x = 0; x < side; x += 1) {
                const source = (sy * width + reflect(left + x - halo, width)) * 3
                const target = (y * side + x) * 3

                input[target] = image.data[source] ?? 0
                input[target + 1] = image.data[source + 1] ?? 0
                input[target + 2] = image.data[source + 2] ?? 0
              }
            }

            const result = yield* Effect.tryPromise({
              try: () =>
                bilateralSession.run({
                  image: new onnx.ort.Tensor('uint8', input, [side, side, 3]),
                }),
              catch: (error) => failed(`The bilateral filter failed: ${String(error)}`),
            })

            const filtered = result['filtered']?.data

            if (!(filtered instanceof Uint8Array)) {
              return yield* failed('The bilateral filter returned no image.')
            }

            for (let y = 0; y < Math.min(tile, height - top); y += 1) {
              const rows = Math.min(tile, width - left) * 3

              out.set(
                filtered.subarray(y * tile * 3, y * tile * 3 + rows),
                ((top + y) * width + left) * 3,
              )
            }
          }
        }

        return { width, height, data: out }
      })

      const detect = Effect.fn('Detector.detect')(function* (page: RgbImage) {
        const bordered = Math.min(page.width, page.height) < minimumSide
        const image = bordered ? withBorder(page) : page
        const filtered = yield* bilateral(image)
        const ratio = detectSize / Math.max(image.height, image.width)
        const targetHeight = roundHalfEven(image.height * ratio)
        const targetWidth = roundHalfEven(image.width * ratio)
        const small = resized(cv, filtered, targetWidth, targetHeight)
        const padHeight = targetHeight % 256 === 0 ? 0 : 256 - (targetHeight % 256)
        const padWidth = targetWidth % 256 === 0 ? 0 : 256 - (targetWidth % 256)
        const height = targetHeight + padHeight
        const width = targetWidth + padWidth
        const pixels = new Float32Array(3 * height * width).fill(-1)

        for (let y = 0; y < targetHeight; y += 1) {
          for (let x = 0; x < targetWidth; x += 1) {
            for (let channel = 0; channel < 3; channel += 1) {
              pixels[channel * height * width + y * width + x] = f(
                f((small.data[(y * targetWidth + x) * 3 + channel] ?? 0) / 127.5) - 1,
              )
            }
          }
        }

        const session = yield* sessionFor(height, width)

        const outputs = yield* Effect.tryPromise({
          try: () =>
            session.run({ image: new onnx.ort.Tensor('float32', pixels, [1, 3, height, width]) }),
          catch: (error) => failed(`Text detection failed: ${String(error)}`),
        })

        const db = outputs['db']?.data
        const mask = outputs['mask']?.data

        if (!(db instanceof Float32Array) || !(mask instanceof Float32Array)) {
          return yield* failed('Text detection returned no maps.')
        }

        const shrink = db.subarray(0, height * width)
        const scale = 1 / ratio

        const lines = dbBoxes(cv, shrink, width, height, width, height)
          .map((box) =>
            quad(
              box.points.map((point) => ({
                x: Math.trunc(point.x * scale),
                y: Math.trunc(point.y * scale),
              })),
              box.score,
            ),
          )
          .filter((line) => quadArea(line) > 16)

        const maskSource = cv.matFromArray(height / 2, width / 2, cv.CV_32FC1, mask)
        const maskFull = new cv.Mat()

        cv.resize(maskSource, maskFull, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)

        const keptHeight = padHeight > 0 ? height - padHeight : height
        const keptWidth = padHeight === 0 && padWidth > 0 ? width - padWidth : width
        const raw = new Uint8Array(keptHeight * keptWidth)

        for (let y = 0; y < keptHeight; y += 1) {
          for (let x = 0; x < keptWidth; x += 1) {
            const value = f((maskFull.data32F[y * width + x] ?? 0) * 255)

            raw[y * keptWidth + x] = Math.trunc(Math.min(Math.max(value, 0), 255))
          }
        }

        maskSource.delete()
        maskFull.delete()

        const rawMask = { width: keptWidth, height: keptHeight, data: raw }

        if (!bordered) {
          return { lines, rawMask } satisfies Detection
        }

        return {
          lines: lines
            .filter((line) => {
              const xs = line.pts.map((point) => point.x)
              const ys = line.pts.map((point) => point.y)

              return !(Math.min(...xs) >= page.width && Math.min(...ys) >= page.height)
            })
            .map((line) =>
              quad(
                line.pts.map((point) => ({
                  x: Math.min(Math.max(point.x, 0), page.width),
                  y: Math.min(Math.max(point.y, 0), page.height),
                })),
                line.score,
              ),
            ),
          rawMask: cropped(cv, rawMask, image.width, image.height, page.width, page.height),
        } satisfies Detection
      })

      return Detector.of({ detect })
    }),
  )
}

/** _remove_border: the mask is stretched to the bordered page, then cut back to the original. */
const cropped = (
  cv: Cv,
  mask: GreyImage,
  width: number,
  height: number,
  keepWidth: number,
  keepHeight: number,
) => {
  const source = cv.matFromArray(mask.height, mask.width, cv.CV_8UC1, mask.data)
  const target = new cv.Mat()

  cv.resize(source, target, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)

  const data = new Uint8Array(keepWidth * keepHeight)

  for (let y = 0; y < keepHeight; y += 1) {
    data.set(target.data.subarray(y * width, y * width + keepWidth), y * keepWidth)
  }

  source.delete()
  target.delete()

  return { width: keepWidth, height: keepHeight, data }
}
