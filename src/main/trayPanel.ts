import { BrowserWindow, screen, type WebContents } from 'electron'
import { Clock, Effect, Fiber } from 'effect'
import { bridgeChannels, type PanelShown } from '#contract/Bridge'
import type { WindowBounds } from '#contract/CoreMessages'
import { trayPanelPlacement } from './trayPanelPlacement'

interface TrayPanelOptions {
  readonly preloadPath: string
  readonly load: (window: BrowserWindow) => void
  readonly connect: (window: BrowserWindow) => void
  readonly icon: () => WindowBounds
}

/** The panel's 392 pixels plus the transparent edge its shadow is drawn in. */
const panelWidth = 424

const firstHeight = 640

const smallestHeight = 160

// A click on the tray icon blurs the open panel first; that same click must not reopen it.
const reopenAfterMillis = 300

// The page answers each opening with its height; these only cover a page that never does.
const revealLoadedAfterMillis = 250

const revealLoadingAfterMillis = 3000

// The panel fades in once its page has painted the new content, so no old frame flashes.
const paintAfterMillis = 150

const now = () => Effect.runSync(Clock.currentTimeMillis)

const later = (millis: number, run: () => void) =>
  Effect.runFork(Effect.andThen(Effect.sleep(millis), Effect.sync(run)))

const cancel = (fiber: Fiber.Fiber<void> | undefined) => {
  if (fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

/** Made once and kept: a new window takes seconds to load, a hidden one opens at once. */
export const trayPanel = (options: TrayPanelOptions) => {
  let window: BrowserWindow | undefined
  let height = firstHeight
  let hiddenAt = 0
  let waitingToReveal = false
  let revealLater: Fiber.Fiber<void> | undefined
  let paintLater: Fiber.Fiber<void> | undefined

  const place = (target: BrowserWindow) => {
    const icon = options.icon()
    const display = screen.getDisplayMatching(icon)
    const fitted = Math.min(height, display.workArea.height)
    const size = { width: panelWidth, height: fitted }

    target.setBounds({ ...trayPanelPlacement(icon, display, size), ...size })
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
    if (window === undefined || !window.isVisible()) {
      return
    }

    window.hide()
    hiddenAt = now()
  }

  const create = () => {
    const created = new BrowserWindow({
      width: panelWidth,
      height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
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

    created.webContents.on('dom-ready', () => options.connect(created))
    created.on('blur', hide)

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

  const show = (shown: PanelShown) => {
    const target = window ?? create()
    const loading = target.webContents.isLoading()

    window = target

    if (loading) {
      target.webContents.once('did-finish-load', () =>
        target.webContents.send(bridgeChannels.panelShown, shown),
      )
    } else {
      target.webContents.send(bridgeChannels.panelShown, shown)
    }

    waitingToReveal = true
    cancel(revealLater)

    revealLater = later(loading ? revealLoadingAfterMillis : revealLoadedAfterMillis, () =>
      reveal(target),
    )
  }

  const toggle = (shown: PanelShown) => {
    if (window?.isVisible() === true) {
      hide()

      return
    }

    if (now() - hiddenAt > reopenAfterMillis) {
      show(shown)
    }
  }

  const resize = (sender: WebContents, reported: number) => {
    if (window === undefined || window.webContents !== sender) {
      return
    }

    height = Math.max(smallestHeight, Math.ceil(reported))

    if (waitingToReveal) {
      reveal(window)
    } else if (window.isVisible()) {
      place(window)
    }
  }

  const painted = (sender: WebContents) => {
    if (window !== undefined && window.webContents === sender) {
      showPainted(window)
    }
  }

  const send = (channel: string) => {
    const contents = window?.webContents

    if (contents?.isLoading() === true) {
      contents.once('did-finish-load', () => contents.send(channel))
    } else {
      contents?.send(channel)
    }
  }

  return { prepare, show, hide, toggle, resize, painted, send }
}
