import { describe, expect, it } from '@effect/vitest'
import type { ActivityItem } from '#contract/Background'
import { trayIconState, trayMenu, trayTooltip } from './trayMenu'

const download: ActivityItem = { id: 'job-1', kind: 'download', title: 'Afterglow' }

const run: ActivityItem = {
  id: 'run-1',
  kind: 'translation',
  title: 'Shirokane',
  done: 62,
  total: 100,
}

const noActions = {
  open: () => {},
  downloadLink: () => {},
  watchImages: () => {},
  watchLinks: () => {},
  settings: () => {},
  checkUpdates: () => {},
  quit: () => {},
}

describe('trayIconState', () => {
  it('is idle when nothing runs', () => {
    expect(trayIconState([])).toBe('idle')
  })

  it('shows downloads apart from other work', () => {
    expect(trayIconState([download])).toBe('downloading')
    expect(trayIconState([download, run])).toBe('running')
  })
})

describe('trayTooltip', () => {
  it('names Wenbu and what runs', () => {
    expect(trayTooltip([run])).toBe('Wenbu\nTranslating Shirokane · 62%')
  })

  it('fits the 127 characters Windows shows', () => {
    const long = Array.from({ length: 6 }, (_, index) => ({
      ...download,
      id: `job-${index}`,
      title: 'A very long gallery title that keeps going',
    }))

    expect(trayTooltip(long).length).toBeLessThanOrEqual(127)
  })
})

describe('trayMenu', () => {
  it('lists the actions in the approved order', () => {
    const labels = trayMenu({ watchImages: true, watchLinks: false }, noActions).map(
      (item) => item.label ?? item.type,
    )

    expect(labels).toEqual([
      'Open Wenbu',
      'separator',
      'Download copied link',
      'Watch copied images',
      'Watch copied gallery links',
      'separator',
      'Settings',
      'Check for updates',
      'separator',
      'Quit Wenbu',
    ])
  })

  it('ticks the listeners that are on', () => {
    const items = trayMenu({ watchImages: true, watchLinks: false }, noActions)

    expect(items.find((item) => item.label === 'Watch copied images')?.checked).toBe(true)
    expect(items.find((item) => item.label === 'Watch copied gallery links')?.checked).toBe(false)
  })
})
