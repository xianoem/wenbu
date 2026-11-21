import type { AppTarget, CloseAction } from './Background'
import type { CoreStopped } from './CoreStopped'
import type { WindowAction } from './WindowAction'

export interface WenbuBridge {
  readonly window: (action: WindowAction) => void
  readonly chooseFolder: () => Promise<string | undefined>
  readonly chooseArchive: () => Promise<string | undefined>
  readonly chooseProgram: (folder: string) => Promise<string | undefined>
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
  readonly openApp: (target?: AppTarget) => void
  readonly onNavigate: (listener: (target: AppTarget) => void) => () => void
  readonly onCloseAsked: (listener: () => void) => () => void
  readonly closeWith: (action: CloseAction) => void
  /** Main quits at once when nothing runs, and otherwise asks the window that asked. */
  readonly quit: (confirmed: boolean) => void
  readonly onQuitAsked: (listener: () => void) => () => void
  readonly onPanelShown: (listener: (shown: PanelShown) => void) => () => void
  readonly resizePanel: (height: number) => void
  readonly panelPainted: () => void
  readonly hidePanel: () => void
  readonly onQuickTranslate: (listener: (shown: QuickTranslateShown) => void) => () => void
  readonly resizeQuickTranslate: (height: number) => void
  readonly quickTranslatePainted: () => void
  readonly hideQuickTranslate: () => void
  readonly pinQuickTranslate: (pinned: boolean) => void
}

export interface QuickTranslateShown {
  readonly id: number
  readonly text: string
}

export interface PanelShown {
  readonly link?: string
}

export const bridgeChannels = {
  corePort: 'wenbu:core-port',
  requestCorePort: 'wenbu:request-core-port',
  window: 'wenbu:window',
  chooseFolder: 'wenbu:choose-folder',
  chooseArchive: 'wenbu:choose-archive',
  chooseProgram: 'wenbu:choose-program',
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
  openApp: 'wenbu:open-app',
  navigate: 'wenbu:navigate',
  closeAsked: 'wenbu:close-asked',
  closeWith: 'wenbu:close-with',
  quit: 'wenbu:quit',
  quitAsked: 'wenbu:quit-asked',
  panelShown: 'wenbu:panel-shown',
  resizePanel: 'wenbu:resize-panel',
  panelPainted: 'wenbu:panel-painted',
  hidePanel: 'wenbu:hide-panel',
  quickTranslate: 'wenbu:quick-translate',
  resizeQuickTranslate: 'wenbu:resize-quick-translate',
  quickTranslatePainted: 'wenbu:quick-translate-painted',
  hideQuickTranslate: 'wenbu:hide-quick-translate',
  pinQuickTranslate: 'wenbu:pin-quick-translate',
} as const
