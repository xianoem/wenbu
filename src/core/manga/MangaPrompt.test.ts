import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import {
  cleanSource,
  isTranslatable,
  linesPrompt,
  parseLines,
  sampleExchange,
  systemPrompt,
} from './MangaPrompt'

describe('MangaPrompt', () => {
  it('names the target language in the system prompt', () => {
    expect(systemPrompt('English')).toContain('Translate the following text into English:')
    expect(systemPrompt('English')).not.toContain('{to_lang}')
  })

  it('shows the model an example only for languages it has one for', () => {
    expect(sampleExchange('English')).toHaveLength(2)
    expect(sampleExchange('Polish')).toEqual([])
  })

  it('numbers each line', () => {
    expect(linesPrompt(['すごっ', '動かないで'])).toBe('<|1|>すごっ\n<|2|>動かないで')
  })

  it('reads every numbered line back in order', () => {
    const reply = '<|2|>Don’t move\n<|1|>Amazing'

    expect(parseLines(reply, 2)).toEqual(Option.some(['Amazing', 'Don’t move']))
  })

  it('rejects a reply that drops a line', () => {
    expect(parseLines('<|1|>Amazing', 2)).toEqual(Option.none())
    expect(parseLines('<|1|>Amazing\n<|2|>', 2)).toEqual(Option.none())
  })

  it('ignores whatever the model adds after a line', () => {
    expect(parseLines('<|1|>Amazing\n(The speaker is surprised.)', 1)).toEqual(
      Option.some(['Amazing']),
    )
  })

  it('keeps sound effects of symbols and numbers untranslated', () => {
    expect(isTranslatable('…！？')).toBe(false)
    expect(isTranslatable('123')).toBe(false)
    expect(isTranslatable('すごっ')).toBe(true)
  })

  it('removes the spaces OCR puts between characters', () => {
    expect(cleanSource('こ ん な　の')).toBe('こんなの')
  })
})
