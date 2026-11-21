import { BrowserWindow, screen, type WebContents } from 'electron'
import { Effect, Fiber } from 'effect'
import { bridgeChannels } from '#contract/Bridge'
import type { WindowBounds } from '#contract/CoreMessages'
import {
  quickTranslateKeptPlacement,
  quickTranslatePlacement,
  quickTranslateSide,
  type Side,
} from './quickTranslatePlacement'

interface QuickTranslateWindowOptions {
  readonly preloadPath: string
  readonly load: (window: BrowserWindow) => void
  readonly connect: (window: BrowserWindow) => void
}

const windowWidth = 772

const firstHeight = 260

const smallestHeight = 120

const largestHeight = 640

const revealLoadedAfterMillis = 250

const revealLoadingAfterMillis = 3000

const paintAfterMillis = 150

const dragSettleMillis = 400

interface Anchor {
  readonly cursor: { readonly x: number; readonly y: number }
  readonly area: WindowBounds
  readonly side: Side
  readonly kept?: { readonly x: number; readonly y: number }
}

const later = (millis: number, run: () => void) =>
  Effect.runFork(Effect.andThen(Effect.sleep(millis), Effect.sync(run)))

const cancel = (fiber: Fiber.Fiber<void> | undefined) => {
  if (fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

export const quickTranslateWindow = (options: QuickTranslateWindowOptions) => {
  let window: BrowserWindow | undefined
  let anchor: Anchor | undefined
  let height = firstHeight
  let pinned = false
  let openings = 0
  let waitingToReveal = false
  let dragging = false
  let revealLater: Fiber.Fiber<void> | undefined
  let paintLater: Fiber.Fiber<void> | undefined
  let dragEndLater: Fiber.Fiber<void> | undefined

  const place = (target: BrowserWindow) => {
    if (anchor === undefined || dragging) {
      return
    }

    const size = {
      width: Math.min(windowWidth, anchor.area.width),
      height: Math.min(height, anchor.area.height),
    }

    const position =
      anchor.kept === undefined
        ? quickTranslatePlacement(anchor.cursor, anchor.area, anchor.side, size)
        : quickTranslateKeptPlacement(anchor.kept, anchor.area, anchor.side, size)

    target.setBounds({ ...position, ...size })
  }

  const keepDragged = (target: BrowserWindow) => {
    cancel(dragEndLater)

    if (!dragging || target.isDestroyed()) {
      return
    }

    dragging = false

    if (anchor === undefined) {
      return
    }

    const bounds = target.getBounds()
    const edge = anchor.side === 'below' ? bounds.y : bounds.y + bounds.height

    anchor = {
      ...anchor,
      area: screen.getDisplayMatching(bounds).workArea,
      kept: { x: bounds.x, y: edge },
    }

    place(target)
  }

  const showPainted = (target: BrowserWindow) => {
    cancel(paintLater)

    if (!target.isDestroyed()) {
      target.setOpacity(1)
    }
  }

  const reveal = (target: BrowserWindow) => {
    waitingToReveal = false
    cancel(revealLater)

    if (target.isDestroyed()) {
      return
    }

    place(target)
    target.setOpacity(0)
    target.show()
    target.focus()
    paintLater = later(paintAfterMillis, () => showPainted(target))
  }

  const hide = () => {
    waitingToReveal = false
    cancel(revealLater)

    if (window !== undefined && window.isVisible()) {
      window.hide()
    }
  }

  const create = () => {
    const created = new BrowserWindow({
      width: windowWidth,
      height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: options.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    created.setAlwaysOnTop(true, 'screen-saver')
    created.webContents.on('dom-ready', () => options.connect(created))

    created.on('blur', () => {
      if (!pinned) {
        hide()
      }
    })

    created.on('will-move', () => {
      dragging = true
      cancel(dragEndLater)
      dragEndLater = later(dragSettleMillis, () => keepDragged(created))
    })

    created.on('moved', () => keepDragged(created))

    created.on('closed', () => {
      if (window === created) {
        window = undefined
      }
    })

    options.load(created)

    return created
  }

  const prepare = () => {
    window ??= create()
  }

  const open = (text: string) => {
    const target = window ?? create()
    const loading = target.webContents.isLoading()
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea

    window = target
    pinned = false
    dragging = false
    cancel(dragEndLater)
    openings += 1
    anchor = { cursor, area, side: quickTranslateSide(cursor, area, largestHeight) }

    const shown = { id: openings, text }

    if (loading) {
      target.webContents.once('did-finish-load', () =>
        target.webContents.send(bridgeChannels.quickTranslate, shown),
      )
    } else {
      target.webContents.send(bridgeChannels.quickTranslate, shown)
    }

    if (target.isVisible()) {
      target.focus()
      place(target)

      return
    }

    waitingToReveal = true
    cancel(revealLater)

    revealLater = later(loading ? revealLoadingAfterMillis : revealLoadedAfterMillis, () =>
      reveal(target),
    )
  }

  const owns = (sender: WebContents) => window !== undefined && window.webContents === sender

  const resize = (sender: WebContents, reported: number) => {
    if (window === undefined || !owns(sender)) {
      return
    }

    height = Math.min(largestHeight, Math.max(smallestHeight, Math.ceil(reported)))

    if (waitingToReveal) {
      reveal(window)
    } else if (window.isVisible()) {
      place(window)
    }
  }

  const painted = (sender: WebContents) => {
    if (window !== undefined && owns(sender)) {
      showPainted(window)
    }
  }

  const pin = (sender: WebContents, on: boolean) => {
    if (owns(sender)) {
      pinned = on
    }
  }

  const hideFrom = (sender: WebContents) => {
    if (owns(sender)) {
      hide()
    }
  }

  const destroy = () => window?.destroy()

  return { prepare, open, hide, hideFrom, resize, painted, pin, destroy }
}
