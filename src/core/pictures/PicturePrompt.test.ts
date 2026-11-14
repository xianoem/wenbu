import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import type { PictureLine } from '#contract/Pictures'
import { parsePictureReply, picturePrompt } from './PicturePrompt'

const line = (id: number, text: string, w = 200, h = 30): PictureLine => ({
  id,
  x: 0,
  y: id * 40,
  w,
  h,
  ocr: text,
  source: text,
  keep: false,
})

describe('picturePrompt', () => {
  it.effect('asks the model to check each line against the picture and keep within its width', () =>
    Effect.gen(function* () {
      const prompt = yield* picturePrompt(
        'English',
        [line(1, '性経験のテータ'), line(2, '回', 20)],
        true,
      )

      expect(prompt).toContain('Compare each line with the picture')
      expect(prompt).toContain('into English')
      expect(prompt).toContain('{"1":{"text":"性経験のテータ","max":15},"2":{"text":"回","max":3}}')
    }),
  )

  it.effect('asks only for translations when the model cannot see the picture', () =>
    Effect.gen(function* () {
      const prompt = yield* picturePrompt('English', [line(1, 'メッセージログ')], false)

      expect(prompt).not.toContain('Compare each line with the picture')
      expect(prompt).toContain('obvious misreadings')
    }),
  )
})

describe('parsePictureReply', () => {
  it.effect('reads corrections and translations, even inside a code fence', () =>
    Effect.gen(function* () {
      const reply = [
        '```json',
        '{"1": {"source": "性経験のデータ", "translation": "Sexual experience data"},',
        ' "2": {"translation": "times"}}',
        '```',
      ].join('\n')

      const lines = [line(1, '性経験のテータ'), line(2, '回')]

      expect(yield* parsePictureReply(reply, lines)).toEqual([
        { line: 1, source: '性経験のデータ', translation: 'Sexual experience data' },
        { line: 2, source: '回', translation: 'times' },
      ])
    }),
  )

  it.effect('fails on a reply that is not the asked JSON', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        parsePictureReply('Sorry, I cannot read that.', [line(1, '回')]),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
