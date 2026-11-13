import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import { DateTime, Effect, Option, Schema, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import type { LogEntry, LogLevel } from '#contract/Diagnostics'
import { Core } from '#lib/rpc'

const entryLimit = 5000

export const launchesAtom = Core.query('listLaunches', undefined)

export const logAtom = Atom.family((launch: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('watchLog', launch === '' ? {} : { launch })
      }),
    ).pipe(
      Stream.scan(
        (): ReadonlyArray<LogEntry> => [],
        (entries, batch) =>
          batch.reset ? batch.entries : [...entries, ...batch.entries].slice(-entryLimit),
      ),
    ),
  ),
)

export const verboseLoggingKeys = ['verbose-logging']

export const verboseLoggingAtom = Core.query('getVerboseLogging', undefined, {
  reactivityKeys: verboseLoggingKeys,
})

export const setVerboseLoggingAtom = Core.mutation('setVerboseLogging')

export const reportRendererErrorAtom = Core.mutation('reportRendererError')

export const LevelFilter = Schema.Literals(['all', 'error', 'warn', 'info', 'debug'])

export type LevelFilter = typeof LevelFilter.Type

const sessionStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerSessionStorage)

export const levelFilterAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'logs-level',
  schema: LevelFilter,
  defaultValue: (): LevelFilter => 'all',
})

export const featureFilterAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'logs-feature',
  schema: Schema.String,
  defaultValue: () => '',
})

export const launchFilterAtom = Atom.kvs({
  runtime: sessionStorageRuntime,
  key: 'logs-launch',
  schema: Schema.String,
  defaultValue: () => '',
})

const localStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const errorsSeenAtAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'logs-errors-seen-at',
  schema: Schema.Number,
  defaultValue: () => 0,
})

export const isProblem = (level: LogLevel) =>
  level === 'error' || level === 'fatal' || level === 'warn'

export const isError = (level: LogLevel) => level === 'error' || level === 'fatal'

export const matchesLevel = (level: LogLevel, filter: LevelFilter) => {
  if (filter === 'all') {
    return true
  }

  return filter === 'error' ? isError(level) : level === filter
}

const featureLabels: Record<string, string> = {
  app: 'App',
  core: 'Core',
  library: 'Library',
  details: 'Details',
  translation: 'Game translation',
  overlay: 'Overlay',
  models: 'Models',
  detections: 'Detections',
  livecontrols: 'Live controls',
  manga: 'Manga',
  downloads: 'Downloads',
  galleries: 'Galleries',
  novels: 'Novels',
  subtitles: 'Live Subtitles',
  plugins: 'Plugins',
  appearance: 'Appearance',
  diagnostics: 'Logs',
  renderer: 'Windows',
}

export const featureLabel = (feature: string) => featureLabels[feature] ?? feature

export const levelLabels: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
}

export const processLabel = (entry: LogEntry) =>
  entry.run > 0 ? `${entry.process}#${entry.run}` : entry.process

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
})

export const formatLogTime = (at: number) =>
  timeFormat.format(DateTime.toDate(DateTime.makeUnsafe(at)))

const launchFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const formatLaunch = (id: string) => {
  const [day = '', time = ''] = id.split('T')

  return Option.match(DateTime.make(`${day}T${time.replaceAll('-', ':')}Z`), {
    onNone: () => id,
    onSome: (started) => launchFormat.format(DateTime.toDate(started)),
  })
}

export const fieldsText = (entry: LogEntry) =>
  Object.entries(entry.fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

export const matchesSearch = (entry: LogEntry, search: string) =>
  search === '' ||
  [entry.message, entry.feature, featureLabel(entry.feature), fieldsText(entry), entry.cause ?? '']
    .join('\n')
    .toLowerCase()
    .includes(search)
