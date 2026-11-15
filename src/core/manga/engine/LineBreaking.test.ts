import { describe, expect, it } from '@effect/vitest'
import {
  evenedBreaks,
  parseStyledSegments,
  tokenizeStyledText,
  tryHyphenateWord,
  type LineBreaking,
} from './LineBreaking'
import cases from './__fixtures__/line-breaking.json'

const cjk = (code: number) =>
  [
    [0x4e00, 0x9fff],
    [0x3040, 0x30ff],
    [0x3000, 0x303f],
    [0xff00, 0xffef],
  ].some(([low = 0, high = 0]) => code >= low && code <= high)

const width = (token: string) =>
  [...token].reduce((total, character) => {
    const code = character.codePointAt(0) ?? 0

    return total + (cjk(code) ? 14 : 7.5 + (code % 5))
  }, 0)

describe('LineBreaking', () => {
  for (const entry of cases) {
    it(`breaks ${entry.text.slice(0, 30)} like the plugin`, () => {
      const tokens = tokenizeStyledText(entry.text, true)

      expect(tokens).toEqual(entry.tokens)
      expect(parseStyledSegments(entry.text)).toEqual(entry.segments)

      for (const [key, expected] of Object.entries(entry.breaks)) {
        const [mode = '', orphans, even, max] = key.split('-')

        const style: LineBreaking = {
          mode: mode === 'greedy' ? 'greedy' : 'balanced',
          avoidOrphans: orphans === 'True',
          evenOut: even === 'True',
        }

        const lines = evenedBreaks(
          tokens.map(([token]) => token),
          Number(max),
          width,
          7,
          width,
          { style, badnessExponent: 3, hyphenPenalty: 1000, detachEllipsis: true },
        )

        expect([key, lines ?? null]).toEqual([key, expected])
      }

      for (const [word, expected] of Object.entries(entry.hyphen)) {
        expect([word, tryHyphenateWord(word, 8, (part) => width(part) <= 120) ?? null]).toEqual([
          word,
          expected,
        ])
      }
    })
  }
})
