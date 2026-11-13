import { describe, expect, it } from '@effect/vitest'
import { liveControlsPlacement } from './liveControlsPlacement'

describe('liveControlsPlacement', () => {
  it('opens in the top right of the display, shorter on small screens', () => {
    expect(liveControlsPlacement({ x: 1920, y: 0, width: 1280, height: 600 })).toEqual({
      x: 2616,
      y: 24,
      width: 560,
      height: 552,
    })
  })
})
