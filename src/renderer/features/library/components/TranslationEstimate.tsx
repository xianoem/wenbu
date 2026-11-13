import { useAtomSet } from '@effect/atom-react'
import type { ReactNode } from 'react'
import type {
  TranslationEstimate as Estimate,
  TranslationSettings,
} from '#contract/GameTranslation'
import { formatTokens, formatUsd, limitValue, saveTranslationSettingsAtom } from '../library'
import { SpendLimitField } from './SpendLimitField'

function EstimateBox({
  label,
  value,
  detail,
}: {
  readonly label: string
  readonly value: ReactNode
  readonly detail: string
}) {
  return (
    <div className="flex flex-col rounded-2xl bg-muted px-3.5 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="mt-0.5 text-lg font-semibold tracking-tight">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

export function TranslationEstimate({
  estimate,
  settings,
}: {
  readonly estimate: Estimate
  readonly settings: TranslationSettings
}) {
  const save = useAtomSet(saveTranslationSettingsAtom)
  const priced = estimate.price !== undefined
  const tokens = estimate.inputTokens + estimate.outputTokens

  return (
    <div className="mt-4 grid grid-cols-4 gap-2">
      <EstimateBox
        label="Lines"
        value={estimate.lines.toLocaleString('en-US')}
        detail={`in ${estimate.batches.toLocaleString('en-US')} requests`}
      />
      <EstimateBox
        label="Tokens, about"
        value={formatTokens(tokens)}
        detail={`${formatTokens(estimate.inputTokens)} in · ${formatTokens(estimate.outputTokens)} out`}
      />
      {estimate.costUsd === undefined ? (
        <EstimateBox label="Cost" value="No price" detail="The model has no listed price" />
      ) : (
        <EstimateBox
          label="Cost, about"
          value={formatUsd(estimate.costUsd.low)}
          detail={`up to ${formatUsd(estimate.costUsd.high)} with retries`}
        />
      )}
      <div className="flex flex-col rounded-2xl bg-muted px-3.5 py-2.5">
        <span className="text-xs text-muted-foreground">Stop the run at</span>
        <SpendLimitField
          key={String(limitValue(settings.spendLimit, priced))}
          className="mt-1"
          label="Spending limit per run"
          limit={settings.spendLimit}
          priced={priced}
          onCommit={(spendLimit) =>
            save({ payload: { ...settings, spendLimit }, reactivityKeys: ['translation-settings'] })
          }
        />
        <span className="mt-1 text-xs text-muted-foreground">What's done by then is applied</span>
      </div>
    </div>
  )
}
