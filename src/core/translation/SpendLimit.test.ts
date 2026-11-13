import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeLedger } from './SpendLimit'

const spend = (usd: number, tokens = 0) => ({ usd, tokens })

describe('SpendLimit ledger', () => {
  it.effect('reserves batches until the next would pass the limit', () =>
    Effect.gen(function* () {
      const ledger = yield* makeLedger({ usd: 1 }, true)

      const first = yield* ledger.reserve(spend(0.3))
      const second = yield* ledger.reserve(spend(0.3))

      yield* ledger.settle(spend(0.3), spend(0.5))
      yield* ledger.settle(spend(0.3), spend(0.4))

      const third = yield* ledger.reserve(spend(0.3))

      expect([first, second, third]).toEqual([true, true, false])
      expect(yield* ledger.stopped).toBe(true)
      expect((yield* ledger.spent).usd).toBeCloseTo(0.9)
    }),
  )

  it.effect('counts batches still running against the limit', () =>
    Effect.gen(function* () {
      const ledger = yield* makeLedger({ usd: 1 }, true)

      const running = [yield* ledger.reserve(spend(0.4)), yield* ledger.reserve(spend(0.4))]

      expect([...running, yield* ledger.reserve(spend(0.4))]).toEqual([true, true, false])
    }),
  )

  it.effect('carries on once the limit is raised', () =>
    Effect.gen(function* () {
      const ledger = yield* makeLedger({ usd: 0.5 }, true)

      yield* ledger.reserve(spend(0.4))
      yield* ledger.settle(spend(0.4), spend(0.4))

      const before = yield* ledger.reserve(spend(0.4))

      yield* ledger.setLimit({ usd: 2 })

      expect([before, yield* ledger.reserve(spend(0.4)), yield* ledger.stopped]).toEqual([
        false,
        true,
        false,
      ])
    }),
  )

  it.effect('limits by tokens when the model has no price', () =>
    Effect.gen(function* () {
      const priceless = yield* makeLedger({ usd: 1, tokens: 1000 }, false)

      yield* priceless.reserve(spend(0, 600))
      yield* priceless.settle(spend(0, 600), spend(0, 600))

      const unlimited = yield* makeLedger(undefined, true)

      expect([
        yield* priceless.reserve(spend(0, 600)),
        yield* unlimited.reserve(spend(1_000_000, 1_000_000)),
      ]).toEqual([false, true])
    }),
  )
})
