import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { arch, release, totalmem, version } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron'
import { Cause, Clock, DateTime, Effect, Predicate, Redacted, Schedule, Schema } from 'effect'
import { bridgeChannels } from '#contract/Bridge'
import {
  ClipboardImage,
  LiveControlsWindow,
  MainLogEntry,
  OverlayWindow,
  PageFetch,
  SourceSignIn,
  SourceSignOut,
  SubtitleLockToggle,
  SubtitleWindow,
  UpdateInstall,
  UpdateWatch,
} from '#contract/CoreMessages'
import type { CoreStopped } from '#contract/CoreStopped'
import { pageImageScheme, pageImageWanted, thumbnailWanted } from '#contract/PageImage'
import { WindowAction } from '#contract/WindowAction'
import appIconPng from '../../build/icon.png?asset'
import appIconIco from '../../build/icon.ico?asset'
import { appUpdater } from './appUpdater'
import { coreSupervisor, type CoreSupervisor } from './coreSupervisor'
import { coreCrashBudget } from './crashBudget'
import { type CredentialKey, loadCredentialKey, type SecretProtector } from './credentialKey'
import { diagnosticsReport } from './diagnosticsReport'
import { liveControlsWindow } from './liveControlsWindow'
import { overlayWindow } from './overlayWindow'
import { subtitleWindow } from './subtitleWindow'
import { browserSignIns, chromeAgent } from './browserSignIn'
import { novelPages } from './novelPages'
import { keptLaunches, launchId, mainLog, outputTail, pruneLaunches } from './mainLog'
import { thumbnailCache } from './thumbnailCache'

const preloadPath = join(import.meta.dirname, '../preload/preload.cjs')
const rendererUrl = process.env['ELECTRON_RENDERER_URL']

// A second launch must leave before it prunes logs or starts another core on the same database.
if (!app.requestSingleInstanceLock()) {
  process.exit(0)
}

crashReporter.start({ uploadToServer: false })

const logsRoot = join(app.getPath('userData'), 'logs')
const launch = launchId(Effect.runSync(Clock.currentTimeMillis))

mkdirSync(logsRoot, { recursive: true })
pruneLaunches(logsRoot, keptLaunches - 1)

let supervisor: CoreSupervisor | undefined
let mainWindow: BrowserWindow | undefined
let coreReady = false

const log = mainLog({
  folder: join(logsRoot, launch),
  home: app.getPath('home'),
  forward: (entry) => {
    if (coreReady) {
      supervisor?.postMessage(MainLogEntry.make({ entry }), [])
    }
  },
})

const coreOutput = outputTail(40)

const versionLabel = () => (app.isPackaged ? app.getVersion() : `${app.getVersion()} (dev)`)

log.info('Wenbu started', {
  version: versionLabel(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  os: `${version()} ${release()}`,
  arch: arch(),
})

const safeStorageProtector: SecretProtector = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  decrypt: async (cipher) => (await safeStorage.decryptStringAsync(Buffer.from(cipher))).result,
}

const userAgent = () => chromeAgent(app.userAgentFallback, process.versions.chrome)

const startCore = (credentialKey: CredentialKey, run: number) => {
  const core = utilityProcess.fork(join(import.meta.dirname, 'core.js'), [], {
    serviceName: 'Wenbu core',
    stdio: 'pipe',
    env: {
      ...process.env,
      WENBU_DATA_DIR: app.getPath('userData'),
      WENBU_LOG_DIR: log.folder,
      WENBU_CORE_RUN: String(run),
      WENBU_APP_VERSION: versionLabel(),
      WENBU_RESOURCES_DIR: app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), 'resources'),
      WENBU_CREDENTIAL_KEY: Redacted.value(credentialKey.key),
      WENBU_KEY_PROTECTION: credentialKey.protection,
      WENBU_USER_AGENT: userAgent(),
    },
  })

  core.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))

  core.stderr?.on('data', (chunk: Buffer) => {
    coreOutput.push(chunk.toString())
    process.stderr.write(chunk)
  })

  core.once('spawn', () => {
    coreReady = true
    log.info('Core process spawned', { run, pid: core.pid })
  })

  core.once('exit', () => {
    coreReady = false
  })

  return core
}

