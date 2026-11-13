import {
  Cause,
  Config,
  Context,
  Effect,
  FileSystem,
  Formatter,
  Layer,
  Logger,
  MutableRef,
  Option,
  Path,
  Predicate,
  PubSub,
  Queue,
  References,
  type Scope,
  Stream,
  Tracer,
} from 'effect'
import type { LogEntry, LogLevel, ProblemCount } from '#contract/Diagnostics'
import { formatLogEntry, redactHome } from '#contract/LogText'

export interface LogBookOptions {
  readonly folder: string
  readonly run: number
  readonly home: string
  readonly maxBytes?: number
}

const backtraceSize = 200

const defaultMaxBytes = 10 * 1024 * 1024

const privateFields = new Set([
  'url',
  'prompt',
  'text',
  'body',
  'title',
  'cookie',
  'cookies',
  'token',
  'secret',
  'password',
  'apikey',
  'authorization',
])

const spanFeatures: ReadonlyArray<readonly [feature: string, prefixes: ReadonlyArray<string>]> = [
  ['library', ['Library', 'Games', 'GameFolder', 'GameLauncher', 'CgPack', 'GameData']],
  ['translation', ['GameTranslation']],
  [
    'overlay',
    ['TranslationOverlay', 'OverlayPreferences', 'OverlayStore', 'LunaHook', 'LunaHookHost'],
  ],
  ['models', ['LlmStore', 'LlmClient', 'ConnectionVerifier', 'Credentials', 'ModelCatalog']],
  ['detections', ['Detections', 'GoogleLens', 'ScreenAiOcr']],
  ['livecontrols', ['LiveControls', 'GameConnector', 'NwjsRuntime', 'RgssBridge', 'RgssRuntime']],
  ['manga', ['Manga', 'MangaPages', 'MangaRuntime', 'MangaImageTranslator']],
  ['downloads', ['Downloads', 'SignInWindows']],
  ['galleries', ['Galleries']],
  ['novels', ['Novels', 'NovelStore', 'PageFetcher']],
  ['subtitles', ['LiveSubtitles', 'SubtitlePreferences', 'SpeechHelper']],
  ['plugins', ['Plugins', 'ScreenAi', 'SpeechModel']],
  ['appearance', ['Appearance']],
  ['dashboard', ['Dashboard', 'UsageLog']],
]

const featureOfSpan = new Map(
  spanFeatures.flatMap(([feature, prefixes]) =>
    prefixes.map((prefix) => [prefix, feature] as const),
  ),
)

const levels: Record<string, LogLevel> = {
  Fatal: 'fatal',
  Error: 'error',
  Warn: 'warn',
  Info: 'info',
  Debug: 'debug',
  Trace: 'debug',
}

const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 }

export const isAtLeast = (level: LogLevel, minimum: LogLevel) => rank[level] >= rank[minimum]

const spanNames = (span: Tracer.AnySpan | undefined): Array<string> => {
  if (span === undefined || Predicate.isTagged(span, 'ExternalSpan')) {
    return []
  }

  return [...spanNames(Option.getOrUndefined(span.parent)), span.name]
}

const featureOf = (names: ReadonlyArray<string>) => {
  for (const name of names) {
    const feature = featureOfSpan.get(name.split('.')[0] ?? '')

    if (feature !== undefined) {
      return feature
    }
  }

  return 'core'
}

// oxlint-disable-next-line wenbu/no-unknown-parameters -- log calls and annotations carry any value.
const formatField = (value: unknown) =>
  Predicate.isString(value) ? value : Formatter.format(value)

export class LogBook extends Context.Service<
  LogBook,
  {
    readonly folder: string
    readonly launchesFolder: string
    readonly record: (entry: LogEntry) => void
    readonly forward: (entry: LogEntry) => void
    readonly live: Effect.Effect<Stream.Stream<LogEntry>, never, Scope.Scope>
    readonly problems: Effect.Effect<Stream.Stream<ProblemCount>, never, Scope.Scope>
    readonly verbose: Effect.Effect<boolean>
    readonly setVerbose: (verbose: boolean) => Effect.Effect<void>
    readonly setLowSpace: (lowSpace: boolean) => Effect.Effect<void>
    readonly redact: (entry: LogEntry) => LogEntry
    readonly toEntry: (options: Logger.Options<unknown>) => LogEntry
  }
