import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { batchPrompt, systemPrompt } from './Batches'

describe('batchPrompt', () => {
  it.effect('sends the same request text as before the game glossary', () =>
    Effect.gen(function* () {
      const prompt = yield* batchPrompt(defaultTranslationSettings, [
        { id: 'a', src: 'リナ「行こう」', context: 'Map001.json -> Show Text', entryIds: ['a'] },
        { id: 'b', src: '回復薬', context: 'Items.json -> [1].name', entryIds: ['b'] },
      ])

      expect(systemPrompt).toBe('You are a careful RPG Maker localization assistant.')

      expect(prompt).toBe(
        [
          'Detect the language of the game text, then translate it into English.',
          'Return only a JSON object whose keys are the given numbers and whose values are the translated strings.',
          'Keep RPG Maker control codes (like \\C[2] or \\N[1]), placeholders (like %1) and line breaks.',
          '{"1":{"text":"リナ「行こう」","context":"Map001.json -> Show Text"},"2":{"text":"回復薬","context":"Items.json -> [1].name"}}',
        ].join('\n\n'),
      )
    }),
  )

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
