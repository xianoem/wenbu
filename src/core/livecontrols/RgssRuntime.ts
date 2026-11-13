import * as NodeSocket from '@effect/platform-node/NodeSocket'
import {
  Config,
  Context,
  Deferred,
  Effect,
  Layer,
  Path,
  Predicate,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { LiveControlsError } from '#contract/LiveControls'
import { platformKey } from '../plugins/PluginDefinition'
import { decodeRubyMarshal } from '../rpgmaker/RubyMarshal'
import rgssSource from './game/rgss.rb?raw'
import { connectionLost, type GameRuntime, gameError, type RuntimeArgument } from './GameRuntime'
import { makeRequests } from './Requests'

const failed = (message: string) => new LiveControlsError({ reason: 'failed', message })

const InjectResult = Schema.fromJsonString(
  Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String) }),
)

export class RgssBridge extends Context.Service<
  RgssBridge,
  {
    readonly inject: (processId: number) => Effect.Effect<void, LiveControlsError>
    readonly pipePath: (processId: number) => string
  }
>()('wenbu/core/livecontrols/RgssBridge') {
  static readonly live = Layer.effect(
    RgssBridge,
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const folder = path.join(resources, 'native', platformKey)

      const inject = Effect.fn('RgssBridge.inject')(function* (processId: number) {
        const output = yield* spawner
          .string(
            ChildProcess.make(
              path.join(folder, 'wenbu-rgss-inject.exe'),
              [String(processId), path.join(folder, 'wenbu-rgss.dll')],
              { stderr: 'ignore' },
            ),
          )
          .pipe(Effect.mapError(() => failed('Wenbu could not start its game bridge.')))

        const result = yield* Schema.decodeUnknownEffect(InjectResult)(output.trim()).pipe(
          Effect.mapError(() =>
            failed('The game bridge gave an answer Wenbu does not understand.'),
          ),
        )

        if (!result.ok) {
          return yield* failed(result.error ?? 'The game bridge could not be loaded.')
        }
      })

      return RgssBridge.of({
        inject,
        pipePath: (processId) => `\\\\.\\pipe\\wenbu-rgss-${processId}`,
      })
    }),
  )
}

export interface Reply {
  readonly id: number
  readonly ok: boolean
  readonly payload: Uint8Array
}

const textEncoder = new TextEncoder()

const textDecoder = new TextDecoder()

export const encodeRequest = (id: number, code: string) => {
  const body = textEncoder.encode(code)
  const frame = new Uint8Array(8 + body.length)
  const view = new DataView(frame.buffer)

  view.setUint32(0, id, true)
  view.setUint32(4, body.length, true)
  frame.set(body, 8)

  return frame
}

const concat = (left: Uint8Array, right: Uint8Array) => {
  const joined = new Uint8Array(left.length + right.length)

  joined.set(left)
  joined.set(right, left.length)

  return joined
}

const takeReplies = (buffer: Uint8Array) => {
  const replies: Array<Reply> = []
  let offset = 0

  while (buffer.length - offset >= 12) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
    const length = view.getUint32(8, true)

    if (buffer.length - offset < 12 + length) {
      break
    }

    replies.push({
      id: view.getUint32(0, true),
      ok: view.getUint32(4, true) !== 0,
      payload: buffer.slice(offset + 12, offset + 12 + length),
    })

    offset += 12 + length
  }

  return [buffer.slice(offset), replies] as const
}

export const readReplies = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>) =>
  bytes.pipe(
    Stream.mapAccum(
      () => new Uint8Array(0),
      (buffer, chunk) => takeReplies(concat(buffer, chunk)),
    ),
  )

const hexByte = (byte: number) => `\\x${byte.toString(16).padStart(2, '0')}`

