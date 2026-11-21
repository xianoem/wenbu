import type { WindowBounds } from '#contract/CoreMessages'

interface Point {
  readonly x: number
  readonly y: number
}

interface Size {
  readonly width: number
  readonly height: number
}

export type Side = 'below' | 'above'

const leadIn = 72

const gap = 22

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export const quickTranslateSide = (cursor: Point, area: WindowBounds, largest: number): Side =>
  cursor.y + gap + largest <= area.y + area.height || cursor.y - area.y < largest
    ? 'below'
    : 'above'

export const quickTranslatePlacement = (
  cursor: Point,
  area: WindowBounds,
  side: Side,
  size: Size,
) => {
  const x = clamp(Math.round(cursor.x - leadIn), area.x, area.x + area.width - size.width)
  const wanted = side === 'below' ? cursor.y + gap : cursor.y - gap - size.height

  return { x, y: clamp(Math.round(wanted), area.y, area.y + area.height - size.height) }
}

export const quickTranslateKeptPlacement = (
  edge: Point,
  area: WindowBounds,
  side: Side,
  size: Size,
) => {
  const y = side === 'below' ? edge.y : edge.y - size.height

  return {
    x: clamp(edge.x, area.x, area.x + area.width - size.width),
    y: clamp(y, area.y, area.y + area.height - size.height),
  }
}
