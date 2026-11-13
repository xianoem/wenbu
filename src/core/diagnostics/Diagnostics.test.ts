import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Stream } from 'effect'
import { RpcTest } from 'effect/rpc'
import { DiagnosticsRpc, type LogEntry } from '#contract/Diagnostics'
import { formatLogEntry } from '#contract/LogText'
import { DiagnosticsRpcLive } from './Diagnostics'
import { LogBook } from './LogBook'

const current = '2026-10-25T14-03-11'

const earlier = '2026-10-24T09-00-00'

const mainEntry = (at: number, message: string): LogEntry => ({
  at,
  level: 'info',
  process: 'main',
  run: 0,
  feature: 'app',
  message,
  fields: {},
})

const makeClient = RpcTest.makeClient(DiagnosticsRpc)

type Client = Effect.Success<typeof makeClient>

const withLaunches = <A, E>(
  program: (client: Client) => Effect.Effect<A, E, LogBook | FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped()

    yield* fs.makeDirectory(path.join(root, earlier))
    yield* fs.makeDirectory(path.join(root, current))
    yield* fs.makeDirectory(path.join(root, 'not-a-launch'))

    yield* fs.writeFileString(
      path.join(root, earlier, 'main.log'),
      `${formatLogEntry(mainEntry(1000, 'Wenbu started yesterday'))}\n`,
    )

    yield* fs.writeFileString(
      path.join(root, current, 'main.log'),
      `${formatLogEntry(mainEntry(5000, 'Wenbu started'))}\n`,
    )

    const layer = DiagnosticsRpcLive.pipe(
      Layer.provideMerge(LogBook.logger),
      Layer.provideMerge(LogBook.layerWith({ folder: path.join(root, current), run: 1, home: '' })),
    )

    return yield* Effect.flatMap(makeClient, program).pipe(Effect.provide(layer))
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe('Diagnostics', () => {
  it.effect('lists launch folders newest first', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const launches = yield* client.listLaunches()

        assert.deepStrictEqual(launches, [
          { id: current, current: true },
          { id: earlier, current: false },
        ])
      }),
    ),
  )

  it.effect('starts the current launch with what main and core wrote, then follows core', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const book = yield* LogBook

        const batches = yield* client.watchLog({}).pipe(
          Stream.tap((batch) =>
            batch.reset
              ? Effect.gen(function* () {
                  yield* Effect.logInfo('Game launched')
                  book.forward(mainEntry(9000, 'Core restarted'))
                })
              : Effect.void,
          ),
          Stream.take(3),
          Stream.runCollect,
        )

        assert.deepStrictEqual(
          batches.map((batch) => [batch.reset, batch.entries.map((entry) => entry.message)]),
          [
            [true, ['Wenbu started']],
            [false, ['Game launched']],
            [false, ['Core restarted']],
          ],
        )
      }),
    ),
  )

  it.effect('reads an earlier launch once', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const batches = yield* Stream.runCollect(client.watchLog({ launch: earlier }))

        assert.deepStrictEqual(
          batches.map((batch) => batch.entries.map((entry) => entry.message)),
          [['Wenbu started yesterday']],
        )
      }),
    ),
  )

  it.effect('reads nothing for a launch that is not a log folder', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const batches = yield* Stream.runCollect(client.watchLog({ launch: '../secrets' }))

        assert.deepStrictEqual(
          batches.map((batch) => batch.entries),
          [[]],
        )
      }),
    ),
  )

  it.effect('logs renderer errors as the renderer', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const book = yield* LogBook

        yield* client.reportRendererError({
          window: 'overlay',
          message: 'Cannot read properties of undefined',
          stack: 'TypeError: boom\n  at OverlayPage',
        })

        const batches = yield* client.watchLog({}).pipe(Stream.take(1), Stream.runCollect)
        const entry = batches[0]?.entries.find((candidate) => candidate.process === 'renderer')

        assert.strictEqual(entry?.message, 'Cannot read properties of undefined')
        assert.strictEqual(entry?.fields['window'], 'overlay')
        assert.strictEqual(entry?.cause, 'TypeError: boom\n  at OverlayPage')
        assert.isTrue(yield* fs.exists(book.folder))
      }),
    ),
  )

  it.effect('follows the count of warnings and errors as they are logged', () =>
    withLaunches((client) =>
      Effect.gen(function* () {
        const counts = yield* client.watchProblemCount().pipe(Stream.take(1), Stream.runCollect)

        assert.deepStrictEqual(counts, [{ warnings: 0, errors: 0 }])

        yield* client.reportRendererError({ window: 'main', message: 'Boom' })

        const after = yield* client.watchProblemCount().pipe(Stream.take(1), Stream.runCollect)

        assert.strictEqual(after[0]?.errors, 1)
        assert.strictEqual(after[0]?.lastError?.message, 'Boom')
      }),
    ),
  )
})
