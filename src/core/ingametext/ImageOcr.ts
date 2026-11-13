import { Context, Effect, Layer, Option } from 'effect'
import type { OcrResult, RgbaImage } from '#contract/Detections'
import { InGameTextError } from '#contract/InGameText'
import { ScreenAiOcr } from '../detections/ScreenAiOcr'
import { Plugins } from '../plugins/Plugins'
import type { ImageBox } from './InGameTextStore'

const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/

const CJK_GAP = /([぀-ヿ㐀-鿿！-｠])\s+(?=[぀-ヿ㐀-鿿！-｠])/g

/** Screen AI reports nearly every line a fraction of a degree off level. */
const MAX_TILT = (3 * Math.PI) / 180

/** Screen AI puts spaces between Japanese words that the image never had. */
export const cleanLine = (text: string) => text.replace(CJK_GAP, '$1').trim()

export const textBoxes = (ocr: OcrResult): ReadonlyArray<ImageBox> =>
  ocr.paragraphs.flatMap((paragraph) =>
    paragraph.lines.flatMap((line): ReadonlyArray<ImageBox> => {
      const key = cleanLine(line.text)
      const box = line.box

      if (box === undefined || Math.abs(box.rotation ?? 0) > MAX_TILT || !JAPANESE.test(key)) {
        return []
      }

      const width = box.width * ocr.image.width
      const height = box.height * ocr.image.height

      return [
        {
          x: Math.max(0, Math.round(box.centerX * ocr.image.width - width / 2)),
          y: Math.max(0, Math.round(box.centerY * ocr.image.height - height / 2)),
          w: Math.max(1, Math.round(width)),
          h: Math.max(1, Math.round(height)),
          key,
        },
      ]
    }),
  )

export class ImageOcr extends Context.Service<
  ImageOcr,
  { readonly recognize: (image: RgbaImage) => Effect.Effect<OcrResult, InGameTextError> }
>()('wenbu/core/ingametext/ImageOcr') {
  static readonly layer = Layer.effect(
    ImageOcr,
    Effect.gen(function* () {
      const plugins = yield* Plugins
      const screenAi = yield* ScreenAiOcr

      const recognize = Effect.fn('ImageOcr.recognize')(function* (image: RgbaImage) {
        const folder = yield* plugins.installedFolder('screen-ai')

        if (Option.isNone(folder)) {
          return yield* new InGameTextError({
            reason: 'not-ready',
            message: 'Install Chrome Screen AI in Settings → Plugins to read text in images.',
          })
        }

        return yield* screenAi
          .recognize(folder.value, image)
          .pipe(
            Effect.mapError(
              (error) => new InGameTextError({ reason: 'failed', message: error.message }),
            ),
          )
      })

      return ImageOcr.of({ recognize })
    }),
  )
}
