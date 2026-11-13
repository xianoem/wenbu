import { DateTime } from 'effect'

export const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']

  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
  )

  const value = bytes / 1024 ** power

  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const millisSince = (iso: string) =>
  DateTime.toEpochMillis(DateTime.nowUnsafe()) - DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

export const daysSince = (iso: string) => Math.floor(millisSince(iso) / 86_400_000)

export const formatDay = (iso: string | undefined) => {
  if (iso === undefined) {
    return 'Never'
  }

  const days = Math.floor(millisSince(iso) / 86_400_000)

  if (days < 7) {
    const text = relative.format(-days, 'day')

    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  return dateFormat.format(DateTime.toDate(DateTime.makeUnsafe(iso)))
}

export const formatMoment = (iso: string) => {
  const minutes = Math.floor(millisSince(iso) / 60_000)

  if (minutes < 1) {
    return 'Just now'
  }

  if (minutes < 60) {
    return relative.format(-minutes, 'minute')
  }

  if (minutes < 24 * 60) {
    return relative.format(-Math.floor(minutes / 60), 'hour')
  }

  return formatDay(iso)
}

const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' })

const usdWhole = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export const formatUsd = (value: number) => {
  if (value > 0 && value < 0.005) {
    return '<$0.01'
  }

  return value >= 1000 ? usdWhole.format(value) : usd.format(value)
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export const formatCount = (value: number) => compact.format(value)
