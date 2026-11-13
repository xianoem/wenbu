import { describe, expect, it } from '@effect/vitest'
import { overlayPlacement } from './overlayPlacement'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 984 }

describe('overlayPlacement', () => {
  it('opens near the top left of the primary display the first time', () => {
    expect(overlayPlacement(undefined, [primary, second])).toEqual({
      x: 80,
      y: 80,
      width: 760,
      height: 190,
    })
  })

  it('keeps saved bounds that are on a display', () => {
    const bounds = { x: 2000, y: 700, width: 800, height: 200 }

    expect(overlayPlacement(bounds, [primary, second])).toEqual(bounds)
  })

  it('pulls a window back onto the display it mostly covers', () => {
    expect(
      overlayPlacement({ x: 2900, y: 900, width: 800, height: 200 }, [primary, second]),
    ).toEqual({ x: 2400, y: 784, width: 800, height: 200 })
  })

  it('moves a window from a disconnected display onto the primary one', () => {
    expect(overlayPlacement({ x: 5000, y: 300, width: 800, height: 200 }, [primary])).toEqual({
      x: 1120,
      y: 300,
      width: 800,
      height: 200,
    })
  })

  it('keeps the minimum size and fits the display', () => {
    expect(overlayPlacement({ x: 10, y: 10, width: 100, height: 4000 }, [primary])).toEqual({
      x: 10,
      y: 0,
      width: 360,
      height: 1040,
    })
  })
})
