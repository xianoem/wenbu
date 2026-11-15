import { Context, Effect, Layer } from 'effect'
import { MangaError } from '#contract/Manga'
import { roundHalfEven } from './DbBoxes'
import type { RgbImage } from './Images'
import { Onnx } from './Onnx'
import { OpenCv, type Cv } from './OpenCv'

/**
 * Region inpainting as the plugin does it (wenbu_manga/inpainting.py and LaMa's _infer): the mask's
 * connected parts become crops with context around them, aligned to 8 pixels and merged where they
 * overlap, and LaMa (lama_large_512px, exported with dynamic size) fills each crop at its own size.
 * Only masked pixels change.
 */

type Box = readonly [number, number, number, number]

const minContext = 48
const align = 8

export interface InpaintOptions {
  /** The longest side LaMa sees; larger crops are scaled down first. */
  readonly size: number
  /** Inpaints the whole page in one pass instead of crops around the mask. */
  readonly wholePage: boolean
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const grow = (start: number, end: number, limit: number): readonly [number, number] => {
  const target = Math.ceil((end - start) / align) * align

  if (target > limit) {
    return [start, end]
  }

  const stop = Math.min(limit, start + target)

  return [stop - target, stop]
}

const aligned = (box: Box, width: number, height: number): Box => {
  const [left, right] = grow(box[0], box[2], width)
  const [top, bottom] = grow(box[1], box[3], height)

  return [left, top, right, bottom]
}

const withContext = (box: Box, width: number, height: number): Box => {
  const [x1, y1, x2, y2] = box
  const margin = Math.max(minContext, Math.floor(Math.max(x2 - x1, y2 - y1) / 2))

  return aligned(
    [
      Math.max(0, x1 - margin),
      Math.max(0, y1 - margin),
      Math.min(width, x2 + margin),
      Math.min(height, y2 + margin),
    ],
    width,
    height,
  )
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

const sameBox = (a: Box) => (b: Box) => a.every((edge, index) => edge === b[index])

const merged = (boxes: ReadonlyArray<Box>, width: number, height: number) => {
  const pending = [...boxes]
  const done: Array<Box> = []

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let box = next
    let absorbed = true

    while (absorbed) {
      absorbed = false

      for (const other of [...done, ...pending]) {
        if (overlaps(box, other)) {
          box = aligned(
            [
              Math.min(box[0], other[0]),
              Math.min(box[1], other[1]),
              Math.max(box[2], other[2]),
              Math.max(box[3], other[3]),
            ],
            width,
            height,
          )

          // Python's `other in done` and `list.remove` compare boxes by value, not identity.
          const list = done.some(sameBox(other)) ? done : pending

          list.splice(list.findIndex(sameBox(other)), 1)
          absorbed = true

          break
        }
      }
    }

    done.push(box)
  }

  return done.toSorted((a, b) => (a[1] === b[1] ? a[0] - b[0] : a[1] - b[1]))
}

/** The crops LaMa fills: each connected part of the mask, with context, aligned and merged. */
export const crops = (
  cv: Cv,
  mask: Uint8Array,
  width: number,
  height: number,
): ReadonlyArray<Box> => {
  const binary = cv.matFromArray(
    height,
    width,
    cv.CV_8UC1,
    Uint8Array.from(mask, (value) => (value >= 127 ? 1 : 0)),
  )

  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const centroids = new cv.Mat()
  const count = cv.connectedComponentsWithStats(binary, labels, stats, centroids, 8)
  const boxes: Array<Box> = []

  for (let label = 1; label < count; label += 1) {
    const [x = 0, y = 0, w = 0, h = 0] = [0, 1, 2, 3].map(
      (column) => stats.data32S[label * 5 + column] ?? 0,
    )

    boxes.push(withContext([x, y, x + w, y + h], width, height))
  }

  binary.delete()
  labels.delete()
  stats.delete()
  centroids.delete()

  return merged(boxes, width, height)
}

const resizedCrop = (
  cv: Cv,
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  toWidth: number,
  toHeight: number,
  exact: boolean,
) => {
  const source = cv.matFromArray(height, width, channels === 3 ? cv.CV_8UC3 : cv.CV_8UC1, data)
  const target = new cv.Mat()

  cv.resize(
    source,
    target,
    new cv.Size(toWidth, toHeight),
    0,
    0,
    exact ? cv.INTER_LINEAR_EXACT : cv.INTER_LINEAR,
  )

  const out = Uint8Array.from(target.data)

  source.delete()
  target.delete()

  return out
}

export class Inpainter extends Context.Service<
  Inpainter,
  {
    readonly inpaint: (
      image: RgbImage,
      mask: Uint8Array,
      options: InpaintOptions,
    ) => Effect.Effect<RgbImage, MangaError>
  }
>()('wenbu/core/manga/engine/Inpainter') {
  static readonly layer = Layer.effect(
    Inpainter,
    Effect.gen(function* () {
      const onnx = yield* Onnx
      const { cv } = yield* OpenCv
      const session = yield* onnx.session('lama.onnx')

      /** LaMa's _infer on one crop: only the masked pixels take LaMa's output. */
      const fill = Effect.fnUntraced(function* (
        crop: Uint8Array,
        cropMask: Uint8Array,
        width: number,
        height: number,
        size: number,
      ) {
        let image = crop
        let mask = cropMask
        let w = width
        let h = height

        if (Math.max(w, h) > size) {
          const ratio = size / Math.max(w, h)
          const nw = roundHalfEven(w * ratio)
          const nh = roundHalfEven(h * ratio)

          image = resizedCrop(cv, image, w, h, 3, nw, nh, true)
          mask = resizedCrop(cv, mask, w, h, 1, nw, nh, true)
          w = nw
          h = nh
        }

        const padW = w % align === 0 ? w : w + align - (w % align)
        const padH = h % align === 0 ? h : h + align - (h % align)

        if (padW !== w || padH !== h) {
          image = resizedCrop(cv, image, w, h, 3, padW, padH, false)
          mask = resizedCrop(cv, mask, w, h, 1, padW, padH, false)
        }

        const plane = padW * padH
        const pixels = new Float32Array(3 * plane)
        const holes = new Float32Array(plane)

        for (let p = 0; p < plane; p += 1) {
          const hole = Math.fround((mask[p] ?? 0) / 255) >= 0.5 ? 1 : 0

          holes[p] = hole

          for (let c = 0; c < 3; c += 1) {
            pixels[c * plane + p] = Math.fround(
              Math.fround((image[p * 3 + c] ?? 0) / 255) * (1 - hole),
            )
          }
        }

        const result = yield* Effect.tryPromise({
          try: () =>
            session.run({
              image: new onnx.ort.Tensor('float32', pixels, [1, 3, padH, padW]),
              mask: new onnx.ort.Tensor('float32', holes, [1, 1, padH, padW]),
            }),
          catch: (error) => failed(`Inpainting failed: ${String(error)}`),
        })

        const output = result['output']?.data

        if (!(output instanceof Float32Array)) {
          return yield* failed('Inpainting returned no image.')
        }

        let painted = new Uint8Array(plane * 3)

        for (let p = 0; p < plane; p += 1) {
          for (let c = 0; c < 3; c += 1) {
            painted[p * 3 + c] = Math.trunc(Math.fround((output[c * plane + p] ?? 0) * 255))
          }
        }

        if (padW !== width || padH !== height) {
          painted = resizedCrop(cv, painted, padW, padH, 3, width, height, false)
        }

        const out = Uint8Array.from(crop)

        for (let p = 0; p < width * height; p += 1) {
          if ((cropMask[p] ?? 0) >= 127) {
            out[p * 3] = painted[p * 3] ?? 0
            out[p * 3 + 1] = painted[p * 3 + 1] ?? 0
            out[p * 3 + 2] = painted[p * 3 + 2] ?? 0
          }
        }

        return out
      })

      const inpaint = Effect.fn('Inpainter.inpaint')(function* (
        image: RgbImage,
        mask: Uint8Array,
        options: InpaintOptions,
      ) {
        if (options.wholePage) {
          const data = yield* fill(image.data, mask, image.width, image.height, options.size)

          return { width: image.width, height: image.height, data }
        }

        const result = Uint8Array.from(image.data)

        for (const [x1, y1, x2, y2] of crops(cv, mask, image.width, image.height)) {
          const w = x2 - x1
          const h = y2 - y1
          const crop = new Uint8Array(w * h * 3)
          const cropMask = new Uint8Array(w * h)

          for (let row = 0; row < h; row += 1) {
            const start = ((y1 + row) * image.width + x1) * 3

            crop.set(image.data.subarray(start, start + w * 3), row * w * 3)

            cropMask.set(
              mask.subarray((y1 + row) * image.width + x1, (y1 + row) * image.width + x2),
              row * w,
            )
          }

          const filled = yield* fill(crop, cropMask, w, h, options.size)

          for (let row = 0; row < h; row += 1) {
            result.set(
              filled.subarray(row * w * 3, (row + 1) * w * 3),
              ((y1 + row) * image.width + x1) * 3,
            )
          }
        }

        return { width: image.width, height: image.height, data: result }
      })

      return Inpainter.of({ inpaint })
    }),
  )
}
