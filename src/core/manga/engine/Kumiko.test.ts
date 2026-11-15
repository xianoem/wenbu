import { describe, expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { findPanels } from './Kumiko'
import { OpenCv } from './OpenCv'
import page from './__fixtures__/kumiko-page.json'

/** The fixture holds a drawn page's contours and line segments, and the panels the plugin's Kumiko found. */
const features = {
  contours: page.contours.map((contour) => contour.map(([x = 0, y = 0]) => ({ x, y }))),
  segments: Float32Array.from(page.segments),
}

const boxes = (rtl: boolean) =>
  Effect.gen(function* () {
    const { cv } = yield* OpenCv

    return findPanels(cv, page.width, page.height, features, rtl).map((p) => [
      p.x,
      p.y,
      p.width,
      p.height,
    ])
  })

describe('findPanels', () => {
  layer(OpenCv.layer)((it) => {
    it.effect('orders panels right to left like the plugin', () =>
      Effect.map(boxes(true), (found) => expect(found).toEqual(page.rtl)),
    )

    it.effect('orders panels left to right like the plugin', () =>
      Effect.map(boxes(false), (found) => expect(found).toEqual(page.ltr)),
    )
  })
})
