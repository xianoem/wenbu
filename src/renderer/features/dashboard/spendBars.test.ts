import { assert, describe, it } from '@effect/vitest'
import { barsOf, barTotal, gridStep, groupTotals } from './spendBars'

const days = [
  { day: '2026-10-01', feature: 'rpg-translation', costUsd: 2, tokens: 100 },
  { day: '2026-10-01', feature: 'line-review', costUsd: 0.5, tokens: 10 },
  { day: '2026-10-03', feature: 'manga-editor', costUsd: 1, tokens: 50 },
  { day: '2026-10-09', feature: 'game-guide', costUsd: 0.25, tokens: 5 },
] as const

describe('spendBars', () => {
  it('gives every day of the range a bar, quiet days included', () => {
    const bars = barsOf(days, { from: '2026-10-01', to: '2026-10-04' }, 1)

    assert.deepStrictEqual(
      bars.map((bar) => [bar.from, barTotal(bar)]),
      [
        ['2026-10-01', 2.5],
        ['2026-10-02', 0],
        ['2026-10-03', 1],
        ['2026-10-04', 0],
      ],
    )

    assert.deepStrictEqual(bars[0]?.costUsd, { rpg: 2.5, overlay: 0, manga: 0, other: 0 })
  })

  it('groups days into weeks from the first day, ending the last week at the range', () => {
    const bars = barsOf(days, { from: '2026-10-01', to: '2026-10-10' }, 7)

    assert.deepStrictEqual(
      bars.map((bar) => [bar.from, bar.to, barTotal(bar), bar.tokens]),
      [
        ['2026-10-01', '2026-10-07', 3.5, 160],
        ['2026-10-08', '2026-10-10', 0.25, 5],
      ],
    )
  })

  it('folds features into the four groups the chart shows', () => {
    assert.deepStrictEqual(groupTotals(days), { rpg: 2.5, overlay: 0, manga: 1, other: 0.25 })
  })

  it('picks a round gridline step', () => {
    assert.strictEqual(gridStep(3.2), 1)
    assert.strictEqual(gridStep(0.3), 0.1)
    assert.strictEqual(gridStep(18), 5)
  })
})
