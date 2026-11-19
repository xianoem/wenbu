import type { WindowBounds } from '#contract/CoreMessages'

interface Display {
  readonly bounds: WindowBounds
  readonly workArea: WindowBounds
}

interface Size {
  readonly width: number
  readonly height: number
}

type Edge = 'top' | 'bottom' | 'left' | 'right'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const taskbarEdge = ({ bounds, workArea }: Display): Edge => {
  if (workArea.y > bounds.y) {
    return 'top'
  }

  if (workArea.x > bounds.x) {
    return 'left'
  }

  if (workArea.x + workArea.width < bounds.x + bounds.width) {
    return 'right'
  }

  return 'bottom'
}

/** The window's transparent edge holds the panel's shadow, so it can touch the work area. */
export const trayPanelPlacement = (icon: WindowBounds, display: Display, size: Size) => {
  const area = display.workArea
  const right = area.x + area.width - size.width
  const bottom = area.y + area.height - size.height
  const alongX = clamp(Math.round(icon.x + icon.width / 2 - size.width / 2), area.x, right)
  const alongY = clamp(Math.round(icon.y + icon.height / 2 - size.height / 2), area.y, bottom)
  const edge = taskbarEdge(display)

  if (edge === 'top') {
    return { x: alongX, y: area.y }
  }

  if (edge === 'left') {
    return { x: area.x, y: alongY }
  }

  if (edge === 'right') {
    return { x: right, y: alongY }
  }

  return { x: alongX, y: bottom }
}
