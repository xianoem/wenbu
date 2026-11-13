import { assert, describe, it } from '@effect/vitest'
import type { TranslationLine } from '#contract/GameTranslation'
import { mtoolOf } from './TranslationExport'

const line = (sourceText: string, translatedText?: string): TranslationLine => ({
  entryId: sourceText,
  file: 'Map001.json',
  pointer: '/events/1',
  context: 'Map001',
  sourceText,
  ...(translatedText === undefined ? {} : { translatedText }),
  origin: 'model',
  locked: false,
  applied: true,
})

describe('mtoolOf', () => {
  it('maps each original to its translation, skipping untranslated lines', () => {
    assert.deepStrictEqual(mtoolOf([line('はい', 'Yes'), line('いいえ')]), { はい: 'Yes' })
  })

  it('keeps the first translation of a repeated original', () => {
    assert.deepStrictEqual(mtoolOf([line('はい', 'Yes'), line('はい', 'Sure')]), { はい: 'Yes' })
  })

  it('also maps each line of a message whose translation has as many lines', () => {
    assert.deepStrictEqual(mtoolOf([line('おはよう\n元気？', 'Morning\nHow are you?')]), {
      'おはよう\n元気？': 'Morning\nHow are you?',
      おはよう: 'Morning',
      '元気？': 'How are you?',
    })
  })

  it('keeps a message whole when its translation was rewrapped', () => {
    assert.deepStrictEqual(mtoolOf([line('おはよう\n元気？', 'Morning, how are you?')]), {
      'おはよう\n元気？': 'Morning, how are you?',
    })
  })
})
