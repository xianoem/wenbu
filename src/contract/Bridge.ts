import type { CoreStopped } from './CoreStopped'
import type { WindowAction } from './WindowAction'

export interface WenbuBridge {
  readonly window: (action: WindowAction) => void
  readonly chooseFolder: () => Promise<string | undefined>
  readonly chooseArchive: () => Promise<string | undefined>
  readonly chooseSavePath: (suggested: string, extension: string) => Promise<string | undefined>
  readonly pathForFile: (file: File) => string
  readonly revealPath: (path: string) => void
  readonly openExternal: (url: string) => void
  readonly resizeOverlay: (width: number, height: number) => void
  readonly captureOverlayMouse: (capture: boolean) => void
  readonly moveOverlay: (x: number, y: number) => void
  readonly platform: string
  readonly onCoreStopped: (listener: (stopped: CoreStopped) => void) => () => void
  readonly relaunch: () => void
  /** Main writes it, not core: it must work when core is gone. */
  readonly exportDiagnostics: () => Promise<string | undefined>
  readonly openLogsFolder: () => void
}

export const bridgeChannels = {
  corePort: 'wenbu:core-port',
  requestCorePort: 'wenbu:request-core-port',
  window: 'wenbu:window',
  chooseFolder: 'wenbu:choose-folder',
  chooseArchive: 'wenbu:choose-archive',
  chooseSavePath: 'wenbu:choose-save-path',
  revealPath: 'wenbu:reveal-path',
  openExternal: 'wenbu:open-external',
  resizeOverlay: 'wenbu:resize-overlay',
  captureOverlayMouse: 'wenbu:capture-overlay-mouse',
  moveOverlay: 'wenbu:move-overlay',
  coreStopped: 'wenbu:core-stopped',
  relaunch: 'wenbu:relaunch',
  exportDiagnostics: 'wenbu:export-diagnostics',
  openLogsFolder: 'wenbu:open-logs-folder',
} as const
