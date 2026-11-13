import { describe, expect, it } from '@effect/vitest'
import { toolbarLayout, toolbarWidths } from './toolbarLayout'

const roomFor = (...widths: ReadonlyArray<number>) =>
  toolbarWidths.fixed + widths.reduce((sum, width) => sum + width, 0)

describe('toolbarLayout', () => {
  it('shows every tool when the header is wide enough', () => {
    expect(toolbarLayout(1000)).toEqual({
      inline: ['retry', 'original', 'textStyle', 'opacity'],
      overflow: [],
    })
  })

  it('moves the opacity slider into the menu first', () => {
    const width = roomFor(toolbarWidths.button * 4)

    expect(toolbarLayout(width)).toEqual({
      inline: ['retry', 'original', 'textStyle'],
      overflow: ['opacity'],
    })
  })

  it('then text style, show original and retry, one at a time', () => {
    expect(toolbarLayout(roomFor(toolbarWidths.button * 3)).overflow).toEqual([
      'textStyle',
      'opacity',
    ])

    expect(toolbarLayout(roomFor(toolbarWidths.button * 2)).overflow).toEqual([
      'original',
      'textStyle',
      'opacity',
    ])

    expect(toolbarLayout(roomFor(toolbarWidths.button))).toEqual({
      inline: [],
      overflow: ['retry', 'original', 'textStyle', 'opacity'],
    })
  })

  it('keeps everything in the menu when the window is at its narrowest', () => {
    expect(toolbarLayout(0).inline).toEqual([])
  })
})
