import { describe, expect, it } from '@effect/vitest'
import { subtitlePlacement } from './subtitlePlacement'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 984 }

describe('subtitlePlacement', () => {
  it('opens bottom-centre on the active display, 70% of its width, the first time', () => {
    expect(subtitlePlacement(undefined, second, [primary, second])).toEqual({
      x: 2112,
      y: 688,
      width: 896,
      height: 200,
    })
  })

  it('keeps saved bounds that are on a display', () => {
    const bounds = { x: 300, y: 800, width: 1200, height: 180 }

    expect(subtitlePlacement(bounds, second, [primary, second])).toEqual(bounds)
  })

  it('moves saved bounds from a disconnected display onto the primary one', () => {
    expect(
      subtitlePlacement({ x: 5000, y: 800, width: 1200, height: 180 }, primary, [primary]),
    ).toEqual({ x: 720, y: 800, width: 1200, height: 180 })
  })
})
