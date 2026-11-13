import { Clock, Effect, FileSystem, Path, Stream } from 'effect'
import { DiagnosticsRpc, type LogEntry } from '#contract/Diagnostics'
import { parseLogText } from '#contract/LogText'
import { LogBook } from './LogBook'

const snapshotSize = 5000

const launchName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/

const logFiles = ['main.log', 'core.log']

const keyOf = (entry: LogEntry) => `${entry.at}|${entry.process}|${entry.run}|${entry.message}`

export const DiagnosticsRpcLive = DiagnosticsRpc.toLayer(
  Effect.gen(function* () {
    const book = yield* LogBook
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const current = path.basename(book.folder)

    const launches = Effect.fnUntraced(function* () {
      const names = yield* fs
        .readDirectory(book.launchesFolder)
        .pipe(Effect.orElseSucceed(() => []))

      return names
        .filter((name) => launchName.test(name))
        .toSorted()
        .toReversed()
        .map((id) => ({ id, current: id === current }))
    })

    const readLaunch = Effect.fnUntraced(function* (id: string) {
      const texts = yield* Effect.forEach(logFiles, (file) =>
        fs
          .readFileString(path.join(book.launchesFolder, id, file))
          .pipe(Effect.orElseSucceed(() => '')),
      )

      return texts
        .flatMap((text) => parseLogText(text))
        .toSorted((left, right) => left.at - right.at)
        .slice(-snapshotSize)
    })

    const watchCurrent = Effect.gen(function* () {
      const live = yield* book.live
      const snapshot = yield* readLaunch(current)
      const seen = new Set(snapshot.map((entry) => keyOf(entry)))

      return Stream.concat(
        Stream.succeed({ reset: true, entries: snapshot }),
        live.pipe(
          Stream.filter((entry) => !seen.has(keyOf(entry))),
          Stream.map((entry) => ({ reset: false, entries: [entry] })),
        ),
      )
    })

    return DiagnosticsRpc.of({
      listLaunches: Effect.fn('Diagnostics.listLaunches')(function* () {
        return yield* launches()
      }),
      watchLog: ({ launch }) => {
        if (launch === undefined || launch === current) {
          return Stream.unwrap(watchCurrent)
        }

        return Stream.unwrap(
          Effect.gen(function* () {
            const known = (yield* launches()).some((candidate) => candidate.id === launch)
            const entries = known ? yield* readLaunch(launch) : []

            return Stream.succeed({ reset: true, entries })
          }),
        )
      },
      watchProblemCount: () => Stream.unwrap(book.problems),
      getVerboseLogging: Effect.fn('Diagnostics.getVerboseLogging')(function* () {
        return yield* book.verbose
      }),
      setVerboseLogging: Effect.fn('Diagnostics.setVerboseLogging')(function* ({ verbose }) {
        yield* book.setVerbose(verbose)
        yield* Effect.logInfo('Verbose logging changed').pipe(Effect.annotateLogs({ verbose }))
      }),
      reportRendererError: Effect.fn('Diagnostics.reportRendererError')(function* (error) {
        const at = yield* Clock.currentTimeMillis

        const entry: LogEntry = {
          at,
          level: 'error',
          process: 'renderer',
          run: 0,
          feature: 'renderer',
          message: error.message,
          fields: { window: error.window },
        }

        book.record(
          book.redact(error.stack === undefined ? entry : { ...entry, cause: error.stack }),
        )
      }),
    })
  }),
)
