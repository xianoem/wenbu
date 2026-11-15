import { describe, expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { blockColours } from './Colours'
import { OpenCv } from './OpenCv'

const page = (ink: readonly [number, number, number], paper: readonly [number, number, number]) => {
  const width = 40
  const height = 30
  const data = new Uint8Array(width * height * 3)

  for (let p = 0; p < width * height; p += 1) {
    const x = p % width
    const stroke = x % 10 === 4 || x % 10 === 5

    data.set(stroke ? ink : paper, p * 3)
  }

  return { width, height, data }
}

describe('blockColours', () => {
  layer(OpenCv.layer)((it) => {
    it.effect('takes the minority grey side as ink and the rest as paper', () =>
      Effect.gen(function* () {
        const { cv } = yield* OpenCv

        expect(blockColours(cv, page([20, 30, 40], [250, 240, 230]), [0, 0, 40, 30])).toEqual({
          fg: [20, 30, 40],
          bg: [250, 240, 230],
        })
      }),
    )

    it.effect('falls back to white or black paper when the colours are too close', () =>
      Effect.gen(function* () {
        const { cv } = yield* OpenCv

        expect(blockColours(cv, page([100, 100, 100], [104, 104, 104]), [0, 0, 40, 30]).bg).toEqual(
          [255, 255, 255],
        )
      }),
    )
  })
})
