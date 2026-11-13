import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Logger, References } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { watchSidecar } from './SidecarOutput'

const run = (script: string) =>
  Effect.gen(function* () {
    const logged: Array<{ level: string; message: unknown; annotations: object }> = []

    const logger = Logger.make(({ logLevel, message, fiber }) => {
      logged.push({
        level: logLevel,
        message: Array.isArray(message) ? message[0] : message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      })
    })

    yield* Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const handle = yield* spawner.spawn(
          ChildProcess.make(process.execPath, ['-e', script], { stderr: 'pipe' }),
        )

        yield* watchSidecar('fake', handle)
        yield* handle.exitCode
        yield* Effect.sleep('50 millis')
      }),
    ).pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, 'Debug'),
    )

    return logged
  }).pipe(Effect.provide(NodeServices.layer))

describe('watchSidecar', () => {
  it.live('logs the end of stderr when a sidecar fails', () =>
    Effect.gen(function* () {
      const logged = yield* run(
        "process.stderr.write('loading\\nCUDA error: out of memory\\n'); process.exit(3)",
      )

      assert.deepStrictEqual(
        logged.map((entry) => [entry.level, entry.message]),
        [['Error', 'Sidecar exited with an error']],
      )

      assert.deepInclude(logged[0]?.annotations, {
        sidecar: 'fake',
        exitCode: 3,
        output: 'loading\nCUDA error: out of memory',
      })
    }),
  )

  it.live('only notes a clean exit at debug level', () =>
    Effect.gen(function* () {
      const logged = yield* run("process.stderr.write('fine\\n')")

      assert.deepStrictEqual(
        logged.map((entry) => [entry.level, entry.message]),
        [['Debug', 'Sidecar exited']],
      )
    }),
  )
})
