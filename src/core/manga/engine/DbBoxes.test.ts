import { describe, expect, it, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { dbBoxes, roundHalfEven } from './DbBoxes'
import { OpenCv } from './OpenCv'
import { quad, quadArea } from './Quad'
import expected from './__fixtures__/db-boxes.json'

const width = 160
const height = 120

/** The map the fixture was made from with the plugin's SegDetectorRepresenter. */
const syntheticMap = () => {
  const pred = new Float32Array(width * height)

  const rotated = (
    cx: number,
    cy: number,
    w: number,
    h: number,
    degrees: number,
    value: number,
  ) => {
    const angle = (degrees * Math.PI) / 180

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const u = (x - cx) * Math.cos(angle) + (y - cy) * Math.sin(angle)
        const v = -(x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)

        if (Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2) {
          pred[y * width + x] = value
        }
      }
    }
  }

  rotated(40, 30, 50, 12, 0, 0.9)
  rotated(110, 70, 14, 60, 12, 0.8)
  rotated(50, 95, 30, 9, -20, 0.75)
  rotated(130, 20, 6, 6, 0, 0.95)
  rotated(20, 70, 20, 8, 0, 0.6)

  return pred
}

describe('dbBoxes', () => {
  layer(OpenCv.layer)((it) => {
    it.effect('finds the same boxes and scores as the plugin', () =>
      Effect.gen(function* () {
        const { cv } = yield* OpenCv
        const boxes = dbBoxes(cv, syntheticMap(), width, height, width, height)

        expect(boxes.map((box) => box.points.map((point) => [point.x, point.y]))).toEqual(
          expected.map((box) => box.pts),
        )

        boxes.forEach((box, index) => {
          expect(box.score).toBeCloseTo(expected[index]?.score ?? 0, 6)
        })
      }),
    )

    it.effect('orders corners, direction and area like Quadrilateral', () =>
      Effect.sync(() => {
        for (const box of expected) {
          const line = quad(
            box.pts.map(([x = 0, y = 0]) => ({ x, y })),
            box.score,
          )

          expect(line.pts.map((point) => [point.x, point.y])).toEqual(box.sorted)
          expect(line.vertical).toBe(box.vertical)
          expect(quadArea(line)).toBe(box.area)
        }
      }),
    )
  })

  it.effect('rounds halves to the even neighbour, as numpy does', () =>
    Effect.sync(() => {
      expect([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 0, 2, 3])
    }),
  )
})
