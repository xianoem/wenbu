import { BrowserWindow, globalShortcut, screen } from 'electron'
import type { LiveControlsWindow } from '#contract/CoreMessages'
import { liveControlsHotkey } from '#contract/LiveControls'
import { liveControlsPlacement } from './liveControlsPlacement'

interface LiveControlsWindowOptions {
  readonly preloadPath: string
  readonly load: (window: BrowserWindow) => void
  readonly connect: (window: BrowserWindow) => void
}

export const liveControlsWindow = (options: LiveControlsWindowOptions) => {
  let window: BrowserWindow | undefined

  const create = () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

    const created = new BrowserWindow({
      ...liveControlsPlacement(display.workArea),
      minWidth: 440,
      minHeight: 480,
      show: false,
      frame: false,
      transparent: true,
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

    created.on('close', (event) => {
      event.preventDefault()
      created.hide()
    })

    created.on('closed', () => {
      if (window === created) {
        window = undefined
      }
    })

    options.load(created)

    return created
  }

  const toggle = () => {
    const target = window ?? create()

    window = target

    if (target.isVisible()) {
      target.hide()

      return
    }

    target.show()
    target.focus()
  }

  const destroy = () => {
    globalShortcut.unregister(liveControlsHotkey)
    window?.destroy()
    window = undefined
  }

  const apply = (message: LiveControlsWindow) => {
    if (!message.open) {
      return destroy()
    }

    window ??= create()

    if (!globalShortcut.isRegistered(liveControlsHotkey)) {
      globalShortcut.register(liveControlsHotkey, toggle)
    }
  }

  return { apply, destroy }
}
