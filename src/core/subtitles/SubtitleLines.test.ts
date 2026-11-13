import { describe, expect, it } from '@effect/vitest'
import {
  closeCjkGaps,
  endsSentence,
  joinUtterances,
  recentPairs,
  recognitionSlow,
} from './SubtitleLines'

describe('endsSentence', () => {
  it('treats Japanese, Chinese and Latin sentence punctuation as an end', () => {
    expect(endsSentence('本当なの？')).toBe(true)
    expect(endsSentence('どこにもないよ。')).toBe(true)
    expect(endsSentence('你到底想怎么样！')).toBe(true)
    expect(endsSentence('Wait for me here. ')).toBe(true)
    expect(endsSentence('「行こう」')).toBe(true)
  })

  it('treats a line cut mid-sentence as unfinished', () => {
    expect(endsSentence('だったら、どうして')).toBe(false)
    expect(endsSentence('그건 내가')).toBe(false)
    expect(endsSentence('and then she said')).toBe(false)
  })
})

describe('joinUtterances', () => {
  it('joins CJK without a space and words with one', () => {
    expect(joinUtterances('だったら、どうして', '今まで黙っていたの？')).toBe(
      'だったら、どうして今まで黙っていたの？',
    )

    expect(joinUtterances('and then she said', 'nothing at all.')).toBe(
      'and then she said nothing at all.',
    )
  })
})

describe('recentPairs', () => {
  const pairs = [
    { source: 'one', translation: '1' },
    { source: 'two', translation: '2' },
    { source: 'three', translation: '3' },
  ]

  it('keeps the newest pairs, oldest first', () => {
    expect(recentPairs(pairs, 2, 1000)).toEqual(pairs.slice(1))
  })

  it('keeps none when context is off', () => {
    expect(recentPairs(pairs, 0, 1000)).toEqual([])
  })

  it('stops at the token budget', () => {
    expect(recentPairs(pairs, 3, 3)).toEqual([pairs[2]])
  })
})

describe('recognitionSlow', () => {
  it('is slow when most of the last lines took 700 ms or more to recognise', () => {
    expect(recognitionSlow([1100, 900])).toBe(true)
    expect(recognitionSlow([200, 1000, 800])).toBe(true)
  })

  it('is not slow after one slow line, or once lines are quick again', () => {
    expect(recognitionSlow([])).toBe(false)
    expect(recognitionSlow([1200])).toBe(false)
    expect(recognitionSlow([1100, 200, 250])).toBe(false)
  })
})

describe('closeCjkGaps', () => {
  it('drops the spaces some models put between Japanese and Chinese words', () => {
    expect(closeCjkGaps('嘘 を つく 理由 なんて どこ に も な いよ。')).toBe(
      '嘘をつく理由なんてどこにもないよ。',
    )

    expect(closeCjkGaps('だったら、どうして今まで黙っ ていたの？')).toBe(
      'だったら、どうして今まで黙っていたの？',
    )

    expect(closeCjkGaps('你 到底 想 怎么样')).toBe('你到底想怎么样')
  })

  it('keeps the spaces Korean and other languages use between words', () => {
    expect(closeCjkGaps('그건 내가 할게')).toBe('그건 내가 할게')
    expect(closeCjkGaps('and then she said')).toBe('and then she said')
    expect(closeCjkGaps('これは Wenbu です')).toBe('これは Wenbu です')
  })
})
