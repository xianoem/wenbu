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
}

contextBridge.exposeInMainWorld('wenbu', bridge)
