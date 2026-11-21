import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Clock, Effect } from 'effect'
import type { Fields } from './mainLog'

interface Log {
  readonly info: (message: string, fields?: Fields) => void
  readonly warn: (message: string, fields?: Fields) => void
}

interface CopyWatcherOptions {
  readonly helperPath: string
  readonly log: Log
  readonly onDoubleCopy: () => void
}

const restartAfterMillis = 2000

const restartsPerMinute = 5

const now = () => Effect.runSync(Clock.currentTimeMillis)

export const copyWatcher = (options: CopyWatcherOptions) => {
  let helper: ChildProcess | undefined
  let wanted = false
  let restarts: ReadonlyArray<number> = []
  let reportedMissing = false
  const released = new WeakSet<ChildProcess>()

  const restartLater = (code: number) => {
    const at = now()

    restarts = [...restarts.filter((time) => at - time < 60_000), at]

    if (restarts.length > restartsPerMinute) {
      options.log.warn('Quick Translate helper keeps stopping; Ctrl+C+C is off until restart', {
        code,
      })

      return
    }

    options.log.warn('Quick Translate helper stopped; starting it again', { code })

    Effect.runFork(
      Effect.andThen(
        Effect.sleep(restartAfterMillis),
        Effect.sync(() => {
          if (wanted && helper === undefined) {
            start()
          }
        }),
      ),
    )
  }

  const start = () => {
    if (!existsSync(options.helperPath)) {
      if (!reportedMissing) {
        reportedMissing = true
        options.log.warn('Quick Translate helper is missing', { path: options.helperPath })
      }

      return
    }

    const started = spawn(options.helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let ended = false

    const end = (code: number) => {
      if (ended) {
        return
      }

      ended = true

      if (helper === started) {
        helper = undefined
      }

      if (wanted && !released.has(started)) {
        restartLater(code)
      }
    }

    helper = started

    createInterface({ input: started.stdout }).on('line', (line) => {
      if (line.trim() === 'copy') {
        options.onDoubleCopy()
      }
    })

    started.stderr.on('data', (chunk: Buffer) =>
      options.log.warn('Quick Translate helper wrote an error', {
        error: chunk.toString().trim().slice(0, 300),
      }),
    )

    started.on('error', (error) => {
      options.log.warn('Quick Translate helper could not start', { error: error.message })
      end(-1)
    })

    started.on('exit', (code) => end(code ?? -1))
  }

  const stop = () => {
    const running = helper

    helper = undefined

    if (running !== undefined) {
      released.add(running)
      running.stdin?.end()
    }
  }

  const setEnabled = (on: boolean) => {
    if (on === wanted) {
      return
    }

    wanted = on

    if (on) {
      restarts = []
      start()
      options.log.info('Quick Translate is listening for Ctrl+C+C')

      return
    }

    stop()
  }

  return { setEnabled, stop }
}
