import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { decodeLensResponse, encodeLensRequest, lensTypes } from './GoogleLens'

const box = (centerX: number, centerY: number) => ({
  geometry: { bounding_box: { center_x: centerX, center_y: centerY, width: 0.2, height: 0.1 } },
})

const response = lensTypes.response
  .encode(
    lensTypes.response.fromObject({
      objects_response: {
        text: {
          text_layout: {
            paragraphs: [
              {
                ...box(0.5, 0.2),
                lines: [
                  {
                    ...box(0.5, 0.2),
                    words: [
                      { plain_text: 'こんにちは', text_separator: '', ...box(0.4, 0.2) },
                      { plain_text: '世界', ...box(0.6, 0.2) },
                    ],
                  },
                ],
              },
              { lines: [{ words: [{ plain_text: 'Wenbu', text_separator: ' ' }] }] },
            ],
          },
        },
      },
    }),
  )
  .finish()

describe('GoogleLens', () => {
  it.effect('reads paragraphs, lines and words with their boxes', () =>
    Effect.gen(function* () {
      const ocr = yield* decodeLensResponse(response, { width: 800, height: 600 })

      expect(ocr.image).toEqual({ width: 800, height: 600 })

      expect(ocr.paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text))).toEqual([
        ['こんにちは世界'],
        ['Wenbu'],
      ])

      expect(ocr.paragraphs[0]?.lines[0]?.words[1]?.box).toEqual({
        centerX: expect.closeTo(0.6),
        centerY: expect.closeTo(0.2),
        width: expect.closeTo(0.2),
        height: expect.closeTo(0.1),
      })
    }),
  )

  it.effect('sends the image as PNG with its size', () =>
    Effect.gen(function* () {
      const png = Uint8Array.from([137, 80, 78, 71])

      const request = lensTypes.request.decode(
        yield* encodeLensRequest({ png, width: 4, height: 2 }),
      )

      const object = lensTypes.request.toObject(request, { longs: Number })

      expect(object['objects_request'].image_data.image_metadata).toEqual({ width: 4, height: 2 })
      expect([...object['objects_request'].image_data.payload.image_bytes]).toEqual([...png])
    }),
  )

  it.effect('fails on bytes that are not a Lens response', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeLensResponse(Uint8Array.from([255, 255, 255]), { width: 1, height: 1 }),
      )

      expect(error.message).toBe('Google Lens returned data Wenbu could not read.')
    }),
  )
})
