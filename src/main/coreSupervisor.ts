import type { UtilityProcess } from 'electron'
import { Clock, Effect } from 'effect'
import type { CoreStopped } from '#contract/CoreStopped'
import { type CrashBudget, recordCrash } from './crashBudget'

interface CoreSupervisorOptions {
  readonly start: (run: number) => UtilityProcess
  readonly budget: CrashBudget
  readonly onCrash: (run: number, exitCode: number) => void
  readonly onRestart: (run: number) => void
  readonly onStopped: (stopped: CoreStopped) => void
}

type CoreMessage = Parameters<UtilityProcess['postMessage']>[0]

type MessageListener = (message: CoreMessage) => void

export const coreSupervisor = (options: CoreSupervisorOptions) => {
  const listeners: Array<MessageListener> = []
  let core: UtilityProcess | undefined
  let crashes: ReadonlyArray<number> = []
  let stopped: CoreStopped | undefined
  let quitting = false
  let run = 0

  const crashed = (exited: UtilityProcess, exitCode: number) => {
    if (quitting || exited !== core) {
      return
    }

    options.onCrash(run, exitCode)

    const { recent, exhausted } = recordCrash(
      options.budget,
      crashes,
      Effect.runSync(Clock.currentTimeMillis),
    )

    crashes = recent

    if (exhausted) {
      core = undefined

      stopped = {
        crashes: recent.length,
        withinMillis: (recent.at(-1) ?? 0) - (recent[0] ?? 0),
        exitCode,
      }

      options.onStopped(stopped)

      return
    }

    launch().once('spawn', () => options.onRestart(run))
  }

  const launch = () => {
    run += 1

    const started = options.start(run)

    core = started

    for (const listener of listeners) {
      started.on('message', listener)
    }

    started.once('exit', (exitCode) => crashed(started, exitCode))

    return started
  }

  launch()

  return {
    on: (_event: 'message', listener: MessageListener) => {
      listeners.push(listener)
      core?.on('message', listener)
    },
    postMessage: (message: CoreMessage, transfer: Array<Electron.MessagePortMain>) => {
      core?.postMessage(message, transfer)
    },
    stopped: () => stopped,
    kill: () => {
      quitting = true
      core?.kill()
    },
  }
}

export type CoreSupervisor = ReturnType<typeof coreSupervisor>
