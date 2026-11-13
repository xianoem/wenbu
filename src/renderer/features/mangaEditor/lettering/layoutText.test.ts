import { describe, expect, it } from '@effect/vitest'
import { type LayoutRequest, layoutText, type TextFont } from './layoutText'

const mono: TextFont = {
  measure: (text, size) => text.length * size * 0.5,
  ascent: 0.8,
  descent: 0.2,
  gap: 0,
}

const request = (overrides: Partial<LayoutRequest>): LayoutRequest => ({
  text: 'and launched an immediate assault on the enemy base before dawn',
  width: 1000,
  height: 1000,
  minSize: 6,
  maxSize: 400,
  leading: 1,
  breakMode: 'balanced',
  avoidOrphans: false,
  hyphenate: false,
  uppercase: false,
  ...overrides,
})

const widest = (lines: ReadonlyArray<string>) => Math.max(...lines.map((line) => line.length))

describe('layoutText', () => {
  it('fills the box with the largest size whose lines fit', () => {
    const laidOut = layoutText(mono, request({ width: 300, height: 300 }))
    const bigger = layoutText(mono, request({ width: 300, height: 300, size: laidOut.size + 1 }))

    expect(widest(laidOut.lines) * laidOut.size * 0.5).toBeLessThanOrEqual(300 * 0.96)
    expect(laidOut.lines.length * laidOut.lineHeight).toBeLessThanOrEqual(300 * 0.96 + 1)

    expect(
      widest(bigger.lines) * bigger.size * 0.5 > 300 * 0.96 ||
        bigger.lines.length * bigger.lineHeight > 300 * 0.96,
    ).toBe(true)
  })

  it('keeps a fixed size and only breaks the lines', () => {
    expect(layoutText(mono, request({ size: 20, width: 400 })).size).toBe(20)
  })

  it('says when text at a fixed size does not fit its box', () => {
    expect(layoutText(mono, request({ size: 20, width: 400 })).fits).toBe(true)
    expect(layoutText(mono, request({ size: 20, width: 400, height: 30 })).fits).toBe(false)
  })

  it('shrinks text that does not fit only when allowed, and never below the floor', () => {
    const shrunk = layoutText(mono, request({ size: 20, width: 400, height: 36, shrinkTo: 15 }))
    const floored = layoutText(mono, request({ size: 20, width: 400, height: 20, shrinkTo: 15 }))

    expect(shrunk.size).toBeLessThan(20)
    expect(shrunk.size).toBeGreaterThanOrEqual(15)
    expect(shrunk.fits).toBe(true)
    expect(floored.size).toBe(15)
    expect(floored.fits).toBe(false)
  })

  it('fills each line before the next in greedy mode, and evens them out in balanced mode', () => {
    const greedy = layoutText(mono, request({ size: 20, width: 312, breakMode: 'greedy' }))
    const balanced = layoutText(mono, request({ size: 20, width: 312, breakMode: 'balanced' }))

    expect(greedy.lines).toEqual([
      'and launched an immediate',
      'assault on the enemy base',
      'before dawn',
    ])

    expect(balanced.lines).toHaveLength(3)
    expect(widest(balanced.lines)).toBeLessThan(widest(greedy.lines))
  })

  it('keeps a single word off the last line when asked', () => {
    const lines = layoutText(
      mono,
      request({ text: 'hello there world', size: 20, width: 115, avoidOrphans: true }),
    ).lines

    expect(lines.at(-1)?.includes(' ')).toBe(true)
  })

  it('keeps the line breaks the user typed in manual mode', () => {
    const laidOut = layoutText(mono, request({ text: 'one two\nthree', breakMode: 'manual' }))

    expect(laidOut.lines).toEqual(['one two', 'three'])
  })

  it('hyphenates a word too wide for the box', () => {
    const laidOut = layoutText(
      mono,
      request({ text: 'manufacturing', size: 20, width: 100, hyphenate: true }),
    )

    expect(laidOut.lines).toEqual(['manufa-', 'cturing'])
  })

  it('writes in capitals when the gallery letters in uppercase', () => {
    expect(layoutText(mono, request({ text: 'hey you', size: 20, uppercase: true })).lines).toEqual(
      ['HEY YOU'],
    )
  })
})
