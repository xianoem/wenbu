import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { decodeScreenAiAnnotation } from './ScreenAiAnnotation'
import { ocrText } from './OcrText'

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const text = yield* fs.readFileString(
    path.join(import.meta.dirname, '__fixtures__', 'screen-ai-annotation.b64'),
  )

  return text.trim()
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie)

describe('decodeScreenAiAnnotation', () => {
  it.effect('reads lines and words with boxes in fractions of the image', () =>
    Effect.gen(function* () {
      const ocr = yield* decodeScreenAiAnnotation(yield* fixture, { width: 640, height: 160 })
      const lines = ocr.paragraphs.flatMap((paragraph) => paragraph.lines)

      expect(ocr.image).toEqual({ width: 640, height: 160 })
      expect(lines.map((line) => line.text)).toEqual(['Wenbu detects text', 'こんにちは世界'])
      expect(lines[0]?.words.map((word) => word.text)).toEqual(['Wenbu', 'detects', 'text'])

      const boxes = lines.flatMap((line) => [line.box, ...line.words.map((word) => word.box)])

      expect(boxes.every((box) => box !== undefined && box.centerX > 0 && box.centerX < 1)).toBe(
        true,
      )

      expect(ocrText(ocr)).toBe('Wenbu detects text\n\nこんにちは世界')
    }),
  )

  it.effect('scales boxes to the original image when Wenbu sent a smaller copy', () =>
    Effect.gen(function* () {
      const ocr = yield* decodeScreenAiAnnotation(
        yield* fixture,
        { width: 640, height: 160 },
        { width: 1280, height: 320 },
      )

      expect(ocr.image).toEqual({ width: 1280, height: 320 })
      expect(ocr.paragraphs[0]?.lines[0]?.box?.centerX).toBeLessThan(1)
    }),
  )

  it.effect('fails on bytes that are not an annotation', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeScreenAiAnnotation('////', { width: 10, height: 10 }))

      expect(error.message).toBe('Screen AI returned data Wenbu could not read.')
    }),
  )
})
