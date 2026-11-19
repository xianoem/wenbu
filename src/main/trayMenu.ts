import type { MenuItemConstructorOptions } from 'electron'
import { type ActivityItem, activityLabel } from '#contract/Background'

export type TrayIconState = 'idle' | 'running' | 'downloading'

export const trayIconState = (activity: ReadonlyArray<ActivityItem>): TrayIconState => {
  if (activity.length === 0) {
    return 'idle'
  }

  return activity.every((item) => item.kind === 'download') ? 'downloading' : 'running'
}

// Windows cuts tray tooltips at 127 characters.
const tooltipLimit = 127

const tooltipLines = (labels: ReadonlyArray<string>, shown: number) => {
  const hidden = labels.length - shown

  return ['Wenbu', ...labels.slice(0, shown), ...(hidden > 0 ? [`+${hidden} more`] : [])]
}

export const trayTooltip = (activity: ReadonlyArray<ActivityItem>) => {
  const labels = activity.map((item) => activityLabel(item))

  for (let shown = labels.length; shown > 0; shown -= 1) {
    const text = tooltipLines(labels, shown).join('\n')

    if (text.length <= tooltipLimit) {
      return text
    }
  }

  return tooltipLines(labels, 0).join('\n')
}

interface TrayMenuActions {
  readonly open: () => void
  readonly downloadLink: () => void
  readonly watchImages: (on: boolean) => void
  readonly watchLinks: (on: boolean) => void
  readonly settings: () => void
  readonly checkUpdates: () => void
  readonly quit: () => void
}

interface Listeners {
  readonly watchImages: boolean
  readonly watchLinks: boolean
}

export const trayMenu = (
  listeners: Listeners,
  actions: TrayMenuActions,
): Array<MenuItemConstructorOptions> => [
  { label: 'Open Wenbu', click: actions.open },
  { type: 'separator' },
  { label: 'Download copied link', accelerator: 'Ctrl+Alt+D', click: actions.downloadLink },
  {
    label: 'Watch copied images',
    type: 'checkbox',
    checked: listeners.watchImages,
    click: (item) => actions.watchImages(item.checked),
  },
  {
    label: 'Watch copied gallery links',
    type: 'checkbox',
    checked: listeners.watchLinks,
    click: (item) => actions.watchLinks(item.checked),
  },
  { type: 'separator' },
  { label: 'Settings', click: actions.settings },
  { label: 'Check for updates', click: actions.checkUpdates },
  { type: 'separator' },
  { label: 'Quit Wenbu', click: actions.quit },
]
