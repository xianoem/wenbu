import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Clock, DateTime, Effect } from 'effect'
import type { LogEntry, LogLevel } from '#contract/Diagnostics'
import { formatLogEntry, redactHome } from '#contract/LogText'

export const keptLaunches = 10

const launchName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/

export const launchId = (millis: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(millis)).slice(0, 19).replaceAll(':', '-')

export const listLaunches = (root: string) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && launchName.test(entry.name))
    .map((entry) => entry.name)
    .toSorted()
    .toReversed()

export const pruneLaunches = (root: string, keep: number) => {
  for (const name of listLaunches(root).slice(keep)) {
    rmSync(join(root, name), { recursive: true, force: true })
  }
}

export interface MainLogOptions {
  readonly folder: string
  readonly home: string
  readonly forward: (entry: LogEntry) => void
}

export type Fields = Readonly<Record<string, string | number | boolean | undefined>>

const toFields = (fields: Fields, home: string) => {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key] = redactHome(home, String(value))
    }
  }

  return result
}

// Synchronous, so lines about core crashing reach the disk even if main dies right after.
export const mainLog = (options: MainLogOptions) => {
  mkdirSync(options.folder, { recursive: true })

  const file = join(options.folder, 'main.log')

  const write = (level: LogLevel, message: string, fields: Fields = {}, cause?: string) => {
    const base: LogEntry = {
      at: Effect.runSync(Clock.currentTimeMillis),
      level,
      process: 'main',
      run: 0,
      feature: 'app',
      message,
      fields: toFields(fields, options.home),
    }

    const entry = cause === undefined ? base : { ...base, cause: redactHome(options.home, cause) }

    appendFileSync(file, `${formatLogEntry(entry)}\n`)
    options.forward(entry)
  }

  return {
    folder: options.folder,
    info: (message: string, fields?: Fields) => write('info', message, fields),
    warn: (message: string, fields?: Fields, cause?: string) =>
      write('warn', message, fields, cause),
    error: (message: string, fields?: Fields, cause?: string) =>
      write('error', message, fields, cause),
    fatal: (message: string, fields?: Fields, cause?: string) =>
      write('fatal', message, fields, cause),
  }
}

export type MainLog = ReturnType<typeof mainLog>

export const outputTail = (maxLines: number) => {
  let lines: Array<string> = []
  let partial = ''

  return {
    push: (chunk: string) => {
      const parts = (partial + chunk).split(/\r?\n/)

      partial = parts.pop() ?? ''
      lines = [...lines, ...parts].slice(-maxLines)
    },
    take: () => {
      const all = [...lines, partial].filter((line) => line !== '')

      lines = []
      partial = ''

      return all.join('\n')
    },
  }
}
