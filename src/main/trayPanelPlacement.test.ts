import { describe, expect, it } from '@effect/vitest'
import { trayPanelPlacement } from './trayPanelPlacement'

const size = { width: 424, height: 600 }
const bounds = { x: 0, y: 0, width: 1920, height: 1080 }

describe('trayPanelPlacement', () => {
  it('opens above a taskbar at the bottom, centred on the tray icon', () => {
    const display = { bounds, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }

    expect(trayPanelPlacement({ x: 1500, y: 1048, width: 24, height: 24 }, display, size)).toEqual({
      x: 1300,
      y: 440,
    })
  })

  it('stays on screen when the icon sits at the far right', () => {
    const display = { bounds, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }

    expect(trayPanelPlacement({ x: 1880, y: 1048, width: 24, height: 24 }, display, size)).toEqual({
      x: 1496,
      y: 440,
    })
  })

  it('opens below a taskbar at the top', () => {
    const display = { bounds, workArea: { x: 0, y: 40, width: 1920, height: 1040 } }

    expect(trayPanelPlacement({ x: 1500, y: 8, width: 24, height: 24 }, display, size)).toEqual({
      x: 1300,
      y: 40,
    })
  })

  it('opens beside a taskbar on the left', () => {
    const display = { bounds, workArea: { x: 60, y: 0, width: 1860, height: 1080 } }

    expect(trayPanelPlacement({ x: 18, y: 980, width: 24, height: 24 }, display, size)).toEqual({
      x: 60,
      y: 480,
    })
  })

  it('opens beside a taskbar on the right', () => {
    const display = { bounds, workArea: { x: 0, y: 0, width: 1860, height: 1080 } }

    expect(trayPanelPlacement({ x: 1878, y: 300, width: 24, height: 24 }, display, size)).toEqual({
      x: 1436,
      y: 12,
    })
  })

  it('uses the bottom right corner when the taskbar hides itself', () => {
    const display = { bounds, workArea: bounds }

    expect(trayPanelPlacement({ x: 1500, y: 1060, width: 24, height: 24 }, display, size)).toEqual({
      x: 1300,
      y: 480,
    })
  })
})
