import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { batchPrompt } from './Batches'

describe('batchPrompt', () => {
  it.effect('lets the model detect the source language and names the chosen target', () =>
    Effect.gen(function* () {
      const prompt = yield* batchPrompt(
        { ...defaultTranslationSettings, targetLanguage: 'Brazilian Portuguese' },
        [{ id: 'a', src: 'こんにちは', context: 'Show Text', entryIds: ['a'] }],
      )

      expect(prompt).toContain(
        'Detect the language of the game text, then translate it into Brazilian Portuguese.',
      )

      expect(prompt).toContain('{"1":{"text":"こんにちは","context":"Show Text"}}')
    }),
  )

  it('translates into English unless told otherwise', () => {
    expect(defaultTranslationSettings.targetLanguage).toBe('English')
  })
})
