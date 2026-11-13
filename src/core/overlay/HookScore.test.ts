import { describe, expect, it } from '@effect/vitest'
import { scoreHook } from './HookScore'

describe('scoreHook', () => {
  it('ranks Japanese dialogue high', () => {
    const score = scoreHook('Japanese', '「おはよう。今日はいい天気だね。」', 3)

    expect(score.confidence).toBe('High')

    expect(score.reasons).toEqual([
      'Japanese script detected',
      'Dialogue-like length',
      'Dialogue punctuation',
      'Stable update rate',
    ])
  })

  it('ranks paths, memory dumps and fragments low', () => {
    expect(scoreHook('Japanese', 'C:\\games\\demo\\Data\\Map001.json', 3).confidence).toBe('Low')
    expect(scoreHook('Japanese', '0x00FFA112 0x00FFA114', 3).confidence).toBe('Low')
    expect(scoreHook('Japanese', 'ミ', 1).reasons).toContain('Tiny fragment')
  })

  it('scores the processed text, so glyph repeats do not look like a backlog', () => {
    const line = Array.from({ length: 50 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    ).join('')

    const score = scoreHook('Japanese', line, 1)

    expect(score.reasons).toContain('Dialogue-like length')
    expect(score.reasons).not.toContain('Long backlog-like sample')
  })

  it('only checks the script for languages it knows', () => {
    expect(scoreHook('French', 'Bonjour, comment ça va ?', 3).signal).toBe('Text-like output')
    expect(scoreHook('Korean', 'Hello there friend', 3).signal).toBe('No Korean script')
  })
})
