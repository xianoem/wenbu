import { assert, describe, it } from '@effect/vitest'
import { Duration } from 'effect'
import { type CrashBudget, recordCrash } from './crashBudget'

const budget: CrashBudget = { crashes: 3, within: Duration.minutes(1) }

describe('recordCrash', () => {
  it('allows a restart after the first crash', () => {
    assert.deepStrictEqual(recordCrash(budget, [], 1_000), { recent: [1_000], exhausted: false })
  })

  it('is exhausted by the third crash inside a minute', () => {
    const { exhausted } = recordCrash(budget, [1_000, 20_000], 59_000)

    assert.isTrue(exhausted)
  })

  it('forgets crashes older than the window', () => {
    const { recent, exhausted } = recordCrash(budget, [1_000, 20_000], 61_000)

    assert.deepStrictEqual(recent, [20_000, 61_000])
    assert.isFalse(exhausted)
  })
})