>()('wenbu/core/diagnostics/LogBook') {
  static readonly make = Effect.fnUntraced(function* (options: LogBookOptions) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const maxBytes = options.maxBytes ?? defaultMaxBytes

    yield* fs.makeDirectory(options.folder, { recursive: true })

    const filePath = path.join(options.folder, 'core.log')
    const file = yield* fs.open(filePath, { flag: 'a' })
    let bytes = Number(yield* file.stat.pipe(Effect.map((info) => info.size)))
    let truncated = false
    const encoder = new TextEncoder()
    const lines = yield* Queue.unbounded<string>()
    const entries = yield* PubSub.unbounded<LogEntry>()
    const verbose = MutableRef.make(false)
    const lowSpace = MutableRef.make(false)
    const backtrace: Array<LogEntry> = []
    const problemCount = MutableRef.make<ProblemCount>({ warnings: 0, errors: 0 })
    const problemChanges = yield* PubSub.sliding<ProblemCount>(1)

    const count = (entry: LogEntry) => {
      if (!isAtLeast(entry.level, 'warn')) {
        return
      }

      const before = MutableRef.get(problemCount)

      const next: ProblemCount = isAtLeast(entry.level, 'error')
        ? {
            warnings: before.warnings,
            errors: before.errors + 1,
            lastError: { at: entry.at, feature: entry.feature, message: entry.message },
          }
        : { ...before, warnings: before.warnings + 1 }

      MutableRef.set(problemCount, next)
      PubSub.publishUnsafe(problemChanges, next)
    }

    const writeLines = (batch: ReadonlyArray<string>) =>
      file.writeAll(encoder.encode(batch.join(''))).pipe(Effect.ignore)

    yield* Effect.forever(Effect.flatMap(Queue.takeAll(lines), writeLines)).pipe(Effect.forkScoped)

    yield* Effect.addFinalizer(() => Effect.flatMap(Queue.clear(lines), writeLines))

    const write = (entry: LogEntry) => {
      if ((bytes >= maxBytes || MutableRef.get(lowSpace)) && !isAtLeast(entry.level, 'warn')) {
        return
      }

      const line = `${formatLogEntry(entry)}\n`

      bytes += encoder.encode(line).byteLength
      Queue.offerUnsafe(lines, line)
      PubSub.publishUnsafe(entries, entry)

      if (bytes >= maxBytes && !truncated) {
        truncated = true

        write({
          at: entry.at,
          level: 'warn',
          process: 'core',
          run: options.run,
          feature: 'core',
          message: 'Log file is full; keeping only warnings and errors',
          fields: { maxBytes: String(maxBytes) },
        })
      }
    }

    const record = (entry: LogEntry) => {
      if (entry.level === 'debug' && !MutableRef.get(verbose)) {
        backtrace.push(entry)
        backtrace.splice(0, Math.max(0, backtrace.length - backtraceSize))

        return
      }

      if (isAtLeast(entry.level, 'error')) {
        for (const earlier of backtrace.splice(0)) {
          write(earlier)
        }
      }

      count(entry)
      write(entry)
    }

    const redact = (text: string) => redactHome(options.home, text)

    const toEntry = ({
      message,
      logLevel,
      cause,
      fiber,
      date,
    }: Logger.Options<unknown>): LogEntry => {
      const parts = Array.isArray(message) ? message : [message]
      const [first, ...rest] = parts
      const annotations = fiber.getRef(References.CurrentLogAnnotations)
      const fields: Record<string, string> = {}
      let feature: string | undefined

      let output: string | undefined

      for (const [key, value] of Object.entries(annotations)) {
        if (value === undefined) {
          continue
        }

        if (key === 'feature' && Predicate.isString(value)) {
          feature = value

          continue
        }

        if (key === 'output' && Predicate.isString(value)) {
          output = value === '' ? undefined : redact(value)

          continue
        }

        fields[key] = privateFields.has(key.toLowerCase())
          ? '<redacted>'
          : redact(formatField(value))
      }

      if (rest.length > 0) {
        fields['detail'] = redact(rest.map((part) => formatField(part)).join(' '))
      }

      const span = Option.getOrUndefined(Context.getOption(fiber.context, Tracer.ParentSpan))

      const entry: LogEntry = {
        at: date.getTime(),
        level: levels[logLevel] ?? 'info',
        process: 'core',
        run: options.run,
        feature: feature ?? featureOf(spanNames(span)),
        message: redact(formatField(first)),
        fields,
      }

      const causes = [output, cause.reasons.length > 0 ? redact(Cause.pretty(cause)) : undefined]
      const text = causes.filter((part) => part !== undefined).join('\n')

      return text === '' ? entry : { ...entry, cause: text }
    }

    return LogBook.of({
      folder: options.folder,
      launchesFolder: path.dirname(options.folder),
      record,
      forward: (entry) => {
        count(entry)
        PubSub.publishUnsafe(entries, entry)
      },
      live: Effect.map(PubSub.subscribe(entries), (subscription) =>
        Stream.fromSubscription(subscription),
      ),
      problems: Effect.map(PubSub.subscribe(problemChanges), (subscription) =>
        Stream.concat(
          Stream.sync(() => MutableRef.get(problemCount)),
          Stream.fromSubscription(subscription),
        ),
      ),
      verbose: Effect.sync(() => MutableRef.get(verbose)),
      setVerbose: (value) => Effect.sync(() => MutableRef.set(verbose, value)),
      setLowSpace: (value) => Effect.sync(() => MutableRef.set(lowSpace, value)),
      redact: (entry) => {
        const fields = Object.fromEntries(
          Object.entries(entry.fields).map(([key, value]) => [key, redact(value)]),
        )

        const redacted = { ...entry, message: redact(entry.message), fields }

        return entry.cause === undefined ? redacted : { ...redacted, cause: redact(entry.cause) }
      },
      toEntry,
    })
  })

  static readonly layerWith = (options: LogBookOptions) =>
    Layer.effect(LogBook, LogBook.make(options))

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const folder = yield* Config.String('WENBU_LOG_DIR')
      const run = yield* Config.Int('WENBU_CORE_RUN').pipe(Config.withDefault(1))
      const home = yield* Config.String('USERPROFILE').pipe(Config.withDefault(''))

      return LogBook.layerWith({ folder, run, home })
    }),
  )

  static readonly logger = Layer.unwrap(
    Effect.gen(function* () {
      const book = yield* LogBook
      const logger = Logger.make((options) => book.record(book.toEntry(options)))

      return Layer.mergeAll(
        Logger.layer([logger]),
        Layer.succeed(References.MinimumLogLevel, 'Debug'),
      )
    }),
  )
}
