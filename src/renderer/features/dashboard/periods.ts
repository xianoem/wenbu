import { DateTime, Schema } from 'effect'
import type { DayRange } from '#contract/Dashboard'

export const Period = Schema.Literals(['month', 'days', 'year'])

export type Period = typeof Period.Type

export const periods: ReadonlyArray<{ readonly id: Period; readonly label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'days', label: 'Last 30 days' },
  { id: 'year', label: 'This year' },
]

const dayOf = (day: string) => DateTime.makeUnsafe(`${day}T00:00:00Z`)

export const addDays = (day: string, days: number) =>
  DateTime.formatIsoDate(DateTime.add(dayOf(day), { days }))

export const daysBetween = (from: string, to: string) =>
  Math.round((DateTime.toEpochMillis(dayOf(to)) - DateTime.toEpochMillis(dayOf(from))) / 86_400_000)

export const localToday = () =>
  DateTime.formatIsoDate(DateTime.setZone(DateTime.nowUnsafe(), DateTime.zoneMakeLocal()))

const firstOfMonth = (day: string) => `${day.slice(0, 8)}01`

const lastOfMonth = (day: string) =>
  addDays(DateTime.formatIsoDate(DateTime.add(dayOf(firstOfMonth(day)), { months: 1 })), -1)

export interface Ranges {
  readonly period: DayRange
  readonly previous: DayRange
}

export const rangesOf = (period: Period, today: string): Ranges => {
  if (period === 'month') {
    const from = firstOfMonth(today)
    const lastMonth = addDays(from, -1)

    return {
      period: { from, to: today },
      previous: { from: firstOfMonth(lastMonth), to: lastMonth },
    }
  }

  if (period === 'days') {
    const from = addDays(today, -29)

    return {
      period: { from, to: today },
      previous: { from: addDays(from, -30), to: addDays(from, -1) },
    }
  }

  const year = Number(today.slice(0, 4))

  return {
    period: { from: `${year}-01-01`, to: today },
    previous: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  }
}

const monthName = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' })

export const previousLabel = (period: Period, ranges: Ranges) => {
  if (period === 'month') {
    return `in ${monthName.format(DateTime.toDate(dayOf(ranges.previous.from)))}`
  }

  if (period === 'days') {
    return 'in the 30 days before'
  }

  return `in ${ranges.previous.from.slice(0, 4)}`
}

export const monthProjection = (costUsd: number, today: string) => {
  const day = Number(today.slice(8))
  const days = Number(lastOfMonth(today).slice(8))

  return (costUsd / day) * days
}
