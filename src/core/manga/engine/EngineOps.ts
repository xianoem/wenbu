import { Context, Effect, FileSystem, Layer, Option, Predicate } from 'effect'
import { MangaError } from '#contract/Manga'
import type { EditorRequest } from '../MangaRuntime'
import { blendPatch, cleanPlan, pageOf, settlePaper, textArea } from './CleanPlan'
import { roundHalfEven } from './DbBoxes'
import { Lettering, type LetterBlock, type LetterOptions } from './Lettering'
import { splitWords } from './LineBreaking'
import { Images, type RgbImage } from './Images'
import { Inpainter } from './Inpaint'
import { OpenCv, type Cv } from './OpenCv'
import { Scanner } from './Scanner'
import { bytes } from './Bytes'

export type EditorOp = EditorRequest

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const notPorted = (op: string) => failed(`The native engine cannot ${op} pages yet.`)

const defaultInpaintingSize = 2048

/** Targets the plugin letters horizontally whatever the block's shape (LANGUAGE_ORIENTATION_PRESETS). */
const horizontalTargets = new Set([
  'CSY',
  'NLD',
  'ENG',
  'FRA',
  'DEU',
  'HUN',
  'ITA',
  'KOR',
  'PLK',
  'PTB',
  'ROM',
  'RUS',
  'ESP',
  'TRK',
  'UKR',
  'VIN',
  'ARA',
  'FIL',
])

type OptionValue = EditorOp['options'][string] | undefined

const hexColour = (value: OptionValue): readonly [number, number, number] | undefined => {
  if (!Predicate.isString(value) || !/^[0-9a-f]{6}$/iu.test(value)) {
    return undefined
  }

  const channel = (at: number) => Number.parseInt(value.slice(at, at + 2), 16)

  return [channel(0), channel(2), channel(4)]
}

const numberOption = (value: OptionValue, fallback: number) =>
  Predicate.isNumber(value) ? value : fallback

const letterOptions = (options: EditorOp['options']): LetterOptions => ({
  fontDir: Predicate.isString(options['font_dir']) ? options['font_dir'] : '',
  minFontSize: numberOption(options['min_font_size'], 12),
  maxFontSize: numberOption(options['max_font_size'], 100),
  supersampling: numberOption(options['supersampling'], 4),
  border: options['text_border'] !== false,
  borderColor: hexColour(options['border_color']) ?? [255, 255, 255],
  textColor: hexColour(options['text_color']),
  uppercase: options['uppercase'] === true,
})

/** Pillow's convert('L'): ITU-R 601-2 luma in fixed point. */
const luma = (image: RgbImage) =>
  bytes(
    image.width * image.height,
    (p) =>
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
      const scanner = yield* Scanner
      const lettering = yield* Lettering
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
          const stroke = bytes(original.width * original.height, (p) =>
            (brush[p * 3] ?? 0) >= 127 ? 255 : 0,
          )

          cleaned = blendPatch(cv, original, cleaned, stroke)
        }

        yield* images.write(output, cleaned)

        return {}
      })

      /** region_of: a one-line block, lettered in its bubble's text area unless the editor moved it. */
      const letterBlockOf = (
        request: EditorOp,
        block: NonNullable<EditorOp['blocks']>[number],
        plan: ReturnType<typeof pageOf>,
      ): LetterBlock => {
        const [x1, y1, x2, y2] = block.box.map((edge) => roundHalfEven(edge))
        const target = request.options['target_language']
        const left = x1 ?? 0
        const top = y1 ?? 0
        const right = x2 ?? 0
        const bottom = y2 ?? 0
        const horizontal = Predicate.isString(target) && horizontalTargets.has(target)
        const area = block.lettering?.textBox ?? textArea(plan, block.box)

        return {
          region: {
            xyxy: [left, top, right, bottom],
            text: block.text ?? ' ',
            translation: block.translation ?? '',
            vertical: !horizontal && right - left < bottom - top,
            textBox: area,
          },
          fg: [block.fg?.[0] ?? 0, block.fg?.[1] ?? 0, block.fg?.[2] ?? 0],
          bg: [block.bg?.[0] ?? 255, block.bg?.[1] ?? 255, block.bg?.[2] ?? 255],
          lettering: {
            breakMode: block.lettering?.breakMode,
            avoidOrphans: block.lettering?.avoidOrphans,
            hyphenate: block.lettering?.hyphenate,
            uppercase: block.lettering?.uppercase,
            size: block.lettering?.size,
            fontDir: block.lettering?.fontDir,
            leading: block.lettering?.leading,
          },
        }
      }

      const render = Effect.fn('EngineOps.render')(function* (request: EditorOp) {
        const output = yield* required(request.output, 'output')
        const original = yield* images.read(request.source)
        const cleanedPath = request.cleaned

        const base =
          cleanedPath !== undefined && cleanedPath !== '' && (yield* exists(cleanedPath))
            ? yield* images.read(cleanedPath)
            : original

        const plan = pageOf(cv, original)

        const blocks = (request.blocks ?? [])
          .filter((block) => (block.translation ?? '').trim() !== '')
          .map((block) => letterBlockOf(request, block, plan))

        const lettered = yield* lettering.render(
          base,
          original,
          blocks,
          letterOptions(request.options),
        )

        yield* images.write(output, lettered)

        return {}
      })

      const breaks = Effect.fn('EngineOps.breaks')(function* (request: EditorOp) {
        const [block] = request.blocks ?? []

        if (block === undefined) {
          return yield* failed('Line breaks need one block.')
        }

        const original = yield* images.read(request.source)
        const letter = letterBlockOf(request, block, pageOf(cv, original))

        const candidates = yield* lettering.breaks(
          original,
          {
            ...letter,
            region: {
              ...letter.region,
              translation: splitWords(letter.region.translation).join(' '),
            },
          },
          letterOptions(request.options),
        )

        return { candidates }
      })

      return EngineOps.of({
        editor: Effect.fn('EngineOps.editor')(function* (request: EditorOp) {
          if (request.op === 'clean') {
            return yield* clean(request)
          }

          if (request.op === 'render') {
            return yield* render(request)
          }

          if (request.op === 'breaks') {
            return yield* breaks(request)
          }

          if (request.op === 'scan') {
            const target = request.options['target_language']
            const screenAi = request.options['screen_ai']

            return yield* scanner.scan(
              request.source,
              yield* required(request.mask, 'mask'),
              Predicate.isString(target) ? target : 'ENG',
              Predicate.isString(screenAi) && screenAi !== ''
                ? Option.some(screenAi)
                : Option.none(),
            )
          }

          return yield* notPorted(request.op)
        }),
      })
    }),
  )
}
