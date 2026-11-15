import { Context, Effect, FileSystem, Layer, Predicate } from 'effect'
import { MangaError } from '#contract/Manga'
import type { EditorRequest } from '../MangaRuntime'
import { blendPatch, cleanPlan, pageOf, settlePaper } from './CleanPlan'
import { Images, type RgbImage } from './Images'
import { Inpainter } from './Inpaint'
import { OpenCv, type Cv } from './OpenCv'

export type EditorOp = EditorRequest

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const notPorted = (op: string) => failed(`The native engine cannot ${op} pages yet.`)

const defaultInpaintingSize = 2048

/** Pillow's convert('L'): ITU-R 601-2 luma in fixed point. */
const luma = (image: RgbImage) =>
  Uint8Array.from(
    { length: image.width * image.height },
    (_, p) =>
      ((image.data[p * 3] ?? 0) * 19595 +
        (image.data[p * 3 + 1] ?? 0) * 38470 +
        (image.data[p * 3 + 2] ?? 0) * 7471 +
        0x8000) >>
      16,
  )

/** cv2.resize with INTER_NEAREST, as the worker does when a mask or brush has another size. */
const nearest = (cv: Cv, data: Uint8Array, from: RgbImage, width: number, height: number) => {
  const channels = data.length / (from.width * from.height)

  const source = cv.matFromArray(
    from.height,
    from.width,
    channels === 3 ? cv.CV_8UC3 : cv.CV_8UC1,
    data,
  )

  const target = new cv.Mat()

  cv.resize(source, target, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST)

  const out = Uint8Array.from(target.data)

  source.delete()
  target.delete()

  return out
}

const fitted = (cv: Cv, data: Uint8Array, from: RgbImage, page: RgbImage) =>
  from.width === page.width && from.height === page.height
    ? data
    : nearest(cv, data, from, page.width, page.height)

export class EngineOps extends Context.Service<
  EngineOps,
  {
    readonly editor: (request: EditorOp) => Effect.Effect<unknown, MangaError>
  }
>()('wenbu/core/manga/engine/EngineOps') {
  static readonly layer = Layer.effect(
    EngineOps,
    Effect.gen(function* () {
      const images = yield* Images
      const inpainter = yield* Inpainter
      const { cv } = yield* OpenCv
      const fs = yield* FileSystem.FileSystem

      const required = (value: string | undefined, name: string) =>
        Predicate.isString(value) && value !== ''
          ? Effect.succeed(value)
          : Effect.fail(failed(`The ${name} path is missing.`))

      const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false))

      /** open_mask: a missing file is an empty mask. */
      const readMask = Effect.fnUntraced(function* (file: string | undefined, page: RgbImage) {
        if (file === undefined || file === '' || !(yield* exists(file))) {
          return new Uint8Array(page.width * page.height)
        }

        const image = yield* images.read(file, 'dropped')

        return fitted(cv, luma(image), image, page)
      })

      /** open_brush: red marks pixels to inpaint, green pixels to keep. */
      const readBrush = Effect.fnUntraced(function* (file: string | undefined, page: RgbImage) {
        if (file === undefined || file === '' || !(yield* exists(file))) {
          return undefined
        }

        const image = yield* images.read(file, 'dropped')

        return fitted(cv, image.data, image, page)
      })

      const clean = Effect.fn('EngineOps.clean')(function* (request: EditorOp) {
        const output = yield* required(request.output, 'output')
        const original = yield* images.read(request.source)
        const scan = yield* readMask(request.mask, original)
        const brush = yield* readBrush(request.brush, original)
        const blocks = request.blocks ?? []
        const page = pageOf(cv, original)
        const { filled, inpaint } = cleanPlan(page, scan, blocks, brush)

        if (!inpaint.some((value) => value > 0)) {
          yield* images.write(output, filled)

          return {}
        }

        const size = request.options['inpainting_size']

        const painted = yield* inpainter.inpaint(filled, inpaint, {
          size: Predicate.isNumber(size) ? size : defaultInpaintingSize,
          wholePage: request.options['inpainting'] === 'page',
        })

        let cleaned: RgbImage = settlePaper(page, painted, blocks, inpaint)

        if (brush !== undefined) {
          const stroke = Uint8Array.from({ length: original.width * original.height }, (_, p) =>
            (brush[p * 3] ?? 0) >= 127 ? 255 : 0,
          )

          cleaned = blendPatch(cv, original, cleaned, stroke)
        }

        yield* images.write(output, cleaned)

        return {}
      })

      return EngineOps.of({
        editor: Effect.fn('EngineOps.editor')(function* (request: EditorOp) {
          if (request.op === 'clean') {
            return yield* clean(request)
          }

          return yield* notPorted(request.op)
        }),
      })
    }),
  )
}
