import { useAtomSet } from '@effect/atom-react'
import { useState } from 'react'
import type { TranslationRun } from '#contract/GameTranslation'
import { Button } from '#ui/button'
import { formatLimit, formatTokens, formatUsd, limitValue, setRunSpendLimitAtom } from '../library'
import { SpendLimitField } from './SpendLimitField'

export function SpendMeter({ run }: { readonly run: TranslationRun }) {
  const setLimit = useAtomSet(setRunSpendLimitAtom)
  const [raising, setRaising] = useState(false)
  const priced = run.usage.costUsd !== undefined
  const spent = run.usage.costUsd ?? run.usage.inputTokens + run.usage.outputTokens
  const done = run.lines.total === 0 ? 0 : run.lines.translated / run.lines.total
  const projected = done > 0 ? spent / done : spent
  const limit = limitValue(run.spendLimit, priced)
  const scale = Math.max(limit ?? 0, projected, spent) || 1
  const format = (amount: number) => (priced ? formatUsd(amount) : `${formatTokens(amount)} tokens`)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-[13px]">
        <span className="font-semibold">{format(spent)} spent</span>
        {done > 0 ? (
          <span className="text-muted-foreground">· on track for {format(projected)}</span>
        ) : null}
        <span className="flex-1" />
        <span className="text-muted-foreground">
          {limit === undefined ? 'No limit' : `Stops at ${formatLimit(run.spendLimit, priced)}`}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
          style={{ width: `${Math.min(100, (projected / scale) * 100)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.min(100, (spent / scale) * 100)}%` }}
        />
        {limit === undefined ? null : (
          <div
            className="absolute -inset-y-1 w-0.5 rounded-full bg-warning"
            style={{ left: `calc(${Math.min(100, (limit / scale) * 100)}% - 2px)` }}
          />
        )}
      </div>
      {raising ? (
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          New limit
          <SpendLimitField
            label="New spending limit for this run"
            limit={run.spendLimit}
            priced={priced}
            onCommit={(next) => {
              setRaising(false)
              setLimit({ payload: { gameId: run.gameId, limit: next } })
            }}
          />
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-fit rounded-full px-2.5 text-[13px] font-normal text-muted-foreground"
          onClick={() => setRaising(true)}
        >
          {limit === undefined ? 'Set a limit' : 'Raise the limit'}
        </Button>
      )}
    </div>
  )
}
