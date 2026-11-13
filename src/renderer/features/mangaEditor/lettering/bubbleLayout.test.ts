import { describe, expect, it } from '@effect/vitest'
import {
  defaultLettering,
  type Lettering,
  type MangaEditorSettings,
  type TextBlock,
} from '#contract/MangaEditor'
import { bubbleLayout, letteredSize } from './bubbleLayout'
import type { TextFont } from './layoutText'

const mono: TextFont = {
  measure: (text, size) => text.length * size * 0.5,
  ascent: 0.8,
  descent: 0.2,
  gap: 0,
}

const settings: MangaEditorSettings = {
  presetId: 'preset',
  targetLanguage: 'ENG',
  seriesNotes: '',
  font: 'Wild Words',
  minFontSize: 6,
  maxFontSize: 200,
  kindSizes: { narration: 21 },
  outline: false,
  outlineColor: '#ffffff',
  uppercase: false,
  cleanMethod: 'inpaint',
}

const block = (lettering: Partial<Lettering> = {}, kind: TextBlock['kind'] = 'narration') =>
  ({
    id: 'block',
    box: { x: 0, y: 0, width: 400, height: 400 },
    origin: 'scan',
    kind,
    source: '',
    romaji: '',
    translation: 'a few words',
    status: 'approved',
    joined: false,
    clean: true,
    cleanMethod: 'inpaint',
    lettering: { ...defaultLettering, ...lettering },
  }) satisfies TextBlock

describe('letteredSize', () => {
  it('sets a bubble at its kind size, scaled from the page height sizes are measured at', () => {
    expect(letteredSize(block(), settings, 3000)).toBe(21)
    expect(letteredSize(block(), { ...settings, sizeReference: 1500 }, 3000)).toBe(42)
  })

  it('steps the kind size up or down by the bubble emphasis', () => {
    expect(
      letteredSize(block({ emphasis: 25 }), { ...settings, kindSizes: { narration: 20 } }),
    ).toBe(25)
  })

  it('fills the box for a kind without a size, or a bubble set to fill', () => {
    expect(letteredSize(block({}, 'dialogue'), settings)).toBeUndefined()
    expect(letteredSize(block({ sizing: 'fill' }), settings)).toBeUndefined()
  })

  it('keeps a bubble own size, and treats a size from before sizing modes as its own', () => {
    expect(letteredSize(block({ sizing: 'custom', size: 30 }), settings)).toBe(30)
    expect(letteredSize(block({ size: 30 }), settings)).toBe(30)
  })

  it('keeps a size set before sizing modes in page pixels, whatever height sizes are measured at', () => {
    const measured = { ...settings, sizeReference: 1500 }

    expect(letteredSize(block({ size: 62 }), measured, 6000)).toBe(62)
    expect(letteredSize(block({ sizing: 'custom', size: 20 }), measured, 6000)).toBe(80)
  })
})

describe('bubbleLayout', () => {
  it('shrinks text that does not fit only when the bubble allows it', () => {
    const tight = { box: { x: 0, y: 0, width: 50, height: 50 } }
    const kept = bubbleLayout({ ...block(), ...tight }, settings, mono, undefined)
    const shrunk = bubbleLayout({ ...block({ shrink: true }), ...tight }, settings, mono, undefined)

    expect(kept?.size).toBe(21)
    expect(kept?.fits).toBe(false)
    expect(shrunk?.size).toBeLessThan(21)
    expect(shrunk?.size).toBeGreaterThanOrEqual(16)
  })
})
