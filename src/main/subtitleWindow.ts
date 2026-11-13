import { BrowserWindow, screen, type WebContents } from 'electron'
import { Effect, Fiber, Queue, Stream } from 'effect'
import { SubtitleBounds, type SubtitleWindow, type WindowBounds } from '#contract/CoreMessages'
import { overlayMinimum } from './overlayPlacement'
import { subtitlePlacement } from './subtitlePlacement'

interface SubtitleWindowOptions {
  readonly preloadPath: string
  readonly load: (window: BrowserWindow) => void
  readonly connect: (window: BrowserWindow) => void
  readonly saveBounds: (message: SubtitleBounds) => void
}

const workAreas = (): readonly [WindowBounds, ...Array<WindowBounds>] => [
  screen.getPrimaryDisplay().workArea,
  ...screen.getAllDisplays().map((display) => display.workArea),
]

const activeArea = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea

export const subtitleWindow = (options: SubtitleWindowOptions) => {
  let window: BrowserWindow | undefined
  let locked = true

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
            options.saveBounds(SubtitleBounds.make({ bounds: target.getBounds() }))
          }
        }),
      ),
    )

  const create = (bounds: WindowBounds | undefined) => {
    const created = new BrowserWindow({
      ...subtitlePlacement(bounds, activeArea(), workAreas()),
      minWidth: overlayMinimum.width,
      minHeight: overlayMinimum.height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
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
    created.setIgnoreMouseEvents(true, { forward: true })
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

  const lock = (value: boolean) => {
    locked = value
  }

  const apply = (message: SubtitleWindow) => {
    if (!message.open) {
      window?.destroy()
      window = undefined

      return
    }

    const target = window ?? create(message.bounds)

    window = target
    lock(message.locked)
    target.setContentProtection(message.hideFromCapture)

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

  const isSubtitles = (sender: WebContents) =>
    window !== undefined && !window.isDestroyed() && window.webContents === sender

  const resize = (sender: WebContents, width: number, height: number) => {
    if (window === undefined || !isSubtitles(sender)) {
      return
    }

    const bounds = window.getBounds()
    const nextHeight = Math.max(overlayMinimum.height, Math.round(height))

    window.setBounds({
      ...bounds,
      y: bounds.y + bounds.height - nextHeight,
      width: locked ? bounds.width : Math.max(overlayMinimum.width, Math.round(width)),
      height: nextHeight,
    })
  }

  const captureMouse = (sender: WebContents, capture: boolean) => {
    if (window === undefined || !isSubtitles(sender)) {
      return
    }

    if (capture) {
      window.setIgnoreMouseEvents(false)
    } else {
      window.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  const move = (sender: WebContents, x: number, y: number) => {
    if (window === undefined || !isSubtitles(sender) || locked) {
      return
    }

    window.setPosition(Math.round(x), Math.round(y))
  }

  const isOpen = () => window !== undefined && !window.isDestroyed()

  return { apply, resize, captureMouse, move, isOpen }
}