/** Ruby 1.8 has no `\u` escapes, so text travels as escaped UTF-8 bytes. */
export const rubyLiteral = (value: RuntimeArgument): string => {
  if (value === null) {
    return 'nil'
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => rubyLiteral(item)).join(', ')}]`
  }

  if (Predicate.isString(value)) {
    return `::WenbuLive.text("${Array.from(textEncoder.encode(value), hexByte).join('')}")`
  }

  if (Predicate.isNumber(value) && !Number.isFinite(value)) {
    return '0'
  }

  return String(value)
}

const rubyName = (command: string) =>
  command.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export const commandSource = (id: number, command: string, args: ReadonlyArray<RuntimeArgument>) =>
  `::WenbuLive.answer(${id}) { ::WenbuLive.${rubyName(command)}(${args.map(rubyLiteral).join(', ')}) }`

/** Loading the runtime can fail before WenbuLive exists, so that failure is answered directly. */
export const installSource = (id: number, source: string) =>
  [
    'begin',
    source,
    `::WenbuLive.answer(${id}) { ::WenbuLive.install }`,
    'rescue Exception => wenbu_error',
    "wenbu_message = wenbu_error.class.to_s + ': ' + wenbu_error.message.to_s",
    'wenbu_size = wenbu_message.respond_to?(:bytesize) ? wenbu_message.bytesize : wenbu_message.size',
    `Win32API.new('wenbu-rgss', 'wenbu_reply', ['L', 'L', 'P', 'L'], 'V').call(${id}, 0, wenbu_message, wenbu_size)`,
    'end',
  ].join('\n')

const decodeAnswer = (reply: Reply) => {
  if (!reply.ok) {
    return Effect.fail(gameError(textDecoder.decode(reply.payload)))
  }

  return Effect.try({
    try: () => decodeRubyMarshal(reply.payload),
    catch: () => failed('The game answered with data Wenbu could not read.'),
  })
}

const chunkBytes = (chunk: Uint8Array | string) =>
  Predicate.isString(chunk) ? textEncoder.encode(chunk) : chunk

export const connectRgss = Effect.fn('RgssRuntime.connect')(function* (processId: number) {
  const bridge = yield* RgssBridge

  yield* bridge.inject(processId)

  const socket = yield* NodeSocket.makeNet({ path: bridge.pipePath(processId) })

  const reader = yield* socket.reader.pipe(
    Effect.retry({ schedule: Schedule.spaced('250 millis'), times: 160 }),
    Effect.mapError(() => failed('The game bridge did not open its connection.')),
  )

  const writer = yield* socket.writer
  const requests = yield* makeRequests<Reply>()
  const hello = yield* Deferred.make<Reply>()

  yield* Stream.repeat(Stream.fromEffect(reader.pull), Schedule.forever).pipe(
    Stream.flattenIterable,
    Stream.map(chunkBytes),
    readReplies,
    Stream.runForEach((reply) =>
      reply.id === 0 ? Deferred.succeed(hello, reply) : requests.settle(reply.id, reply),
    ),
    Effect.ignore,
    Effect.ensuring(requests.close),
    Effect.forkScoped,
  )

  const greeting = yield* Deferred.await(hello).pipe(
    Effect.raceFirst(requests.whenLost),
    Effect.timeoutOrElse({
      duration: '40 seconds',
      orElse: () => Effect.fail(failed('The game bridge did not say hello.')),
    }),
  )

  if (!greeting.ok) {
    return yield* new LiveControlsError({
      reason: 'unsupported',
      message: textDecoder.decode(greeting.payload),
    })
  }

  const send = (source: (id: number) => string) =>
    requests
      .request((id) =>
        writer.write(encodeRequest(id, source(id))).pipe(Effect.mapError(() => connectionLost())),
      )
      .pipe(Effect.flatMap(decodeAnswer))

  return {
    call: (command, args = []) =>
      send((id) =>
        command === 'install' ? installSource(id, rgssSource) : commandSource(id, command, args),
      ),
    lost: requests.lost,
  } satisfies GameRuntime
})