const connectToCore = (core: CoreSupervisor, window: BrowserWindow) => {
  const stopped = core.stopped()

  if (stopped !== undefined) {
    window.webContents.send(bridgeChannels.coreStopped, stopped)

    return
  }

  const { port1, port2 } = new MessageChannelMain()

  core.postMessage(null, [port1])
  window.webContents.postMessage(bridgeChannels.corePort, null, [port2])
}

const pageName = (url: string) => url.split(/[\\/]/).at(-1)?.split(/[?#]/)[0] || 'index'

const isAppUrl = (url: string) =>
  rendererUrl === undefined ? url.startsWith('file://') : url.startsWith(rendererUrl)

const loadPage = (
  window: BrowserWindow,
  page: 'index' | 'overlay' | 'livecontrols' | 'subtitles',
) => {
  if (rendererUrl === undefined) {
    void window.loadFile(join(import.meta.dirname, `../renderer/${page}.html`))

    return
  }

  void window.loadURL(page === 'index' ? rendererUrl : `${rendererUrl}/${page}.html`)
}

const keepInApp = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
    }
  })
}

const createWindow = (core: CoreSupervisor) => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    icon: process.platform === 'win32' ? appIconIco : appIconPng,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafafa',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.webContents.on('dom-ready', () => connectToCore(core, window))
  keepInApp(window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => app.quit())
  loadPage(window, 'index')

  return window
}

const isOverlayWindow = Schema.is(OverlayWindow)

const startOverlay = (core: CoreSupervisor) => {
  const overlay = overlayWindow({
    preloadPath,
    load: (window) => {
      keepInApp(window)
      loadPage(window, 'overlay')
    },
    connect: (window) => connectToCore(core, window),
    saveBounds: (message) => core.postMessage(message, []),
  })

  core.on('message', (message) => {
    if (isOverlayWindow(message)) {
      overlay.apply(message)
    }
  })

  ipcMain.on(bridgeChannels.resizeOverlay, (event, width, height) => {
    if (Predicate.isNumber(width) && Predicate.isNumber(height)) {
      overlay.resize(event.sender, width, height)
    }
  })

  ipcMain.on(bridgeChannels.captureOverlayMouse, (event, capture) => {
    if (Predicate.isBoolean(capture)) {
      overlay.captureMouse(event.sender, capture)
    }
  })
}

const isSubtitleWindow = Schema.is(SubtitleWindow)

const subtitleLockShortcut = 'CommandOrControl+Shift+S'

const startSubtitles = (core: CoreSupervisor) => {
  const subtitles = subtitleWindow({
    preloadPath,
    load: (window) => {
      keepInApp(window)
      loadPage(window, 'subtitles')
    },
    connect: (window) => connectToCore(core, window),
    saveBounds: (message) => core.postMessage(message, []),
  })

  const syncShortcut = () => {
    const registered = globalShortcut.isRegistered(subtitleLockShortcut)

    if (subtitles.isOpen() && !registered) {
      globalShortcut.register(subtitleLockShortcut, () =>
        core.postMessage(SubtitleLockToggle.make({}), []),
      )
    }

    if (!subtitles.isOpen() && registered) {
      globalShortcut.unregister(subtitleLockShortcut)
    }
  }

  core.on('message', (message) => {
    if (isSubtitleWindow(message)) {
      subtitles.apply(message)
      syncShortcut()
    }
  })

  ipcMain.on(bridgeChannels.resizeOverlay, (event, width, height) => {
    if (Predicate.isNumber(width) && Predicate.isNumber(height)) {
      subtitles.resize(event.sender, width, height)
    }
  })

  ipcMain.on(bridgeChannels.captureOverlayMouse, (event, capture) => {
    if (Predicate.isBoolean(capture)) {
      subtitles.captureMouse(event.sender, capture)
    }
  })

  ipcMain.on(bridgeChannels.moveOverlay, (event, x, y) => {
    if (Predicate.isNumber(x) && Predicate.isNumber(y)) {
      subtitles.move(event.sender, x, y)
    }
  })
}

