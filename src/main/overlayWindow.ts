import { BrowserWindow, screen, type WebContents } from 'electron'
import { Effect, Fiber, Queue, Stream } from 'effect'
import { OverlayBounds, type OverlayWindow, type WindowBounds } from '#contract/CoreMessages'
import { overlayMinimum, overlayPlacement } from './overlayPlacement'

interface OverlayWindowOptions {
  readonly preloadPath: string
  readonly load: (window: BrowserWindow) => void
  readonly connect: (window: BrowserWindow) => void
  readonly saveBounds: (message: OverlayBounds) => void
}

const workAreas = (): readonly [WindowBounds, ...Array<WindowBounds>] => [
  screen.getPrimaryDisplay().workArea,
  ...screen.getAllDisplays().map((display) => display.workArea),
]

export const overlayWindow = (options: OverlayWindowOptions) => {
  let window: BrowserWindow | undefined
  let locked = false

  const boundsChanges = (target: BrowserWindow) =>
    Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const changed = () => Queue.offerUnsafe(queue, undefined)

          target.on('move', changed)
          target.on('resize', changed)

          return changed
        }),
        (changed) =>
          Effect.sync(() => {
            if (!target.isDestroyed()) {
              target.off('move', changed)
              target.off('resize', changed)
            }
          }),
      ),
    )

  const saveBounds = (target: BrowserWindow) =>
    boundsChanges(target).pipe(
      Stream.debounce('400 millis'),
      Stream.runForEach(() =>
        Effect.sync(() => {
          if (!target.isDestroyed()) {
            options.saveBounds(OverlayBounds.make({ bounds: target.getBounds() }))
          }
        }),
      ),
    )

  const create = (bounds: WindowBounds | undefined) => {
    const created = new BrowserWindow({
      ...overlayPlacement(bounds, workAreas()),
      minWidth: overlayMinimum.width,
      minHeight: overlayMinimum.height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: options.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    created.setAlwaysOnTop(true, 'screen-saver')
    created.webContents.on('dom-ready', () => options.connect(created))

    const saving = Effect.runFork(saveBounds(created))

    created.on('closed', () => {
      Effect.runFork(Fiber.interrupt(saving))

      if (window === created) {
        window = undefined
      }
    })

    options.load(created)

    return created
  }

  const lock = (target: BrowserWindow, value: boolean) => {
    locked = value
    target.setMovable(!value)

    if (value) {
      target.setIgnoreMouseEvents(true, { forward: true })
    } else {
      target.setIgnoreMouseEvents(false)
    }
  }

  const apply = (message: OverlayWindow) => {
    if (!message.open) {
      window?.destroy()
      window = undefined

      return
    }

    const target = window ?? create(message.bounds)

    window = target
    lock(target, message.locked)

    if (!message.visible) {
      target.hide()

      return
    }

    if (target.webContents.isLoading()) {
      target.once('ready-to-show', () => target.showInactive())
    } else {
      target.showInactive()
    }
  }

  const isOverlay = (sender: WebContents) =>
    window !== undefined && !window.isDestroyed() && window.webContents === sender

  const resize = (sender: WebContents, width: number, height: number) => {
    if (window === undefined || !isOverlay(sender) || locked) {
      return
    }

    window.setBounds({
      ...window.getBounds(),
      width: Math.max(overlayMinimum.width, Math.round(width)),
      height: Math.max(overlayMinimum.height, Math.round(height)),
    })
  }

  const captureMouse = (sender: WebContents, capture: boolean) => {
    if (window === undefined || !isOverlay(sender) || !locked) {
      return
    }

    if (capture) {
      window.setIgnoreMouseEvents(false)
    } else {
      window.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  return { apply, resize, captureMouse }
}
