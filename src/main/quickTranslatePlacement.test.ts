import { describe, expect, it } from '@effect/vitest'
import {
  quickTranslateKeptPlacement,
  quickTranslatePlacement,
  quickTranslateSide,
} from './quickTranslatePlacement'

const area = { x: 0, y: 0, width: 1920, height: 1040 }
const size = { width: 772, height: 320 }

describe('quickTranslatePlacement', () => {
  it('opens below the cursor when the largest card fits there', () => {
    const cursor = { x: 600, y: 300 }

    expect(quickTranslateSide(cursor, area, 640)).toBe('below')
    expect(quickTranslatePlacement(cursor, area, 'below', size)).toEqual({ x: 528, y: 322 })
  })

  it('opens above the cursor near the bottom of the screen and grows upwards', () => {
    const cursor = { x: 600, y: 900 }

    expect(quickTranslateSide(cursor, area, 640)).toBe('above')
    expect(quickTranslatePlacement(cursor, area, 'above', size)).toEqual({ x: 528, y: 558 })

    expect(quickTranslatePlacement(cursor, area, 'above', { ...size, height: 500 }).y).toBe(378)
  })

  it('stays inside the work area at the right edge', () => {
    expect(quickTranslatePlacement({ x: 1900, y: 300 }, area, 'below', size).x).toBe(1148)
  })

  it('stays inside a second monitor to the left', () => {
    const left = { x: -1280, y: 0, width: 1280, height: 984 }

    expect(quickTranslatePlacement({ x: -1270, y: 100 }, left, 'below', size)).toEqual({
      x: -1280,
      y: 122,
    })
  })

  it('opens below on a short screen where neither side has room', () => {
    const short = { x: 0, y: 0, width: 1280, height: 600 }

    expect(quickTranslateSide({ x: 400, y: 300 }, short, 640)).toBe('below')
  })
})

describe('quickTranslateKeptPlacement', () => {
  it('keeps the top edge where the user dragged a card that opened below', () => {
    const edge = { x: 300, y: 200 }

    expect(quickTranslateKeptPlacement(edge, area, 'below', size)).toEqual({ x: 300, y: 200 })

    expect(quickTranslateKeptPlacement(edge, area, 'below', { ...size, height: 500 })).toEqual({
      x: 300,
      y: 200,
    })
  })

  it('keeps the bottom edge of a card that opened above, so it still grows upwards', () => {
    const edge = { x: 300, y: 800 }

    expect(quickTranslateKeptPlacement(edge, area, 'above', size)).toEqual({ x: 300, y: 480 })
    expect(quickTranslateKeptPlacement(edge, area, 'above', { ...size, height: 500 }).y).toBe(300)
  })

  it('pushes a growing card back inside the work area', () => {
    expect(quickTranslateKeptPlacement({ x: 1800, y: 900 }, area, 'below', size)).toEqual({
      x: 1148,
      y: 720,
    })
  })
})
