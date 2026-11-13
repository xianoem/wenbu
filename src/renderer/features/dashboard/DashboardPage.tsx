import { useAtom, useAtomValue } from '@effect/atom-react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { UsageSummary } from '#contract/Dashboard'
import { formatCount, formatUsd } from '#lib/format'
import { Button } from '#ui/button'
import { OverflowText } from '#ui/overflow-text'
import { downloadsAtom } from '../downloads/downloads'
import { mangaRunsAtom } from '../manga/manga'
import { pluginsAtom } from '../plugins/plugins'
import { storageAtom } from '../storage/storage'
import { DLsiteCard } from '../details/components/DLsiteCard'
import { DLsiteWorkDialog } from '../details/DLsiteWorkDialog'
import { AttentionStrip } from './components/AttentionStrip'
import { ProgressTable } from './components/ProgressTable'
import { SpendChart, SpendLegend } from './components/SpendChart'
import { SpendTables } from './components/SpendTables'
import {
  attentionAtom,
  dismissedAtom,
  periodAtom,
  problemCountAtom,
  progressAtom,
  usageAtom,
} from './dashboard'
import { dismissalsAfter, noticesOf, runningOf, undismissed } from './notices'
import {
  daysBetween,
  localToday,
  monthProjection,
  type Period,
  periods,
  previousLabel,
  type Ranges,
  rangesOf,
} from './periods'
import { barsOf } from './spendBars'

const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isSuccess(result) ? result.value : undefined

function PeriodSwitch({
  period,
  onChange,
}: {
  readonly period: Period
  readonly onChange: (period: Period) => void
}) {
  return (
    <div className="inline-flex rounded-full bg-muted/60 p-[3px]">
      {periods.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          aria-pressed={period === option.id}
          className={cn(
            'h-7 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
            period === option.id && 'bg-background font-medium text-foreground shadow-card',
          )}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  readonly label: string
  readonly value: string
  readonly note: string
}) {
  return (
    <div className="min-w-0 px-[22px] py-[18px] [&+&]:border-l">
      <OverflowText className="text-xs text-muted-foreground">{label}</OverflowText>
      <OverflowText className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </OverflowText>
      <OverflowText className="mt-0.5 text-xs text-muted-foreground">{note}</OverflowText>
    </div>
  )
}

function PaceStat({
  period,
  today,
  costUsd,
  days,
}: {
  readonly period: Period
  readonly today: string
  readonly costUsd: number
  readonly days: number
}) {
  if (period === 'month') {
    return (
      <Stat
        label="On track for"
        value={formatUsd(monthProjection(costUsd, today))}
        note={`at ${formatUsd(costUsd / days)} a day`}
      />
    )
  }

  return <Stat label="Average day" value={formatUsd(costUsd / days)} note={`over ${days} days`} />
}

function StatRow({
  period,
  ranges,
  today,
  usage,
  days,
}: {
  readonly period: Period
  readonly ranges: Ranges
  readonly today: string
  readonly usage: UsageSummary
  readonly days: number
}) {
  const { totals, previous } = usage

  return (
    <section className="grid grid-cols-4 rounded-3xl bg-card shadow-card">
      <Stat
        label={`Spent ${periods.find((option) => option.id === period)?.label.toLowerCase() ?? ''}`}
        value={formatUsd(totals.costUsd)}
        note={`${formatUsd(previous.costUsd)} ${previousLabel(period, ranges)}`}
      />
      <PaceStat period={period} today={today} costUsd={totals.costUsd} days={days} />
      <Stat
        label="Tokens"
        value={formatCount(totals.inputTokens + totals.outputTokens)}
        note={`${totals.requests.toLocaleString('en')} requests`}
      />
      <Stat
        label="Unpriced models"
        value={formatCount(totals.unpricedTokens)}
        note="tokens, no cost known"
      />
    </section>
  )
}

export function DashboardPage() {
  const [period, setPeriod] = useAtom(periodAtom)
  const [today] = useState(localToday)
  const ranges = rangesOf(period, today)
  const usage = valueOf(useAtomValue(usageAtom(ranges)))
  const progress = valueOf(useAtomValue(progressAtom(ranges.period)))
  const items = valueOf(useAtomValue(attentionAtom))
  const downloads = valueOf(useAtomValue(downloadsAtom))
  const mangaRuns = valueOf(useAtomValue(mangaRunsAtom))
  const plugins = valueOf(useAtomValue(pluginsAtom))
  const drives = valueOf(useAtomValue(storageAtom))
  const problems = valueOf(useAtomValue(problemCountAtom))
  const notices = noticesOf({ items: items ?? [], downloads, mangaRuns, plugins, drives, problems })
  const running = runningOf({ progress, downloads, mangaRuns, plugins })
  const [dismissed, setDismissed] = useAtom(dismissedAtom)
  const shown = undismissed(notices, dismissed)

  const bars =
    usage === undefined ? [] : barsOf(usage.days, ranges.period, period === 'year' ? 7 : 1)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-[28px] font-semibold tracking-tight">Dashboard</h1>
        <PeriodSwitch period={period} onChange={setPeriod} />
      </div>
      <AttentionStrip
        notices={shown}
        running={running}
        dismissed={notices.length - shown.length}
        onDismiss={(notice) => setDismissed(dismissalsAfter(notices, dismissed, [notice]))}
        onDismissAll={() => setDismissed(dismissalsAfter(notices, dismissed, shown))}
        onRestore={() => setDismissed([])}
      />
      {usage === undefined ? null : (
        <>
          <StatRow
            period={period}
            ranges={ranges}
            today={today}
            usage={usage}
            days={daysBetween(ranges.period.from, ranges.period.to) + 1}
          />
          <DLsiteCard />
          <DLsiteWorkDialog />
          <section className="rounded-3xl bg-card px-[22px] py-5 shadow-card">
            <div className="mb-4 flex items-center gap-4">
              <h2 className="flex-1 text-[15px] font-semibold">
                {period === 'year' ? 'Spend per week' : 'Spend per day'}
              </h2>
              <SpendLegend />
            </div>
            <SpendChart bars={bars} />
          </section>
          <SpendTables presets={usage.presets} games={usage.games} />
        </>
      )}
      {progress === undefined ? null : <ProgressTable games={progress} />}
    </div>
  )
}
