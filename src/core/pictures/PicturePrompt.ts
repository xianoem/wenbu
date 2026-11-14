import { Effect, Schema } from 'effect'
import type { PictureLine } from '#contract/Pictures'
import { budgetOf } from '../ingametext/InGameText'

export const pictureSystemPrompt =
  'You translate the text in pictures from Japanese RPG Maker games: titles, labels, buttons and status screens.'

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

/** Lettering in a picture is drawn at about 80% of the line's height. */
export const fontSizeOf = (line: PictureLine) => Math.max(8, Math.round(line.h * 0.8))

export const picturePrompt = Effect.fnUntraced(function* (
  targetLanguage: string,
  lines: ReadonlyArray<PictureLine>,
  seesPicture: boolean,
) {
  const items = Object.fromEntries(
    lines.map((line) => {
      const max = budgetOf(line.w, fontSizeOf(line))

      return [
        String(line.id),
        max === undefined ? { text: line.source } : { text: line.source, max },
      ]
    }),
  )

  const check = seesPicture
    ? 'Compare each line with the picture and correct characters OCR misread; keep a line as it is when it was read right.'
    : 'Correct obvious misreadings, such as テータ for データ; keep a line as it is otherwise.'

  return [
    seesPicture
      ? 'OCR read these lines of text in the attached picture, numbered by their position.'
      : 'OCR read these lines of text in a game picture, numbered by their position.',
    yield* Effect.orDie(encodeJson(items)),
    check,
    `Then translate each line into ${targetLanguage} with the short wording a game uses for titles, labels and buttons. Stay within "max" characters when it is given.`,
    'Reply with only a JSON object whose keys are the line numbers and whose values are {"source": the corrected Japanese, "translation": the translation}.',
  ].join('\n\n')
})

const Reply = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({ source: Schema.optional(Schema.String), translation: Schema.String }),
  ),
)

const decodeReply = Schema.decodeUnknownEffect(Reply)

export interface TranslatedLine {
  readonly line: number
  readonly source: string
  readonly translation: string
}

export const parsePictureReply = Effect.fnUntraced(function* (
  text: string,
  lines: ReadonlyArray<PictureLine>,
) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const reply = yield* decodeReply(start < 0 || end < start ? text : text.slice(start, end + 1))

  return lines.flatMap((line): ReadonlyArray<TranslatedLine> => {
    const answer = reply[String(line.id)]
    const translation = answer?.translation.trim() ?? ''

    if (answer === undefined || translation === '') {
      return []
    }

    const corrected = answer.source?.trim() ?? ''

    return [{ line: line.id, source: corrected === '' ? line.source : corrected, translation }]
  })
})
