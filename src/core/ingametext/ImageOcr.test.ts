import { describe, expect, it } from '@effect/vitest'
import type { OcrResult } from '#contract/Detections'
import { textBoxes } from './ImageOcr'

const degrees = (value: number) => (value * Math.PI) / 180

const titleScreen = (rotations: ReadonlyArray<number>): OcrResult => ({
  image: { width: 1280, height: 720 },
  paragraphs: [
    {
      lines: rotations.map((rotation, index) => ({
        text: `メモリーズ${index}`,
        words: [],
        box: { centerX: 0.5, centerY: 0.25, width: 0.25, height: 0.125, rotation },
      })),
    },
  ],
})

describe('textBoxes', () => {
  it('keeps lines Screen AI reads as a fraction of a degree off level', () => {
    const boxes = textBoxes(titleScreen([degrees(-0.138), degrees(0.147)]))

    expect(boxes).toEqual([
      { x: 480, y: 135, w: 320, h: 90, key: 'メモリーズ0' },
      { x: 480, y: 135, w: 320, h: 90, key: 'メモリーズ1' },
    ])
  })

  it('leaves out lines that are clearly tilted or vertical', () => {
    expect(textBoxes(titleScreen([degrees(15), degrees(90)]))).toEqual([])
  })
})
