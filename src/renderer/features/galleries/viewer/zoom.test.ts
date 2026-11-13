import { assert, describe, it } from '@effect/vitest'
import { scrollAfterZoom, zoomBy } from './zoom'

describe('zoomBy', () => {
  it('zooms in and out by steps, from the fitted size up to eight times it', () => {
    assert.strictEqual(zoomBy(1, 1), 1.25)
    assert.strictEqual(zoomBy(1.25, -1), 1)
    assert.strictEqual(zoomBy(1, -3), 1)
    assert.strictEqual(zoomBy(7, 2), 8)
  })

  it('lands on the fitted size instead of just past it', () => {
    assert.strictEqual(zoomBy(1.1, -1), 1)
  })
})

describe('scrollAfterZoom', () => {
  it('keeps the point under the pointer where it was', () => {
    assert.deepStrictEqual(scrollAfterZoom({ left: 100, top: 50 }, { x: 200, y: 300 }, 1, 2), {
      left: 400,
      top: 400,
    })
  })

  it('moves back toward the start when zooming out', () => {
    assert.deepStrictEqual(scrollAfterZoom({ left: 0, top: 0 }, { x: 400, y: 300 }, 2, 1), {
      left: -200,
      top: -150,
    })
  })
})
