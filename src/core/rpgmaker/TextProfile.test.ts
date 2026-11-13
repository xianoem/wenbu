import { describe, expect, it } from '@effect/vitest'
import type { TextLocation } from './TextLocations'
import { textProfile } from './TextProfile'

const line = (value: string, dialogue = true): TextLocation => ({
  file: 'Map001.json',
  pointer: '/0',
  context: '',
  value,
  coverage: ['messages', 'mapEvents'],
  dialogue,
})

describe('textProfile', () => {
  it('measures only dialogue, without escape codes or whitespace', () => {
    expect(
      textProfile([line('\\C[2]こんにちは\\C[0]。\n元気？'), line('ポーション', false)]),
    ).toEqual({ language: 'Japanese', dialogueCharacters: 9, readingMinutes: 1 })
  })

  it('reads Japanese at 500 characters a minute', () => {
    expect(textProfile([line('あ'.repeat(30_000))])?.readingMinutes).toBe(60)
  })

  it('tells Japanese, Chinese, Korean and English apart', () => {
    const languageOf = (text: string) => textProfile([line(text)])?.language

    expect(languageOf('今日は天気がいいですね')).toBe('Japanese')
    expect(languageOf('今天天气很好我们去公园')).toBe('Chinese')
    expect(languageOf('오늘은 날씨가 좋네요')).toBe('Korean')
    expect(languageOf('The weather is nice today')).toBe('English')
  })

  it('has no profile for a game without dialogue', () => {
    expect(textProfile([line('ポーション', false)])).toBeUndefined()
  })
})
