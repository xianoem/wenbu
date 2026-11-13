import { cn } from 'cn'
import { useState } from 'react'
import type {
  SpendLimit,
  TranslationEstimate,
  TranslationScope,
  TranslationSettings,
} from '#contract/GameTranslation'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { formatTokens, formatUsd } from '../library'
import { SpendLimitField } from './SpendLimitField'

const scopeLabels: Record<TranslationScope, { readonly title: string; readonly detail: string }> = {
  changed: {
    title: 'Changed and new lines',
    detail: 'What the game update added or reworded. Locked and unchanged lines are kept.',
  },
  missing: {
    title: 'Every line without a translation',
    detail: 'Also the lines an earlier run could not translate.',
  },
}

const costText = (estimate: TranslationEstimate) =>
  estimate.costUsd === undefined
    ? `${formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens`
    : formatUsd(estimate.costUsd.low)

function ScopeOption({
  scope,
  estimate,
  selected,
  onSelect,
}: {
  readonly scope: TranslationScope
  readonly estimate: TranslationEstimate
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-pressed={selected}
      className={cn(
        'h-auto items-center justify-start gap-3 rounded-2xl bg-muted px-3.5 py-2.5 text-left font-normal whitespace-normal hover:bg-muted',
        selected && 'ring-[1.5px] ring-primary',
      )}
      onClick={onSelect}
    >
      <span
        aria-hidden
        className={cn(
          'size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground',
          selected && 'border-5 border-primary',
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{scopeLabels[scope].title}</span>
        <span className="text-xs text-muted-foreground">{scopeLabels[scope].detail}</span>
      </span>
      <span className="text-right text-[13px] text-muted-foreground">
        {estimate.lines.toLocaleString('en-US')} lines
        <br />
        {costText(estimate)}
      </span>
    </Button>
  )
}

function Breakdown({ estimate }: { readonly estimate: TranslationEstimate }) {
  const price = estimate.price

  const rows = [
    ['Input · the text and Wenbu’s instructions', estimate.inputTokens, price?.input],
    ['Output · about 1.3× the text', estimate.outputTokens, price?.output],
  ] as const

  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-1.5 text-[13px]">
      {rows.map(([label, tokens, rate]) => (
        <div key={label} className="contents">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right">{formatTokens(tokens)}</span>
          <span className="text-right">
            {rate === undefined ? '—' : formatUsd((tokens * rate) / 1_000_000)}
          </span>
        </div>
      ))}
      <span className="border-t pt-1.5 font-semibold">About</span>
      <span className="border-t pt-1.5 text-right font-semibold">
        {formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens
      </span>
      <span className="border-t pt-1.5 text-right font-semibold">
        {estimate.costUsd === undefined
          ? 'No price'
          : `${formatUsd(estimate.costUsd.low)} – ${formatUsd(estimate.costUsd.high)}`}
      </span>
    </div>
  )
}

export function TranslateDialog({
  title,
  settings,
  estimates,
  open,
  onOpenChange,
  onStart,
}: {
  readonly title: string
  readonly settings: TranslationSettings
  readonly estimates: Readonly<Record<TranslationScope, TranslationEstimate>>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onStart: (scope: TranslationScope, spendLimit: SpendLimit) => void
}) {
  const choice = estimates.changed.lines > 0 && estimates.missing.lines > estimates.changed.lines
  const [scope, setScope] = useState<TranslationScope>(choice ? 'changed' : 'missing')
  const [limit, setLimit] = useState<SpendLimit>(settings.spendLimit ?? {})
  const estimate = estimates[scope]
  const priced = estimate.price !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[26px] p-6 sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>Translate {title}</DialogTitle>
          <DialogDescription>Into {settings.targetLanguage}</DialogDescription>
        </DialogHeader>

        {choice ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">What to translate</span>
            {(['changed', 'missing'] as const).map((option) => (
              <ScopeOption
                key={option}
                scope={option}
                estimate={estimates[option]}
                selected={scope === option}
                onSelect={() => setScope(option)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">Estimate</span>
          <Breakdown estimate={estimate} />
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-muted px-3.5 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">Stop if this run costs more than</span>
            <span className="text-xs text-muted-foreground">
              Translated lines are still applied; the rest stays original.
            </span>
          </span>
          <SpendLimitField
            label="Spending limit for this run"
            limit={limit}
            priced={priced}
            onCommit={setLimit}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full px-4" onClick={() => onStart(scope, limit)}>
            Translate {estimate.lines.toLocaleString('en-US')} lines
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
