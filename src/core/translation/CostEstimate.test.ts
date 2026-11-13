import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { estimateTokens } from './Batches'
import { estimateCost } from './CostEstimate'

const settings = { ...defaultTranslationSettings, chunkTokens: 8 }

const item = (id: string, src: string) => ({ id, src, context: 'Show Text', entryIds: [id] })

const items = [
  item('a', 'おはようございます'),
  item('b', '今日もいい天気ですね'),
  item('c', 'さようなら'),
]

describe('estimateCost', () => {
  it.effect('counts batches, tokens and a cost range from the preset price', () =>
    Effect.gen(function* () {
      const estimate = yield* estimateCost(settings, items, { input: 3, output: 15 })
      const text = items.reduce((total, next) => total + estimateTokens(next.src), 0)

      expect(estimate.lines).toBe(3)
      expect(estimate.batches).toBe(3)
      expect(estimate.inputTokens).toBeGreaterThan(text * 3)
      expect(estimate.outputTokens).toBe(Math.ceil(text * 1.3))

      const low = (estimate.inputTokens * 3 + estimate.outputTokens * 15) / 1_000_000

      expect(estimate.costUsd?.low).toBeCloseTo(low)
      expect(estimate.costUsd?.high).toBeGreaterThan(low)
    }),
  )

  it.effect('gives tokens only when the model has no price', () =>
    Effect.gen(function* () {
      const estimate = yield* estimateCost(settings, items, undefined)

      expect(estimate.inputTokens).toBeGreaterThan(0)
      expect(estimate.costUsd).toBeUndefined()
    }),
  )

  it.effect('costs nothing when nothing is left to translate', () =>
    Effect.gen(function* () {
      expect(yield* estimateCost(settings, [], { input: 3, output: 15 })).toEqual({
        lines: 0,
        batches: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: { low: 0, high: 0 },
      })
    }),
  )
})
