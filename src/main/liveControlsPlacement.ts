import type { WindowBounds } from '#contract/CoreMessages'

const size = { width: 560, height: 620 }

const margin = 24

export const liveControlsPlacement = (workArea: WindowBounds): WindowBounds => ({
  x: workArea.x + workArea.width - size.width - margin,
  y: workArea.y + margin,
  width: size.width,
  height: Math.min(size.height, workArea.height - margin * 2),
})
