import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { bridgeChannels, type WenbuBridge } from '#contract/Bridge'

let pendingPort: MessagePort | undefined
let portRequested = false

const deliverCorePort = () => {
  if (pendingPort === undefined || !portRequested) {
    return
  }

  window.postMessage(bridgeChannels.corePort, '*', [pendingPort])
  pendingPort = undefined
  portRequested = false
}

ipcRenderer.on(bridgeChannels.corePort, (event) => {
  pendingPort = event.ports[0]
  deliverCorePort()
})

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== bridgeChannels.requestCorePort) {
    return
  }

  portRequested = true
  deliverCorePort()
})

type CoreStoppedListener = Parameters<WenbuBridge['onCoreStopped']>[0]

let coreStopped: Parameters<CoreStoppedListener>[0] | undefined
const coreStoppedListeners = new Set<CoreStoppedListener>()

ipcRenderer.on(bridgeChannels.coreStopped, (_event, stopped) => {
  coreStopped = stopped

  for (const listener of coreStoppedListeners) {
    listener(stopped)
  }
})

const onCoreStopped = (listener: CoreStoppedListener) => {
  coreStoppedListeners.add(listener)

  if (coreStopped !== undefined) {
    listener(coreStopped)
  }

  return () => {
    coreStoppedListeners.delete(listener)
  }
}

/** Main may send before the page subscribes, so the latest event waits for the first listener. */
const latestEvent = <A>(channel: string) => {
  const listeners = new Set<(value: A) => void>()
  let waiting: { readonly value: A } | undefined

  ipcRenderer.on(channel, (_event, value: A) => {
    if (listeners.size === 0) {
      waiting = { value }

      return
    }

    for (const listener of listeners) {
      listener(value)
    }
  })

  return (listener: (value: A) => void) => {
    listeners.add(listener)

    if (waiting !== undefined) {
      listener(waiting.value)
      waiting = undefined
    }

    return () => {
      listeners.delete(listener)
    }
  }
}

type BridgeListener<Key extends keyof WenbuBridge> = WenbuBridge[Key] extends (
  listener: (value: infer A) => void,
) => () => void
  ? A
  : never

const onNavigate = latestEvent<BridgeListener<'onNavigate'>>(bridgeChannels.navigate)

const onCloseAsked = latestEvent<void>(bridgeChannels.closeAsked)

const onQuitAsked = latestEvent<void>(bridgeChannels.quitAsked)

const onPanelShown = latestEvent<BridgeListener<'onPanelShown'>>(bridgeChannels.panelShown)

const onQuickTranslate = latestEvent<BridgeListener<'onQuickTranslate'>>(
  bridgeChannels.quickTranslate,
)

const bridge: WenbuBridge = {
  window: (action) => ipcRenderer.send(bridgeChannels.window, action),
  chooseFolder: () => ipcRenderer.invoke(bridgeChannels.chooseFolder),
  chooseArchive: () => ipcRenderer.invoke(bridgeChannels.chooseArchive),
  chooseSavePath: (suggested, extension) =>
    ipcRenderer.invoke(bridgeChannels.chooseSavePath, suggested, extension),
  pathForFile: (file) => webUtils.getPathForFile(file),
  revealPath: (path) => ipcRenderer.send(bridgeChannels.revealPath, path),
  openExternal: (url) => ipcRenderer.send(bridgeChannels.openExternal, url),
  resizeOverlay: (width, height) => ipcRenderer.send(bridgeChannels.resizeOverlay, width, height),
  captureOverlayMouse: (capture) => ipcRenderer.send(bridgeChannels.captureOverlayMouse, capture),
  moveOverlay: (x, y) => ipcRenderer.send(bridgeChannels.moveOverlay, x, y),
  platform: process.platform,
  onCoreStopped,
  relaunch: () => ipcRenderer.send(bridgeChannels.relaunch),
  exportDiagnostics: () => ipcRenderer.invoke(bridgeChannels.exportDiagnostics),
  openLogsFolder: () => ipcRenderer.send(bridgeChannels.openLogsFolder),
  openApp: (target) => ipcRenderer.send(bridgeChannels.openApp, target),
  onNavigate,
  onCloseAsked,
  closeWith: (action) => ipcRenderer.send(bridgeChannels.closeWith, action),
  quit: (confirmed) => ipcRenderer.send(bridgeChannels.quit, confirmed),
  onQuitAsked,
  onPanelShown,
  resizePanel: (height) => ipcRenderer.send(bridgeChannels.resizePanel, height),
  panelPainted: () => ipcRenderer.send(bridgeChannels.panelPainted),
  hidePanel: () => ipcRenderer.send(bridgeChannels.hidePanel),
  onQuickTranslate,
  resizeQuickTranslate: (height) => ipcRenderer.send(bridgeChannels.resizeQuickTranslate, height),
  quickTranslatePainted: () => ipcRenderer.send(bridgeChannels.quickTranslatePainted),
  hideQuickTranslate: () => ipcRenderer.send(bridgeChannels.hideQuickTranslate),
  pinQuickTranslate: (pinned) => ipcRenderer.send(bridgeChannels.pinQuickTranslate, pinned),
}

contextBridge.exposeInMainWorld('wenbu', bridge)
