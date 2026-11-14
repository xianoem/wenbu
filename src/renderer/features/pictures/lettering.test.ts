import { describe, expect, it } from '@effect/vitest'
import { balancedLines, fillLine, fitLine, letteringOf } from './lettering'

const measure = (text: string, size: number) => (text.length * size) / 2

const box = { w: 200, h: 30 }

describe('fitLine', () => {
  it('letters a translation that fits at the size of the original text', () => {
    expect(fitLine(measure, 'Message Log', box)).toEqual({
      size: 26,
      lines: ['Message Log'],
      scaleX: 1,
    })
  })

  it('makes a longer translation smaller before anything else', () => {
    const fitted = fitLine(measure, 'Message log of the day', box)

    expect(fitted.lines).toEqual(['Message log of the day'])
    expect(fitted.size).toBe(18)
    expect(fitted.scaleX).toBe(1)
  })

  it('breaks a translation that is still too wide onto two lines when the box is tall enough', () => {
    const fitted = fitLine(measure, 'Fast travel cannot be used right now', { w: 120, h: 40 })

    expect(fitted.lines).toEqual(['Fast travel cannot', 'be used right now'])
    expect(fitted.scaleX).toBe(1)
  })

  it('squeezes a single long word that nothing else can fit', () => {
    const fitted = fitLine(measure, 'Supercalifragilistic', { w: 60, h: 20 })

    expect(fitted.lines).toEqual(['Supercalifragilistic'])
    expect(fitted.scaleX).toBeLessThan(1)
    expect(measure('Supercalifragilistic', fitted.size) * fitted.scaleX).toBeLessThanOrEqual(60)
  })
})

describe('balancedLines', () => {
  it('breaks between words so the widest line is as short as it can be', () => {
    expect(balancedLines(measure, 'Fast travel cannot be used right now', 4)).toEqual([
      'Fast travel',
      'cannot',
      'be used',
      'right now',
    ])
  })

  it('cannot make more lines than there are words', () => {
    expect(balancedLines(measure, 'Message Log', 3)).toBeUndefined()
  })
})

describe('fillLine', () => {
  it('letters a short translation as tall as the box', () => {
    expect(fillLine(measure, 'Message Log', box)).toEqual({
      size: 30,
      lines: ['Message Log'],
      scaleX: 1,
    })
  })

  it('takes as many lines as make the text largest', () => {
    const fitted = fillLine(measure, 'Fast travel cannot be used right now', { w: 120, h: 80 })

    expect(fitted.lines).toHaveLength(4)
    expect(fitted.size).toBe(18)
  })
})

describe('letteringOf', () => {
  const line = { w: 120, h: 40, translation: 'Fast travel cannot be used right now' }

  it('keeps a size the user chose and breaks the lines to fit it', () => {
    expect(letteringOf(measure, { ...line, size: 12 })).toEqual({
      size: 12,
      lines: ['Fast travel cannot', 'be used right now'],
      scaleX: 1,
    })
  })

  it('fills the box when asked, and fits it the usual way otherwise', () => {
    expect(letteringOf(measure, { ...line, fillBox: true })).toEqual(
      fillLine(measure, line.translation, line),
    )

    expect(letteringOf(measure, line)).toEqual(fitLine(measure, line.translation, line))
  })
})