const isLiveControlsWindow = Schema.is(LiveControlsWindow)

const startLiveControls = (core: CoreSupervisor) => {
  const live = liveControlsWindow({
    preloadPath,
    load: (window) => {
      keepInApp(window)
      loadPage(window, 'livecontrols')
    },
    connect: (window) => connectToCore(core, window),
  })

  core.on('message', (message) => {
    if (isLiveControlsWindow(message)) {
      live.apply(message)
    }
  })

  app.on('before-quit', () => live.destroy())
}

const isSourceSignIn = Schema.is(SourceSignIn)

const isSourceSignOut = Schema.is(SourceSignOut)

const startSignIns = (core: CoreSupervisor) => {
  const signIns = browserSignIns({
    folder: join(app.getPath('userData'), 'sign-in'),
    deliver: (session) => core.postMessage(session, []),
  })

  core.on('message', (message) => {
    if (isSourceSignIn(message)) {
      signIns.show(message)
    }

    if (isSourceSignOut(message)) {
      signIns.forget(message.source)
    }
  })
}

const isPageFetch = Schema.is(PageFetch)

const startNovelPages = (core: CoreSupervisor) => {
  const pages = novelPages({
    userAgent: chromeAgent(app.userAgentFallback, process.versions.chrome),
    log: (level, message, fields) => log[level](message, { feature: 'novels', ...fields }),
  })

  core.on('message', (message) => {
    if (isPageFetch(message)) {
      Effect.runFork(Effect.map(pages.fetch(message), (page) => core.postMessage(page, [])))
    }
  })
}

const isUpdateWatch = Schema.is(UpdateWatch)

const isUpdateInstall = Schema.is(UpdateInstall)

const startUpdates = (core: CoreSupervisor) => {
  const updater = appUpdater({ log, onStatus: (status) => core.postMessage(status, []) })

  core.on('message', (message) => {
    if (isUpdateWatch(message)) {
      core.postMessage(updater.status(), [])
    }

    if (isUpdateInstall(message)) {
      updater.install()
    }
  })

  return updater.run
}

const isWindowAction = Schema.is(WindowAction)

const runWindowAction = (window: BrowserWindow, action: WindowAction) => {
  if (action === 'minimize') {
    return window.minimize()
  }

  if (action === 'close') {
    return window.close()
  }

  return window.isMaximized() ? window.unmaximize() : window.maximize()
}

ipcMain.on(bridgeChannels.window, (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender)

  if (window !== null && isWindowAction(action)) {
    runWindowAction(window, action)
  }
})

ipcMain.handle(bridgeChannels.chooseFolder, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }

  const result = await (window === null
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(window, options))

  return result.canceled ? undefined : result.filePaths[0]
})

ipcMain.handle(bridgeChannels.chooseArchive, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)

  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Zip archives', extensions: ['zip'] }],
  }

  const result = await (window === null
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(window, options))

  return result.canceled ? undefined : result.filePaths[0]
})

ipcMain.handle(bridgeChannels.chooseSavePath, async (event, suggested, extension) => {
  if (!Predicate.isString(suggested) || !Predicate.isString(extension)) {
    return undefined
  }

  const window = BrowserWindow.fromWebContents(event.sender)

  const options: Electron.SaveDialogOptions = {
    defaultPath: suggested,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  }

  const result = await (window === null
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(window, options))

  return result.canceled ? undefined : result.filePath
})

ipcMain.on(bridgeChannels.revealPath, (_event, path) => {
  if (Predicate.isString(path)) {
    shell.showItemInFolder(path)
  }
})

ipcMain.on(bridgeChannels.openExternal, (_event, url) => {
  if (Predicate.isString(url) && url.startsWith('https://')) {
    void shell.openExternal(url)
  }
})

ipcMain.on(bridgeChannels.relaunch, () => {
  log.info('Restarting Wenbu')
  app.relaunch()
  app.exit(0)
})

