import * as NodeSocket from '@effect/platform-node/NodeSocket'
import * as NodeSocketServer from '@effect/platform-node/NodeSocketServer'
import { Effect, FileSystem, Option, Path, Predicate, Schedule, Schema, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { Socket } from 'effect/socket'
import type { Game } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import bridgeSource from './game/nwjs-bridge.js?raw'
import nwjsSource from './game/nwjs.js?raw'
import { connectionLost, type GameRuntime, gameError, type RuntimeArgument } from './GameRuntime'
import { makeRequests } from './Requests'

export type NwjsTransport = 'devtools' | 'bridge'

export interface NwjsLaunch {
  readonly transport: NwjsTransport
  readonly port: number
  readonly args: ReadonlyArray<string>
}

const failed = (message: string) => new LiveControlsError({ reason: 'failed', message })

export const bridgeFileName = 'wenbu-live-controls-bridge.js'

export const manifestBackupName = '.wenbu-live-controls-package.json.backup'

const Manifest = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

const decodeManifest = Schema.decodeUnknownEffect(Manifest)

const encodeManifest = Schema.encodeEffect(Manifest)

const devtoolsDisabled = (manifest: Record<string, unknown>) => {
  const args = manifest['chromium-args']

  return (
    Predicate.isString(args) &&
    args
      .trim()
      .split(/\s+/)
      .some((arg) => /^--disable-devtools(=(true|1))?$/.test(arg))
  )
}

const latin1 = new TextDecoder('latin1')

// Minor version 0 and a four-digit build tell a Chromium version apart from certificate OIDs.
export const chromiumMajor = (bytes: Uint8Array) => {
  let major: number | undefined

  for (const match of latin1
    .decode(bytes)
    .matchAll(/(?<![0-9.])([4-9][0-9]|1[0-9]{2})\.0\.[0-9]{4}\.[0-9]{1,3}(?![0-9.])/g)) {
    major = Math.max(major ?? 0, Number(match[1]))
  }

  return major
}

// NW.js up to Chromium 65 (MV 1.6 and older) gives no usable DevTools target.
const lastChromiumWithoutDevtools = 65

const paths = Effect.fnUntraced(function* (game: Game) {
  const path = yield* Path.Path

  return {
    manifest: path.join(game.folderPath, 'package.json'),
    backup: path.join(game.folderPath, manifestBackupName),
    bridge: path.join(game.folderPath, bridgeFileName),
    runtime: path.join(path.dirname(game.executablePath), 'nw.dll'),
  }
})

const readManifest = Effect.fnUntraced(function* (game: Game) {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths(game)

  const text = yield* fs
    .readFileString(files.manifest)
    .pipe(Effect.mapError(() => failed("The game's package.json could not be read.")))

  return yield* decodeManifest(text.replace(/^﻿/, '')).pipe(
    Effect.mapError(() => failed("The game's package.json is not valid JSON.")),
  )
})

export const chooseTransport = Effect.fn('NwjsRuntime.chooseTransport')(function* (game: Game) {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths(game)
  const manifest = yield* readManifest(game).pipe(Effect.option)

  if (Option.exists(manifest, devtoolsDisabled)) {
    return 'bridge' satisfies NwjsTransport
  }

  const binaries = yield* Effect.forEach([game.executablePath, files.runtime], (file) =>
    fs.readFile(file).pipe(Effect.option),
  )

  const majors = binaries.flatMap((binary) =>
    Option.match(binary, { onNone: () => [], onSome: (bytes) => [chromiumMajor(bytes) ?? 0] }),
  )

  const newest = Math.max(0, ...majors)

  return newest > 0 && newest <= lastChromiumWithoutDevtools ? 'bridge' : 'devtools'
})

export const restoreFiles = Effect.fn('NwjsRuntime.restoreFiles')(
  function* (game: Game) {
    const fs = yield* FileSystem.FileSystem
    const files = yield* paths(game)

    if (!(yield* fs.exists(files.backup).pipe(Effect.orElseSucceed(() => false)))) {
      return
    }

    yield* fs.copyFile(files.backup, files.manifest)
    yield* fs.remove(files.bridge, { force: true })
    yield* fs.remove(files.backup, { force: true })
  },
  Effect.mapError(() => failed("The game's package.json could not be restored.")),
)

const writeBridge = Effect.fn('NwjsRuntime.writeBridge')(function* (game: Game, port: number) {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths(game)

  yield* restoreFiles(game)

  const manifest = yield* readManifest(game)

  if (
    Predicate.isString(manifest['inject_js_start']) &&
    manifest['inject_js_start'].trim() !== ''
  ) {
    return yield* failed(
      `This game already starts ${manifest['inject_js_start']} through package.json, so Wenbu left it alone.`,
    )
  }

  const patched = yield* encodeManifest({ ...manifest, inject_js_start: bridgeFileName }).pipe(
    Effect.orDie,
  )

  const write = Effect.gen(function* () {
    yield* fs.copyFile(files.manifest, files.backup)
    yield* fs.writeFileString(files.bridge, bridgeSource.replace('__WENBU_PORT__', String(port)))
    yield* fs.writeFileString(files.manifest, patched)
  })

  yield* write.pipe(
    Effect.catch(() =>
      restoreFiles(game).pipe(
        Effect.ignore,
        Effect.andThen(failed('Wenbu could not prepare the game for Live Game Controls.')),
      ),
    ),
  )
})

const freePort = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* NodeSocketServer.make({ port: 0, host: '127.0.0.1' })
    const address = server.address

    return 'port' in address ? address.port : yield* failed('No local port was free.')
  }),
).pipe(Effect.mapError(() => failed('No local port was free.')))

