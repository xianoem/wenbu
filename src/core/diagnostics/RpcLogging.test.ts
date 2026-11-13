import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Logger, References, Schema } from 'effect'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { RpcLogging } from '#contract/Diagnostics'
import { RpcLoggingLive, rpcFeature } from './RpcLogging'

class Refused extends Schema.TaggedError<Refused>()('Refused', { message: Schema.String }) {}

class TestRpc extends RpcGroup.make(
  Rpc.make('works'),
  Rpc.make('refuses', { error: Refused }),
  Rpc.make('breaks'),
).middleware(RpcLogging) {}

const Handlers = TestRpc.toLayer({
  works: () => Effect.logInfo('Inside the handler'),
  refuses: () => Effect.fail(new Refused({ message: 'No preset chosen' })),
  breaks: () => Effect.die(new Error('boom')),
})

interface Logged {
  readonly level: string
  readonly message: unknown
  readonly annotations: Readonly<Record<string, unknown>>
  readonly hasCause: boolean
}

const capture = (
  call: (client: Effect.Success<ReturnType<typeof makeClient>>) => Effect.Effect<unknown, Refused>,
) =>
  Effect.gen(function* () {
    const logged: Array<Logged> = []

    const logger = Logger.make(({ logLevel, message, fiber, cause }) => {
      logged.push({
        level: logLevel,
        message: Array.isArray(message) ? message[0] : message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
        hasCause: cause.reasons.length > 0,
      })
    })

    yield* makeClient().pipe(
      Effect.flatMap((client) => Effect.exit(call(client))),
      Effect.provide(Layer.mergeAll(Handlers, RpcLoggingLive, Logger.layer([logger]))),
      Effect.provideService(References.MinimumLogLevel, 'Debug'),
      Effect.scoped,
    )

    return logged.filter((entry) => entry.annotations['rpc'] !== undefined)
  })

const makeClient = () => RpcTest.makeClient(TestRpc)

describe('RpcLogging', () => {
  it.effect('names the rpc on logs written while serving it, and notes success at debug', () =>
    Effect.gen(function* () {
      const logged = yield* capture((client) => client.works())

      assert.deepStrictEqual(
        logged.map((entry) => [entry.level, entry.message, entry.annotations['rpc']]),
        [
          ['Info', 'Inside the handler', 'works'],
          ['Debug', 'Request finished', 'works'],
        ],
      )
    }),
  )

  it.effect('logs a typed failure as a warning with the error', () =>
    Effect.gen(function* () {
      const logged = yield* capture((client) => client.refuses())

      assert.deepStrictEqual(
        logged.map((entry) => [entry.level, entry.message, entry.annotations['error']]),
        [['Warn', 'Request failed', 'Refused: No preset chosen']],
      )
    }),
  )

  it.effect('logs a defect as an error with its cause', () =>
    Effect.gen(function* () {
      const logged = yield* capture((client) => client.breaks())

      assert.deepStrictEqual(
        logged.map((entry) => [entry.level, entry.message, entry.hasCause]),
        [['Error', 'Request failed unexpectedly', true]],
      )
    }),
  )

  it('names the feature each request belongs to', () => {
    assert.strictEqual(rpcFeature('effect/rpc/Rpc/startSubtitles'), 'subtitles')
    assert.strictEqual(rpcFeature('effect/rpc/Rpc/watchPlugins'), 'plugins')
    assert.strictEqual(rpcFeature('noSuchRequest'), 'core')
  })
})
