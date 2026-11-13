const step = 1.25

export const zoomLimits = { fitted: 1, largest: 8 }

const snap = 0.02

export const zoomBy = (zoom: number, steps: number) => {
  const next = zoom * step ** steps
  const bounded = Math.min(zoomLimits.largest, Math.max(zoomLimits.fitted, next))

  return Math.abs(bounded - zoomLimits.fitted) < snap
    ? zoomLimits.fitted
    : Number(bounded.toFixed(4))
}

export const scrollAfterZoom = (
  scroll: { readonly left: number; readonly top: number },
  pointer: { readonly x: number; readonly y: number },
  from: number,
  to: number,
) => ({
  left: (scroll.left + pointer.x) * (to / from) - pointer.x,
  top: (scroll.top + pointer.y) * (to / from) - pointer.y,
})