export const planLaunch = Effect.fn('NwjsRuntime.planLaunch')(function* (game: Game) {
  const transport = yield* chooseTransport(game)
  const port = yield* freePort

  if (transport === 'bridge') {
    yield* writeBridge(game, port)

    return { transport, port, args: [] } satisfies NwjsLaunch
  }

  return {
    transport,
    port,
    args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
  } satisfies NwjsLaunch
})

const DevtoolsTargets = Schema.Array(
  Schema.Struct({ type: Schema.String, webSocketDebuggerUrl: Schema.optional(Schema.String) }),
)

const DevtoolsReply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Int),
    result: Schema.optional(
      Schema.Struct({
        result: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.Unknown) })),
        exceptionDetails: Schema.optional(Schema.Struct({ text: Schema.String })),
      }),
    ),
  }),
)

const decodeDevtoolsReply = Schema.decodeUnknownOption(DevtoolsReply)

const BridgeReply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Int,
    ok: Schema.Boolean,
    value: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
)

const decodeBridgeReply = Schema.decodeUnknownOption(BridgeReply)

type Evaluation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }

const textDecoder = new TextDecoder()

const chunkText = (chunk: Uint8Array | string) =>
  Predicate.isString(chunk) ? chunk : textDecoder.decode(chunk)

const pageSocketUrl = Effect.fnUntraced(function* (port: number) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const find = client.get(`http://127.0.0.1:${port}/json/list`).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(DevtoolsTargets)),
    Effect.flatMap((targets) => {
      const url = targets.find((target) => target.type === 'page')?.webSocketDebuggerUrl

      return url === undefined ? Effect.fail('no page yet' as const) : Effect.succeed(url)
    }),
  )

  return yield* find.pipe(
    Effect.retry({ schedule: Schedule.spaced('500 millis'), times: 120 }),
    Effect.mapError(() => failed('The game did not open its DevTools port.')),
  )
})

const devtoolsEvaluator = Effect.fnUntraced(function* (port: number) {
  const url = yield* pageSocketUrl(port)

  const socket = yield* Socket.makeWebSocket(url).pipe(
    Effect.provide(Socket.layerWebSocketConstructorGlobal),
  )

  const reader = yield* socket.reader.pipe(
    Effect.mapError(() => failed('The game refused the DevTools connection.')),
  )

  const writer = yield* socket.writer
  const requests = yield* makeRequests<Evaluation>()

  const toEvaluation = (result: NonNullable<(typeof DevtoolsReply.Type)['result']>): Evaluation =>
    result.exceptionDetails === undefined
      ? { ok: true, value: result.result?.value }
      : { ok: false, error: result.exceptionDetails.text }

  yield* Stream.repeat(Stream.fromEffect(reader.pull), Schedule.forever).pipe(
    Stream.flattenIterable,
    Stream.runForEach((chunk) =>
      Option.match(decodeDevtoolsReply(chunkText(chunk)), {
        onNone: () => Effect.void,
        onSome: (reply) =>
          reply.id === undefined || reply.result === undefined
            ? Effect.void
            : requests.settle(reply.id, toEvaluation(reply.result)),
      }),
    ),
    Effect.ignore,
    Effect.ensuring(requests.close),
    Effect.forkScoped,
  )

  const evaluate = (expression: string) =>
    requests.request((id) =>
      writer
        .write(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true },
          }),
        )
        .pipe(Effect.mapError(() => connectionLost())),
    )

  return { evaluate, lost: requests.lost }
})

