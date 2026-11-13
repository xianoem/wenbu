import { Effect, Ref } from 'effect'
import type { SpendLimit } from '#contract/GameTranslation'

export interface Spend {
  readonly usd: number
  readonly tokens: number
}

const none: Spend = { usd: 0, tokens: 0 }

const plus = (left: Spend, right: Spend): Spend => ({
  usd: left.usd + right.usd,
  tokens: left.tokens + right.tokens,
})

const minus = (left: Spend, right: Spend): Spend => ({
  usd: left.usd - right.usd,
  tokens: left.tokens - right.tokens,
})

interface Ledger {
  readonly limit: SpendLimit | undefined
  readonly spent: Spend
  readonly reserved: Spend
  readonly stopped: boolean
}

const passes = (limit: SpendLimit | undefined, priced: boolean, total: Spend) =>
  (priced && limit?.usd !== undefined && total.usd > limit.usd) ||
  (limit?.tokens !== undefined && total.tokens > limit.tokens)

export const makeLedger = Effect.fnUntraced(function* (
  limit: SpendLimit | undefined,
  priced: boolean,
) {
  const state = yield* Ref.make<Ledger>({ limit, spent: none, reserved: none, stopped: false })

  const reserve = (estimate: Spend) =>
    Ref.modify(state, (ledger) => {
      if (passes(ledger.limit, priced, plus(plus(ledger.spent, ledger.reserved), estimate))) {
        return [false, { ...ledger, stopped: true }] as const
      }

      return [true, { ...ledger, reserved: plus(ledger.reserved, estimate) }] as const
    })

  const settle = (estimate: Spend, actual: Spend) =>
    Ref.update(state, (ledger) => ({
      ...ledger,
      spent: plus(ledger.spent, actual),
      reserved: minus(ledger.reserved, estimate),
    }))

  const setLimit = (next: SpendLimit | undefined) =>
    Ref.update(state, (ledger) => ({ ...ledger, limit: next, stopped: false }))

  return {
    reserve,
    settle,
    setLimit,
    spent: Effect.map(Ref.get(state), (ledger) => ledger.spent),
    stopped: Effect.map(Ref.get(state), (ledger) => ledger.stopped),
    limit: Effect.map(Ref.get(state), (ledger) => ledger.limit),
  }
})

export type SpendLedger = Effect.Success<ReturnType<typeof makeLedger>>
