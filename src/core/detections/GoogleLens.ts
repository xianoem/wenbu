import { Context, Effect, Layer, Random, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import protobuf from 'protobufjs'
import { DetectionError, type OcrBox, type OcrResult, type RgbaImage } from '#contract/Detections'
import schema from './proto/lens.json' with { type: 'json' }
import { encodePng, fitWithin } from './RgbaImages'
import type { ImageSize } from './ScreenAiAnnotation'

const root = protobuf.Root.fromJSON(schema)

export const lensTypes = {
  request: root.lookupType('lens.LensOverlayServerRequest'),
  response: root.lookupType('lens.LensOverlayServerResponse'),
}

const endpoint = 'https://lensfrontend-pa.googleapis.com/v1/crupload'
const apiKey = 'AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY'
const maxPixels = 3_000_000

const Geometry = Schema.Struct({
  bounding_box: Schema.optional(
    Schema.Struct({
      center_x: Schema.Finite,
      center_y: Schema.Finite,
      width: Schema.Finite,
      height: Schema.Finite,
      rotation_z: Schema.optional(Schema.Finite),
    }),
  ),
})

const Word = Schema.Struct({
  plain_text: Schema.optional(Schema.String),
  text_separator: Schema.optional(Schema.String),
  geometry: Schema.optional(Geometry),
})

const Line = Schema.Struct({
  words: Schema.optional(Schema.Array(Word)),
  geometry: Schema.optional(Geometry),
})

const Paragraph = Schema.Struct({
  lines: Schema.optional(Schema.Array(Line)),
  geometry: Schema.optional(Geometry),
})

const Response = Schema.Struct({
  objects_response: Schema.optional(
    Schema.Struct({
      text: Schema.optional(
        Schema.Struct({
          text_layout: Schema.optional(
            Schema.Struct({ paragraphs: Schema.optional(Schema.Array(Paragraph)) }),
          ),
        }),
      ),
    }),
  ),
})

const decodeResponseObject = Schema.decodeUnknownEffect(Response)

const failed = (message: string) => new DetectionError({ reason: 'failed', message })

const unreadable = () => failed('Google Lens returned data Wenbu could not read.')

const boxOf = (geometry: typeof Geometry.Type | undefined): { box?: OcrBox } => {
  const box = geometry?.bounding_box

  return box === undefined
    ? {}
    : {
        box: {
          centerX: box.center_x,
          centerY: box.center_y,
          width: box.width,
          height: box.height,
          ...(box.rotation_z === undefined || box.rotation_z === 0
            ? {}
            : { rotation: box.rotation_z }),
        },
      }
}

export const decodeLensResponse = Effect.fn('decodeLensResponse')(function* (
  bytes: Uint8Array,
  original: ImageSize,
) {
  const object = yield* Effect.try({
    try: () =>
      lensTypes.response.toObject(lensTypes.response.decode(bytes), {
        enums: String,
        longs: Number,
      }),
    catch: unreadable,
  })

  const decoded = yield* Effect.mapError(decodeResponseObject(object), unreadable)
  const paragraphs = decoded.objects_response?.text?.text_layout?.paragraphs ?? []

  const result: OcrResult = {
    image: { width: original.width, height: original.height },
    paragraphs: paragraphs.map((paragraph) => ({
      ...boxOf(paragraph.geometry),
      lines: (paragraph.lines ?? []).map((line) => {
        const words = (line.words ?? []).map((word) => ({
          text: word.plain_text ?? '',
          ...(word.text_separator === undefined || word.text_separator === ''
            ? {}
            : { separator: word.text_separator }),
          ...boxOf(word.geometry),
        }))

        return {
          text: words
            .map((word) => `${word.text}${word.separator ?? ''}`)
            .join('')
            .trim(),
          ...boxOf(line.geometry),
          words,
        }
      }),
    })),
  }

  return result
})

export const encodeLensRequest = Effect.fn('encodeLensRequest')(function* (image: {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
}) {
  const uuid = yield* Random.nextIntBetween(1, Number.MAX_SAFE_INTEGER)

  const analyticsId = Uint8Array.from(
    yield* Effect.forEach(Array.from({ length: 16 }), () => Random.nextIntBetween(0, 256)),
  )

  const request = lensTypes.request.fromObject({
    objects_request: {
      request_context: {
        request_id: { uuid, sequence_id: 0, image_sequence_id: 0, analytics_id: analyticsId },
        client_context: {
          platform: 'PLATFORM_WEB',
          surface: 'SURFACE_CHROMIUM',
          locale_context: { language: 'ja', region: 'Asia/Tokyo', time_zone: '' },
          app_id: '',
          client_filters: { filter: [{ filter_type: 'AUTO_FILTER' }] },
        },
      },
      image_data: {
        payload: { image_bytes: image.png },
        image_metadata: { width: image.width, height: image.height },
      },
    },
  })

  return lensTypes.request.encode(request).finish()
})

export class GoogleLens extends Context.Service<
  GoogleLens,
  { readonly recognize: (image: RgbaImage) => Effect.Effect<OcrResult, DetectionError> }
>()('wenbu/core/detections/GoogleLens') {
  static readonly layer = Layer.effect(
    GoogleLens,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const recognize = Effect.fn('GoogleLens.recognize')(function* (image: RgbaImage) {
        const pixels = image.width * image.height

        const scaled =
          pixels > maxPixels
            ? fitWithin(
                image,
                Math.floor(Math.max(image.width, image.height) * Math.sqrt(maxPixels / pixels)),
              )
            : image

        const body = yield* encodeLensRequest({
          png: encodePng(scaled),
          width: scaled.width,
          height: scaled.height,
        })

        const request = HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.setHeaders({ 'X-Goog-Api-Key': apiKey }),
          HttpClientRequest.bodyUint8Array(body, 'application/x-protobuf'),
        )

        const bytes = yield* client.execute(request).pipe(
          Effect.flatMap((response) => response.arrayBuffer),
          Effect.timeout('20 seconds'),
          Effect.mapError(() => failed('Google Lens could not be reached.')),
        )

        return yield* decodeLensResponse(new Uint8Array(bytes), image)
      })

      return GoogleLens.of({ recognize })
    }),
  )
}
