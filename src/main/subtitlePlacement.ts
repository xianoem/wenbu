import type { WindowBounds } from '#contract/CoreMessages'
import { overlayPlacement } from './overlayPlacement'

const firstHeight = 200

const bottomGap = 96

export const subtitlePlacement = (
  saved: WindowBounds | undefined,
  active: WindowBounds,
  workAreas: readonly [WindowBounds, ...ReadonlyArray<WindowBounds>],
): WindowBounds => {
  if (saved !== undefined) {
    return overlayPlacement(saved, workAreas)
  }

  const width = Math.round(active.width * 0.7)

  return {
    x: active.x + Math.round((active.width - width) / 2),
    y: active.y + active.height - firstHeight - bottomGap,
    width,
    height: firstHeight,
  }
}
