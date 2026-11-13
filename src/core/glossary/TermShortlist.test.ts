import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { checkCandidates, parseVerdicts, shortlistPrompt } from './TermShortlist'

const candidates = [
  { text: '丁松言', count: 45, chapters: [1, 2], contexts: ['他看着丁松言笑了笑。'] },
  { text: '一动不动', count: 30, chapters: [1], contexts: ['烛龙一动不动。'] },
  { text: '青云宗', count: 20, chapters: [2], contexts: ['传闻青云宗声名远扬。'] },
]

describe('shortlistPrompt', () => {
  it('numbers each candidate with a line of context', () => {
    const prompt = shortlistPrompt(candidates, 'English')

    expect(prompt).toContain('1|丁松言|他看着丁松言笑了笑。')
    expect(prompt).toContain('3|青云宗|传闻青云宗声名远扬。')
  })
})

describe('parseVerdicts', () => {
  it('reads kept terms and leaves out dropped and unreadable lines', () => {
    expect(
      parseVerdicts(
        [
          '1|keep|Ding Songyan|character|m|Dīng Sōngyán',
          '2|drop',
          '3|keep|Azure Cloud Sect|sect|-',
          'chatter',
        ].join('\n'),
      ),
    ).toEqual(
      new Map([
        [
          1,
          { translation: 'Ding Songyan', kind: 'character', gender: 'm', reading: 'Dīng Sōngyán' },
        ],
        [3, { translation: 'Azure Cloud Sect', kind: 'sect', gender: null, reading: null }],
      ]),
    )
  })
})

describe('checkCandidates', () => {
  it.effect('asks the model in batches and keeps what it keeps', () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []

      const kept = yield* checkCandidates(
        (prompt) => {
          prompts.push(prompt)

          return Effect.succeed({
            text: '1|keep|Ding Songyan|character|m\n2|drop\n3|keep|Azure Cloud Sect|sect|-',
            costUsd: 0.001,
          })
        },
        candidates,
        'English',
        2,
      )

      expect(prompts).toHaveLength(2)
      expect(kept.terms.map((term) => term.translation)).toEqual(['Ding Songyan', 'Ding Songyan'])
      expect(kept.costUsd).toBeCloseTo(0.002)
    }),
  )
})