const splitLines = (buffer: string, chunk: string) => {
  const lines = (buffer + chunk).split('\n')
  const rest = lines.pop() ?? ''

  return [rest, lines.filter((line) => line.trim() !== '')] as const
}

const bridgeEvaluator = Effect.fnUntraced(function* (port: number) {
  const socket = yield* NodeSocket.makeNet({ host: '127.0.0.1', port })

  const reader = yield* socket.reader.pipe(
    Effect.retry({ schedule: Schedule.spaced('500 millis'), times: 120 }),
    Effect.mapError(() => failed('The game did not start the Live Game Controls bridge.')),
  )

  const writer = yield* socket.writer
  const requests = yield* makeRequests<Evaluation>()

  yield* Stream.repeat(Stream.fromEffect(reader.pull), Schedule.forever).pipe(
    Stream.flattenIterable,
    Stream.map(chunkText),
    Stream.mapAccum(() => '', splitLines),
    Stream.runForEach((line) =>
      Option.match(decodeBridgeReply(line), {
        onNone: () => Effect.void,
        onSome: (reply) =>
          requests.settle(
            reply.id,
            reply.ok
              ? { ok: true, value: reply.value }
              : { ok: false, error: reply.error ?? 'The game reported an error.' },
          ),
      }),
    ),
    Effect.ignore,
    Effect.ensuring(requests.close),
    Effect.forkScoped,
  )

  const evaluate = (code: string) =>
    requests.request((id) =>
      writer
        .write(`${JSON.stringify({ id, code })}\n`)
        .pipe(Effect.mapError(() => connectionLost())),
    )

  return { evaluate, lost: requests.lost }
})

const Answer = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
  ]),
)

const decodeAnswer = Schema.decodeUnknownEffect(Answer)

const missing = 'wenbu-live-missing'

export const callExpression = (command: string, args: ReadonlyArray<RuntimeArgument>) =>
  `(function () { var live = window.__wenbuLive; return live && live.call ? live.call(${JSON.stringify(command)}, ${JSON.stringify(args)}) : '{"ok":false,"error":"${missing}"}' })()`

export const connectNwjs = Effect.fn('NwjsRuntime.connect')(function* (
  game: Game,
  launch: NwjsLaunch,
) {
  const connection =
    launch.transport === 'devtools'
      ? yield* devtoolsEvaluator(launch.port)
      : yield* bridgeEvaluator(launch.port)

  if (launch.transport === 'bridge') {
    yield* restoreFiles(game)
  }

  const run = Effect.fnUntraced(function* (expression: string) {
    const evaluation = yield* connection.evaluate(expression)

    if (!evaluation.ok) {
      return yield* failed(`The game reported: ${evaluation.error}`)
    }

    return yield* decodeAnswer(evaluation.value).pipe(
      Effect.mapError(() => failed('The game answered with data Wenbu could not read.')),
    )
  })

  const finish = (answer: typeof Answer.Type) =>
    answer.ok ? Effect.succeed(answer.value) : Effect.fail(gameError(answer.error))

  const install = Effect.flatMap(run(nwjsSource), finish)

  // Reloading the page (F5) drops Wenbu's code, so a missing runtime is installed again.
  const call = (command: string, args: ReadonlyArray<RuntimeArgument> = []) =>
    command === 'install'
      ? install
      : run(callExpression(command, args)).pipe(
          Effect.flatMap((answer) =>
            !answer.ok && answer.error === missing
              ? Effect.andThen(install, Effect.flatMap(run(callExpression(command, args)), finish))
              : finish(answer),
          ),
        )

  return { call, lost: connection.lost } satisfies GameRuntime
})
