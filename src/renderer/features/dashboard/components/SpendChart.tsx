import { cn } from 'cn'
import { DateTime } from 'effect'
import { useState } from 'react'
import { formatCount, formatUsd } from '#lib/format'
import { type Bar, barTotal, gridStep, type SpendGroup, spendGroups } from '../spendBars'

const groupColors: Record<SpendGroup, string> = {
  rpg: 'bg-chart-1',
  overlay: 'bg-chart-2',
  manga: 'bg-chart-3',
  other: 'bg-chart-4',
}

const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const dayLabel = (day: string) =>
  dayFormat.format(DateTime.toDate(DateTime.makeUnsafe(`${day}T00:00:00Z`)))

const barLabel = (bar: Bar) =>
  bar.from === bar.to ? dayLabel(bar.from) : `${dayLabel(bar.from)} – ${dayLabel(bar.to)}`

const gridLabel = (value: number, step: number) =>
  value === 0 || step >= 1 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`

const labelPlacement = (index: number, count: number) => {
  if (index === 0) {
    return { left: '0%', className: '' }
  }

  if (index === count - 1) {
    return { left: '100%', className: '-translate-x-full' }
  }

  return { left: `${((index + 0.5) / count) * 100}%`, className: '-translate-x-1/2' }
}

const labelIndexes = (count: number) => {
  if (count <= 5) {
    return new Set(Array.from({ length: count }, (_, index) => index))
  }

  return new Set([0, 1, 2, 3, 4].map((step) => Math.round((step * (count - 1)) / 4)))
}

export function SpendLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {spendGroups.map((group) => (
        <span key={group.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2.5 rounded-[3px]', groupColors[group.id])} />
          {group.label}
        </span>
      ))}
    </div>
  )
}

export function SpendChart({ bars }: { readonly bars: ReadonlyArray<Bar> }) {
  const [hovered, setHovered] = useState<number | undefined>(undefined)
  const max = Math.max(...bars.map((bar) => barTotal(bar)), 0)
  const step = gridStep(Math.max(max, 0.2))
  const top = Math.ceil(Math.max(max, step) / step) * step
  const lines = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
  const labels = labelIndexes(bars.length)
  const shown = hovered === undefined ? undefined : bars[hovered]

  return (
    <div className="flex">
      <div className="relative mr-2 h-[180px] w-9 shrink-0">
        {lines.map((value) => (
          <span
            key={value}
            className="absolute right-0 translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
            style={{ bottom: `${(value / top) * 100}%` }}
          >
            {gridLabel(value, step)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-[180px]" onMouseLeave={() => setHovered(undefined)}>
          {lines.map((value) => (
            <span
              key={value}
              aria-hidden
              className={cn(
                'absolute inset-x-0 h-px',
                value === 0 ? 'bg-foreground/15' : 'bg-foreground/[0.06]',
              )}
              style={{ bottom: `${(value / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {bars.map((bar, index) => {
              const parts = spendGroups.filter((group) => bar.costUsd[group.id] > 0)

              return (
                <div
                  key={bar.from}
                  className={cn(
                    'flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px] rounded-t-[4px]',
                    hovered === index && 'bg-foreground/[0.04]',
                  )}
                  onMouseEnter={() => setHovered(index)}
                >
                  {parts.map((group, part) => (
                    <span
                      key={group.id}
                      className={cn(
                        'block w-full shrink-0',
                        groupColors[group.id],
                        part === parts.length - 1 && 'rounded-t-[4px]',
                      )}
                      style={{
                        height: `max(1px, calc(${(bar.costUsd[group.id] / top) * 100}% - 2px))`,
                      }}
                    />
                  ))}
                </div>
              )
            })}
          </div>
          {shown === undefined || hovered === undefined ? null : (
            <div
              className="pointer-events-none absolute top-0 z-10 w-72 rounded-2xl bg-popover p-3 text-xs shadow-card"
              style={
                hovered < bars.length / 2
                  ? { left: `calc(${((hovered + 1) / bars.length) * 100}% + 8px)` }
                  : { right: `calc(${((bars.length - hovered) / bars.length) * 100}% + 8px)` }
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{barLabel(shown)}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatUsd(barTotal(shown))}
                </span>
              </div>
              {barTotal(shown) === 0 && shown.tokens === 0 ? (
                <div className="mt-1 text-muted-foreground">No requests</div>
              ) : (
                <>
                  <div className="mt-2 flex flex-col gap-1">
                    {spendGroups.map((group) => (
                      <div
                        key={group.id}
                        className="flex items-center gap-1.5 text-muted-foreground"
                      >
                        <span
                          aria-hidden
                          className={cn('size-2 shrink-0 rounded-[2px]', groupColors[group.id])}
                        />
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <span className="shrink-0 pl-2 text-foreground tabular-nums">
                          {formatUsd(shown.costUsd[group.id])}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-muted-foreground">
                    {formatCount(shown.tokens)} tokens
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="relative mt-1.5 h-4">
          {bars.map((bar, index) => {
            if (!labels.has(index)) {
              return null
            }

            const placement = labelPlacement(index, bars.length)

            return (
              <span
                key={bar.from}
                className={cn(
                  'absolute text-[11px] whitespace-nowrap text-muted-foreground',
                  placement.className,
                )}
                style={{ left: placement.left }}
              >
                {dayLabel(bar.from)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
