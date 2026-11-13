import { assert, describe, it } from '@effect/vitest'
import { monthProjection, previousLabel, rangesOf } from './periods'

describe('periods', () => {
  it('compares this month so far with the whole of last month', () => {
    const ranges = rangesOf('month', '2026-03-29')

    assert.deepStrictEqual(ranges, {
      period: { from: '2026-03-01', to: '2026-03-29' },
      previous: { from: '2026-02-01', to: '2026-02-28' },
    })

    assert.strictEqual(previousLabel('month', ranges), 'in February')
  })

  it('compares the last 30 days with the 30 days before', () => {
    assert.deepStrictEqual(rangesOf('days', '2026-10-29'), {
      period: { from: '2026-09-30', to: '2026-10-29' },
      previous: { from: '2026-08-31', to: '2026-09-29' },
    })
  })

  it('compares this year so far with the whole of last year', () => {
    const ranges = rangesOf('year', '2026-01-03')

    assert.deepStrictEqual(ranges, {
      period: { from: '2026-01-01', to: '2026-01-03' },
      previous: { from: '2025-01-01', to: '2025-12-31' },
    })

    assert.strictEqual(previousLabel('year', ranges), 'in 2025')
  })

  it("projects the month's spend from its days so far", () => {
    assert.closeTo(monthProjection(10, '2026-10-10'), 31, 1e-9)
    assert.closeTo(monthProjection(14, '2026-02-14'), 28, 1e-9)
  })
})
