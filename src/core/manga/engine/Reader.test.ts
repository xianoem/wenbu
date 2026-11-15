import { describe, expect, it } from '@effect/vitest'
import { repetitionAt } from './Reader'

describe('repetitionAt', () => {
  it('finds a phrase repeated four times over sixteen tokens', () => {
    const phrase = [7, 8, 9, 10]

    expect(repetitionAt([1, 2, ...phrase, ...phrase, ...phrase, ...phrase])).toEqual({
      period: 4,
      start: 2,
    })
  })

  it('leaves short laughter and long distinct text alone', () => {
    expect(repetitionAt([5, 6, 6, 6, 6, 6, 7])).toBeUndefined()
    expect(repetitionAt([3, 3, 3, 3, 3, 3])).toBeUndefined()
    expect(repetitionAt(Array.from({ length: 40 }, (_, index) => index))).toBeUndefined()
  })

  it('stops a single token stuck for sixteen steps', () => {
    expect(repetitionAt([1, ...Array.from({ length: 16 }, () => 9)])).toEqual({
      period: 1,
      start: 1,
    })
  })
})
