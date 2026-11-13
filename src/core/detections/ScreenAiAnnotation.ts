import { Effect, Schema } from 'effect'
import { Base64 } from 'effect/encoding'
import protobuf from 'protobufjs'
import { DetectionError, type OcrBox, type OcrLine, type OcrResult } from '#contract/Detections'
import schema from './proto/screenAi.json' with { type: 'json' }

const VisualAnnotation = protobuf.Root.fromJSON(schema).lookupType(
  'chrome_screen_ai.VisualAnnotation',
)

const Rect = Schema.Struct({
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.optional(Schema.Finite),
  height: Schema.optional(Schema.Finite),
  angle: Schema.optional(Schema.Finite),
})

const WordBox = Schema.Struct({
  utf8_string: Schema.optional(Schema.String),
  bounding_box: Schema.optional(Rect),
  has_space_after: Schema.optional(Schema.Boolean),
  confidence: Schema.optional(Schema.Finite),
})

const LineBox = Schema.Struct({
  words: Schema.optional(Schema.Array(WordBox)),
  bounding_box: Schema.optional(Rect),
  utf8_string: Schema.optional(Schema.String),
  block_id: Schema.optional(Schema.Int),
  paragraph_id: Schema.optional(Schema.Int),
})

const Annotation = Schema.Struct({ lines: Schema.optional(Schema.Array(LineBox)) })

const decodeAnnotation = Schema.decodeUnknownEffect(Annotation)

export interface ImageSize {
  readonly width: number
  readonly height: number
}

const unreadable = () =>
  new DetectionError({ reason: 'failed', message: 'Screen AI returned data Wenbu could not read.' })

const boxOf = (rect: typeof Rect.Type | undefined, size: ImageSize): OcrBox | undefined => {
  if (rect === undefined) {
    return undefined
  }

  const width = rect.width ?? 0
  const height = rect.height ?? 0
  const radians = ((rect.angle ?? 0) * Math.PI) / 180
  const centerX = (rect.x ?? 0) + (width / 2) * Math.cos(radians) - (height / 2) * Math.sin(radians)
  const centerY = (rect.y ?? 0) + (width / 2) * Math.sin(radians) + (height / 2) * Math.cos(radians)

  return {
    centerX: centerX / size.width,
    centerY: centerY / size.height,
    width: width / size.width,
    height: height / size.height,
    ...(radians === 0 ? {} : { rotation: radians }),
  }
}

const unionBox = (lines: ReadonlyArray<OcrLine>): OcrBox | undefined => {
  const boxes = lines.flatMap((line) => (line.box === undefined ? [] : [line.box]))

  if (boxes.length === 0) {
    return undefined
  }

  const left = Math.min(...boxes.map((box) => box.centerX - box.width / 2))
  const right = Math.max(...boxes.map((box) => box.centerX + box.width / 2))
  const top = Math.min(...boxes.map((box) => box.centerY - box.height / 2))
  const bottom = Math.max(...boxes.map((box) => box.centerY + box.height / 2))

  return {
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  }
}

export const decodeScreenAiAnnotation = Effect.fn('decodeScreenAiAnnotation')(function* (
  base64: string,
  sent: ImageSize,
  original: ImageSize = sent,
) {
  const bytes = yield* Effect.mapError(Effect.fromResult(Base64.decode(base64)), unreadable)

  const object = yield* Effect.try({
    try: () =>
      VisualAnnotation.toObject(VisualAnnotation.decode(bytes), {
        enums: String,
        longs: Number,
        defaults: false,
      }),
    catch: unreadable,
  })

  const annotation = yield* Effect.mapError(decodeAnnotation(object), unreadable)
  const paragraphs = new Map<string, Array<OcrLine>>()

  for (const line of annotation.lines ?? []) {
    const words = (line.words ?? []).map((word) => ({
      text: word.utf8_string ?? '',
      ...(word.has_space_after === true ? { separator: ' ' } : {}),
      ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
      ...(word.bounding_box === undefined ? {} : { box: boxOf(word.bounding_box, sent) }),
    }))

    const ocrLine: OcrLine = {
      text:
        line.utf8_string ??
        words
          .map((word) => `${word.text}${word.separator ?? ''}`)
          .join('')
          .trim(),
      ...(line.bounding_box === undefined ? {} : { box: boxOf(line.bounding_box, sent) }),
      words,
    }

    const key = `${line.block_id ?? 0}:${line.paragraph_id ?? 0}`

    paragraphs.set(key, [...(paragraphs.get(key) ?? []), ocrLine])
  }

  const result: OcrResult = {
    image: { width: original.width, height: original.height },
    paragraphs: [...paragraphs.values()].map((lines) => {
      const box = unionBox(lines)

      return box === undefined ? { lines } : { box, lines }
    }),
  }

  return result
})
