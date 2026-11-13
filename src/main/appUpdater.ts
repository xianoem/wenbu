import { app } from 'electron'
import { Effect, Schedule } from 'effect'
import electronUpdater from 'electron-updater'
import { UpdateStatus } from '#contract/Updates'
import type { MainLog } from './mainLog'
import { afterUpdaterEvent, type UpdaterEvent } from './updateProgress'

interface AppUpdaterOptions {
  readonly log: MainLog
  readonly onStatus: (status: UpdateStatus) => void
}

export const appUpdater = (options: AppUpdaterOptions) => {
  let status = UpdateStatus.make({ state: 'idle' })

  const report = (event: UpdaterEvent) => {
    const next = afterUpdaterEvent(status, event)

    if (next.state === status.state && next.version === status.version) {
      return
    }

    status = next
    options.onStatus(next)
  }

  const current = () => status

  if (!app.isPackaged) {
    return { status: current, install: () => {}, run: Effect.void }
  }

  const { autoUpdater } = electronUpdater

  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => report({ type: 'checking' }))
  autoUpdater.on('update-not-available', () => report({ type: 'not-available' }))

  autoUpdater.on('update-available', (info) => {
    options.log.info('Downloading an update', { version: info.version })
    report({ type: 'available', version: info.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    options.log.info('Update ready to install', { version: info.version })
    report({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    options.log.warn('Update check failed', {}, error.message)
    report({ type: 'failed' })
  })

  // A failed check already arrives through the error event.
  const check = Effect.ignore(Effect.tryPromise(() => autoUpdater.checkForUpdates()))

  return {
    status: current,
    install: () => {
      if (status.state === 'ready') {
        options.log.info('Restarting to install the update', { version: status.version })
        autoUpdater.quitAndInstall(true, true)
      }
    },
    run: Effect.repeat(check, Schedule.spaced('4 hours')),
  }
}
