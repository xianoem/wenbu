import { describe, expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { dilateSquare, floodPaper, floodScratch } from './CleanPlan'
import { OpenCv } from './OpenCv'

const width = 257
const height = 191

const randomMask = (seed: number, density: number) => {
  let state = seed

  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648

    return state / 2147483648
  }

  return Uint8Array.from({ length: width * height }, () => (next() < density ? 1 : 0))
}

describe('CleanPlan', () => {
  layer(OpenCv.layer)((it) => {
    it.effect('dilates like cv.dilate with a 3x3 square', () =>
      Effect.gen(function* () {
        const { cv } = yield* OpenCv
        const mask = randomMask(7, 0.01)

        for (const iterations of [1, 2, 7]) {
          const source = cv.matFromArray(height, width, cv.CV_8UC1, mask)
          const out = new cv.Mat()
          const kernel = cv.Mat.ones(3, 3, cv.CV_8U)

          cv.dilate(source, out, kernel, new cv.Point(-1, -1), iterations)

          expect(
            Buffer.compare(
              Buffer.from(dilateSquare(mask, width, height, iterations)),
              Buffer.from(out.data),
            ),
          ).toBe(0)

          source.delete()
          out.delete()
          kernel.delete()
        }
      }),
    )

    it.effect('floods like cv.floodFill with 4-connectivity', () =>
      Effect.gen(function* () {
        const { cv } = yield* OpenCv
        const paper = randomMask(11, 0.55)
        const seed = [paper.indexOf(1) % width, Math.floor(paper.indexOf(1) / width)] as const
        const source = cv.matFromArray(height, width, cv.CV_8UC1, paper)
        const flooded = cv.Mat.zeros(height + 2, width + 2, cv.CV_8UC1)

        cv.floodFill(
          source,
          flooded,
          new cv.Point(seed[0], seed[1]),
          new cv.Scalar(1),
          new cv.Rect(),
          new cv.Scalar(0),
          new cv.Scalar(0),
          4 | (1 << 8) | cv.FLOODFILL_MASK_ONLY,
        )

        const expected = new Uint8Array(width * height)

        for (let row = 0; row < height; row += 1) {
          expected.set(
            flooded.data.subarray((row + 1) * (width + 2) + 1, (row + 1) * (width + 2) + 1 + width),
            row * width,
          )
        }

        const ours = floodPaper(
          paper,
          width,
          height,
          seed,
          width * height,
          floodScratch(width * height),
        )

        const filled = new Uint8Array(width * height)

        for (const p of ours.pixels) {
          filled[p] = 1
        }

        expect(ours.count).toBe(expected.filter((value) => value > 0).length)
        expect(Buffer.compare(Buffer.from(filled), Buffer.from(expected))).toBe(0)

        source.delete()
        flooded.delete()
      }),
    )
  })
})
