import { describe, expect, it } from '@effect/vitest'
import { insertionIndex } from './ReadingOrder'

const box = (x: number, y: number, width = 40, height = 80) => ({ x, y, width, height })

const page = [box(500, 50), box(100, 60), box(300, 400)]

describe('insertionIndex', () => {
  it('puts a box beside the first row, further left, after the first bubble', () => {
    expect(insertionIndex(page, box(300, 40))).toBe(1)
  })

  it('puts a box right of everything on the top row first', () => {
    expect(insertionIndex(page, box(560, 45))).toBe(0)
  })

  it('puts a box below everything last', () => {
    expect(insertionIndex(page, box(200, 700))).toBe(3)
  })

  it('puts a box between rows after the row above it', () => {
    expect(insertionIndex(page, box(450, 250))).toBe(2)
  })

  it('starts an empty page', () => {
    expect(insertionIndex([], box(1, 1))).toBe(0)
  })
})
