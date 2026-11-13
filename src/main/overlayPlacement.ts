import type { WindowBounds } from '#contract/CoreMessages'

export const overlayMinimum = { width: 360, height: 120 } as const

const firstPlacement = { x: 80, y: 80, width: 760, height: 190 } as const

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const overlap = (bounds: WindowBounds, area: WindowBounds) => {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)

  const height =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)

  return Math.max(0, width) * Math.max(0, height)
}

const bestArea = (
  bounds: WindowBounds,
  areas: ReadonlyArray<WindowBounds>,
  primary: WindowBounds,
) =>
  areas.reduce(
    (best, area) => (overlap(bounds, area) > overlap(bounds, best) ? area : best),
    primary,
  )

export const overlayPlacement = (
  saved: WindowBounds | undefined,
  workAreas: readonly [WindowBounds, ...ReadonlyArray<WindowBounds>],
): WindowBounds => {
  const [primary] = workAreas

  if (saved === undefined) {
    return {
      ...firstPlacement,
      x: primary.x + firstPlacement.x,
      y: primary.y + firstPlacement.y,
    }
  }

  const area = bestArea(saved, workAreas, primary)
  const width = clamp(saved.width, overlayMinimum.width, Math.max(overlayMinimum.width, area.width))

  const height = clamp(
    saved.height,
    overlayMinimum.height,
    Math.max(overlayMinimum.height, area.height),
  )

  return {
    x: clamp(saved.x, area.x, area.x + area.width - width),
    y: clamp(saved.y, area.y, area.y + area.height - height),
    width,
    height,
  }
}
