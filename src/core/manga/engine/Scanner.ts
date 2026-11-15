import { Context, Effect, Layer, Option, Path } from 'effect'
import type { OcrResult } from '#contract/Detections'
import { ScreenAiOcr } from '../../detections/ScreenAiOcr'
import type { MangaError } from '#contract/Manga'
import { pageOf, textArea } from './CleanPlan'
import { blockColours } from './Colours'
import { Detector } from './Detector'
import { Images, type RgbImage } from './Images'
import { findPanels } from './Kumiko'
import { MangaCv } from './MangaCv'
import { refineMask } from './MaskRefine'
import { Onnx } from './Onnx'
import { OpenCv } from './OpenCv'
import { crop } from './PillowResize'
import { Reader, type Reading } from './Reader'
import { assignDirections, mergeLines, sortBlocks, type Block } from './TextMerge'
import { filteredText, loadLanguageId } from './TextFilter'

/**
 * The Manga Editor's scan: text lines are detected, merged into blocks and put in reading order by
 * panel; each block is read, blocks the plugin's filters or a weak reading reject are dropped, and the
 * refined text mask is written for the remaining ones.
 */

export interface ScannedBlock {
  readonly box: readonly [number, number, number, number]
  readonly area: readonly [number, number, number, number] | null
  readonly text: string
  readonly fg: readonly [number, number, number]
  readonly bg: readonly [number, number, number]
  readonly fontSize: number
  readonly vertical: boolean
  readonly confidence: number
}

export interface Scan {
  readonly width: number
  readonly height: number
  readonly blocks: ReadonlyArray<ScannedBlock>
}

const pageId = 1
const rightToLeft = true

/** Readings whose mean token log-probability is below this are noise, not text. */
export const minimumConfidence = -1

const blockCrop = (page: RgbImage, block: Block) => {
  const [x1, y1, x2, y2] = block.xyxy

  return crop(
    page,
    Math.max(0, Math.trunc(x1)),
    Math.max(0, Math.trunc(y1)),
    Math.min(page.width, Math.trunc(x2)),
    Math.min(page.height, Math.trunc(y2)),
  )
}

/** Hayai loops on long, wide horizontal text; such blocks go to Screen AI when it is installed. */
const needsScreenAi = (block: Block, reading: Reading) =>
  !block.vertical && (reading.repeated || reading.capped)

const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

const screenAiText = (result: OcrResult) => {
  const lines = result.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => line.text))

  return lines.join(lines.some((line) => hasCjk.test(line)) ? '' : ' ')
}

const rgba = (image: RgbImage) => {
  const pixels = new Uint8Array(image.width * image.height * 4)

  for (let p = 0; p < image.width * image.height; p += 1) {
    pixels.set(image.data.subarray(p * 3, p * 3 + 3), p * 4)
    pixels[p * 4 + 3] = 255
  }

  return { width: image.width, height: image.height, pixels }
}

const kept = (reading: Reading, target: string, languageId: Parameters<typeof filteredText>[2]) => {
  if (reading.confidence < minimumConfidence) {
    return undefined
  }

  return filteredText(reading.text, target, languageId)
}

export class Scanner extends Context.Service<
  Scanner,
  {
    readonly scan: (
      source: string,
      mask: string,
      target: string,
      screenAi: Option.Option<string>,
    ) => Effect.Effect<Scan, MangaError>
  }
>()('wenbu/core/manga/engine/Scanner') {
  static readonly layer = Layer.effect(
    Scanner,
    Effect.gen(function* () {
      const images = yield* Images
      const detector = yield* Detector
      const reader = yield* Reader
      const screenAiOcr = yield* ScreenAiOcr
      const helper = yield* MangaCv
      const { cv } = yield* OpenCv
      const onnx = yield* Onnx
      const path = yield* Path.Path
      const languageId = yield* loadLanguageId(path.join(onnx.models, 'langid.bin'))

      /** Screen AI's reading of a block Hayai could not finish, or Hayai's own when that fails. */
      const fallback = Effect.fnUntraced(function* (
        folder: Option.Option<string>,
        image: RgbImage,
        reading: Reading,
      ) {
        if (Option.isNone(folder)) {
          return reading
        }

        const result = yield* Effect.option(screenAiOcr.recognize(folder.value, rgba(image)))

        return Option.match(result, {
          onNone: () => reading,
          onSome: (ocr): Reading => ({
            ...reading,
            text: screenAiText(ocr),
            confidence: 0,
            repeated: false,
            capped: false,
          }),
        })
      })

      const scan = Effect.fn('Scanner.scan')(function* (
        source: string,
        mask: string,
        target: string,
        screenAi: Option.Option<string>,
      ) {
        const page = yield* images.read(source)
        const { width, height } = page
        const detection = yield* detector.detect(page)

        if (detection.lines.length === 0) {
          yield* images.write(mask, { width, height, data: new Uint8Array(width * height) })

          return { width, height, blocks: [] }
        }

        yield* helper.put(pageId, { ...page, channels: 3 })

        const result = yield* Effect.gen(function* () {
          const features = yield* helper.panelFeatures(pageId)
          const panels = findPanels(cv, width, height, features, rightToLeft)

          const blocks = sortBlocks(
            mergeLines(assignDirections(detection.lines)),
            panels,
            rightToLeft,
          )

          const crops = blocks.map((block) => blockCrop(page, block))
          const hayai = yield* reader.read(crops)

          const readings = yield* Effect.forEach(blocks, (block, index) => {
            const reading = hayai[index]
            const image = crops[index]

            return reading !== undefined && image !== undefined && needsScreenAi(block, reading)
              ? fallback(screenAi, image, reading)
              : Effect.succeed(reading)
          })

          const found = blocks.flatMap((block, index) => {
            const reading = readings[index]
            const text = reading === undefined ? undefined : kept(reading, target, languageId)

            return text === undefined || reading === undefined ? [] : [{ block, text, reading }]
          })

          const refined = yield* refineMask(
            cv,
            helper,
            page,
            detection.rawMask,
            found.flatMap(({ block }) => block.lines.map((line) => line.pts)),
          )

          return { found, refined }
        }).pipe(Effect.ensuring(helper.drop(pageId).pipe(Effect.ignore)))

        yield* images.write(mask, { width, height, data: result.refined })

        const plan = pageOf(cv, page)

        const scanned = result.found.map(({ block, text, reading }): ScannedBlock => {
          const [x1, y1, x2, y2] = block.xyxy
          const box = [Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2)] as const
          const { fg, bg } = blockColours(cv, page, box)

          return {
            box,
            area: textArea(plan, box) ?? null,
            text,
            fg,
            bg,
            fontSize: Math.trunc(block.fontSize),
            vertical: block.vertical,
            confidence: reading.confidence,
          }
        })

        return { width, height, blocks: scanned }
      })

      return Scanner.of({ scan })
    }),
  )
}