const crashDumpCount = () => {
  const folder = app.getPath('crashDumps')

  if (!existsSync(folder)) {
    return 0
  }

  return readdirSync(folder, { recursive: true }).filter((name) => String(name).endsWith('.dmp'))
    .length
}

const aboutWenbu = (): ReadonlyArray<readonly [string, string]> => [
  ['Wenbu', versionLabel()],
  ['Electron', process.versions.electron],
  ['Chrome', process.versions.chrome],
  ['Node', process.versions.node],
  ['Windows', `${version()} ${release()} ${arch()}`],
  ['Memory', `${Math.round(totalmem() / 1024 ** 3)} GB`],
  ['Locale', app.getLocale()],
  ['Crash dumps', String(crashDumpCount())],
  ['Exported', DateTime.formatIso(DateTime.makeUnsafe(Effect.runSync(Clock.currentTimeMillis)))],
]

ipcMain.handle(bridgeChannels.exportDiagnostics, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)

  const options: Electron.SaveDialogOptions = {
    defaultPath: join(app.getPath('downloads'), `wenbu-diagnostics-${launch}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  }

  const result = await (window === null
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(window, options))

  if (result.canceled || result.filePath === '') {
    return undefined
  }

  writeFileSync(result.filePath, diagnosticsReport({ root: logsRoot, about: aboutWenbu() }))
  log.info('Diagnostics exported')
  shell.showItemInFolder(result.filePath)

  return result.filePath
})

ipcMain.on(bridgeChannels.openLogsFolder, () => {
  void shell.openPath(log.folder)
})

app.on('render-process-gone', (_event, contents, details) => {
  log.error('A window crashed', {
    reason: details.reason,
    exitCode: details.exitCode,
    page: pageName(contents.getURL()),
  })
})

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') {
    return
  }

  log.error('A helper process crashed', {
    type: details.type,
    name: details.name,
    reason: details.reason,
    exitCode: details.exitCode,
  })
})

app.on('browser-window-created', (_event, window) => {
  window.on('unresponsive', () =>
    log.warn('A window stopped responding', { page: pageName(window.webContents.getURL()) }),
  )

  window.on('responsive', () =>
    log.info('A window responds again', { page: pageName(window.webContents.getURL()) }),
  )
})

process.on('uncaughtExceptionMonitor', (error) => {
  log.fatal('Uncaught error in main', {}, error.stack ?? String(error))
})

process.on('unhandledRejection', (reason) => {
  log.error(
    'Unhandled rejection in main',
    {},
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  )
})

const reconnectWindows = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (isAppUrl(window.webContents.getURL())) {
      window.webContents.reload()
    }
  }
}

const showCoreStopped = (main: BrowserWindow | undefined, stopped: CoreStopped) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window !== main) {
      window.destroy()
    }
  }

  if (main === undefined || main.isDestroyed()) {
    return
  }

  main.webContents.send(bridgeChannels.coreStopped, stopped)

  if (!main.isFocused()) {
    main.flashFrame(true)
  }
}

const clipboardPng = Effect.tryPromise(async () => {
  if (!(await clipboard.has('image/png'))) {
    return undefined
  }

  const item = (await clipboard.read()).find((candidate) => candidate.types.includes('image/png'))

  return item === undefined
    ? undefined
    : new Uint8Array(await (await item.getType('image/png')).arrayBuffer())
}).pipe(Effect.orElseSucceed(() => undefined))

const toClipboardImage = (png: Uint8Array): ClipboardImage | undefined => {
  const image = nativeImage.createFromBuffer(Buffer.from(png))

  if (image.isEmpty()) {
    return undefined
  }

  const { width, height } = image.getSize()
  const pixels = Uint8Array.from(image.toBitmap())

  // Electron's bitmaps are BGRA.
  for (let index = 0; index < pixels.length; index += 4) {
    const blue = pixels[index] ?? 0

    pixels[index] = pixels[index + 2] ?? 0
    pixels[index + 2] = blue
  }

  return ClipboardImage.make({ width, height, pixels })
}

const hashOf = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

const watchClipboard = Effect.fnUntraced(function* (core: CoreSupervisor) {
  const initial = yield* clipboardPng
  let last = initial === undefined ? undefined : hashOf(initial)

  const poll = Effect.gen(function* () {
    const png = yield* clipboardPng
    const hash = png === undefined ? undefined : hashOf(png)

    if (png === undefined || hash === last) {
      last = hash

      return
    }

    last = hash

    const message = toClipboardImage(png)

    if (message !== undefined) {
      core.postMessage(message, [])
    }
  })

  yield* Effect.repeat(poll, Schedule.spaced('750 millis'))
})

app.on('second-instance', () => {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
})

app.on('window-all-closed', () => app.quit())

// Electron requires schemes to be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: pageImageScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const notFound = () => new Response(null, { status: 404 })

const imageResponse = (body: ConstructorParameters<typeof Response>[0], type: string) =>
  new Response(body, { headers: { 'content-type': type, 'access-control-allow-origin': '*' } })

const thumbnails = thumbnailCache(64 * 1024 * 1024)

// Windows has no AVIF thumbnails and takes a third of a second to say so.
const thumbnailOf = (file: string, size: number, version: number) =>
  thumbnails.get(`${file}|${size}|${version}`, () =>
    file.toLowerCase().endsWith('.avif')
      ? Promise.resolve(undefined)
      : nativeImage.createThumbnailFromPath(file, { width: size, height: size }).then(
          (image) => (image.isEmpty() ? undefined : new Uint8Array(image.toJPEG(82))),
          () => undefined,
        ),
  )

const servePageImages = () =>
  protocol.handle(pageImageScheme, (request) => {
    const wanted = pageImageWanted(request.url)

    if (wanted === undefined) {
      return notFound()
    }

    if (wanted.as === 'icon') {
      return app.getFileIcon(wanted.file, { size: 'normal' }).then(
        (icon) => (icon.isEmpty() ? notFound() : imageResponse(icon.toPNG(), 'image/png')),
        () => notFound(),
      )
    }

    if (wanted.as === 'thumbnail') {
      const { size, version } = thumbnailWanted(request.url)

      return thumbnailOf(wanted.file, size, version).then((jpeg) =>
        jpeg === undefined ? notFound() : imageResponse(jpeg, 'image/jpeg'),
      )
    }

    return net
      .fetch(pathToFileURL(wanted.file).toString())
      .then((response) =>
        response.ok
          ? imageResponse(response.body, response.headers.get('content-type') ?? '')
          : notFound(),
      )
  })

const start = Effect.gen(function* () {
  Menu.setApplicationMenu(null)
  yield* Effect.promise(() => app.whenReady())

  servePageImages()

  const credentialKey = yield* loadCredentialKey(app.getPath('userData'), safeStorageProtector)

  const core = coreSupervisor({
    start: (run) => startCore(credentialKey, run),
    budget: coreCrashBudget,
    onCrash: (run, exitCode) => {
      const output = coreOutput.take()

      log.error('Core exited unexpectedly', { run, exitCode }, output === '' ? undefined : output)
    },
    onRestart: (run) => {
      log.warn('Core restarted after a crash', { run })
      reconnectWindows()
    },
    onStopped: (stopped) => {
      log.error('Core stopped after repeated crashes', {
        crashes: stopped.crashes,
        withinMs: stopped.withinMillis,
      })

      showCoreStopped(mainWindow, stopped)
    },
  })

  supervisor = core

  app.on('will-quit', () => {
    log.info('Wenbu quit')
    core.kill()
  })

  startOverlay(core)
  startSubtitles(core)
  startLiveControls(core)
  startSignIns(core)
  startNovelPages(core)
  mainWindow = createWindow(core)
  yield* Effect.forkDetach(watchClipboard(core))
  yield* Effect.forkDetach(startUpdates(core))
})

const failStartup = (cause: Cause.Cause<unknown>) =>
  Effect.sync(() => {
    log.fatal('Wenbu could not start', {}, Cause.pretty(cause))
    dialog.showErrorBox('Wenbu could not start', Cause.pretty(cause))
    app.quit()
  })

void Effect.runPromise(
  start.pipe(Effect.catchCause(failStartup), Effect.provide(NodeServices.layer)),
)
