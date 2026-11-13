import type { DayRange, DayUsage } from '#contract/Dashboard'
import type { UsageFeature } from '#contract/Llm'
import { addDays, daysBetween } from './periods'

export type SpendGroup = 'rpg' | 'overlay' | 'manga' | 'other'

export const spendGroups: ReadonlyArray<{ readonly id: SpendGroup; readonly label: string }> = [
  { id: 'rpg', label: 'RPG Maker translation' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'manga', label: 'Manga and Manga Editor' },
  { id: 'other', label: 'Novels, Game Guide, Subtitles and more' },
]

const groupOfFeature: Record<UsageFeature, SpendGroup> = {
  'rpg-translation': 'rpg',
  'line-review': 'rpg',
  overlay: 'overlay',
  manga: 'manga',
  'manga-editor': 'manga',
  subtitles: 'other',
  'game-guide': 'other',
  detections: 'other',
  'in-game-text': 'other',
  details: 'other',
  novels: 'other',
}

export interface Bar {
  readonly from: string
  readonly to: string
  readonly costUsd: Readonly<Record<SpendGroup, number>>
  readonly tokens: number
}

const emptySpend = (): Record<SpendGroup, number> => ({ rpg: 0, overlay: 0, manga: 0, other: 0 })

export const barsOf = (days: ReadonlyArray<DayUsage>, range: DayRange, size: number) => {
  const count = daysBetween(range.from, range.to) + 1

  const bars = Array.from({ length: Math.ceil(count / size) }, (_, index) => {
    const from = addDays(range.from, index * size)
    const last = addDays(from, size - 1)

    return { from, to: last < range.to ? last : range.to, costUsd: emptySpend(), tokens: 0 }
  })

  for (const usage of days) {
    const bar = bars[Math.floor(daysBetween(range.from, usage.day) / size)]

    if (bar === undefined) {
      continue
    }

    bar.costUsd[groupOfFeature[usage.feature]] += usage.costUsd
    bar.tokens += usage.tokens
  }

  return bars satisfies ReadonlyArray<Bar>
}

export const barTotal = (bar: Bar) =>
  bar.costUsd.rpg + bar.costUsd.overlay + bar.costUsd.manga + bar.costUsd.other

export const groupTotals = (days: ReadonlyArray<DayUsage>) => {
  const totals = emptySpend()

  for (const usage of days) {
    totals[groupOfFeature[usage.feature]] += usage.costUsd
  }

  return totals
}

export const gridStep = (max: number) => {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000]

  return steps.find((step) => max / step <= 4) ?? steps[steps.length - 1] ?? 1
}
