import * as NodeServices from '@effect/platform-node/NodeServices'
import * as NodeSocketServer from '@effect/platform-node/NodeSocketServer'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Random, Stream } from 'effect'
import { encodeRubyMarshal } from '../rpgmaker/RubyMarshal'
import {
  commandSource,
  connectRgss,
  encodeRequest,
  readReplies,
  RgssBridge,
  rubyLiteral,
} from './RgssRuntime'

const textEncoder = new TextEncoder()

const textDecoder = new TextDecoder()

const reply = (id: number, ok: boolean, payload: Uint8Array) => {
  const frame = new Uint8Array(12 + payload.length)
  const view = new DataView(frame.buffer)

  view.setUint32(0, id, true)
  view.setUint32(4, ok ? 1 : 0, true)
  view.setUint32(8, payload.length, true)
  frame.set(payload, 12)

  return frame
}

const requests = (bytes: Uint8Array) => {
  const found: Array<{ readonly id: number; readonly code: string }> = []
  let offset = 0

  while (bytes.length - offset >= 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
    const length = view.getUint32(4, true)

    found.push({
      id: view.getUint32(0, true),
      code: textDecoder.decode(bytes.subarray(offset + 8, offset + 8 + length)),
    })

    offset += 8 + length
  }

  return found
}

const fakeBridge = (options: {
  readonly hello: readonly [boolean, string]
  readonly answer: (code: string) => readonly [boolean, Uint8Array]
}) =>
  Layer.effect(
    RgssBridge,
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const name = `wenbu-test-${yield* Random.nextIntBetween(0, 1_000_000)}`

      const pipe =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\${name}`
          : path.join(yield* fs.makeTempDirectoryScoped(), `${name}.sock`)

      const server = yield* NodeSocketServer.make({ path: pipe })

      yield* server
        .run((socket) =>
          Effect.gen(function* () {
            // A socket's writer waits until its reader has opened the connection.
            const reader = yield* socket.reader
            const write = (yield* socket.writer).write

            yield* write(reply(0, options.hello[0], textEncoder.encode(options.hello[1])))

            while (true) {
              for (const chunk of yield* reader.pull) {
                const bytes = chunk instanceof Uint8Array ? chunk : textEncoder.encode(chunk)

                for (const request of requests(bytes)) {
                  const [ok, payload] = options.answer(request.code)

                  yield* write(reply(request.id, ok, payload))
                }
              }
            }
          }).pipe(Effect.scoped, Effect.ignore),
        )
        .pipe(Effect.forkScoped)

      return RgssBridge.of({ inject: () => Effect.void, pipePath: () => pipe })
    }),
  ).pipe(Layer.provide(NodeServices.layer))

describe('RgssRuntime', () => {
  it.effect('splits replies that arrive in pieces', () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([
        ...reply(1, true, textEncoder.encode('one')),
        ...reply(2, false, textEncoder.encode('two')),
      ])

      const replies = yield* Stream.make(
        bytes.subarray(0, 5),
        bytes.subarray(5, 20),
        bytes.subarray(20),
      ).pipe(readReplies, Stream.runCollect)

      expect(
        replies.map((entry) => [entry.id, entry.ok, textDecoder.decode(entry.payload)]),
      ).toEqual([
        [1, true, 'one'],
        [2, false, 'two'],
      ])

      expect(requests(encodeRequest(7, 'snapshot'))).toEqual([{ id: 7, code: 'snapshot' }])
    }),
  )

  it('writes commands as Ruby that Ruby 1.8 can read', () => {
    expect(commandSource(3, 'setActorStat', [1, 'maxHp', 999])).toBe(
      '::WenbuLive.answer(3) { ::WenbuLive.set_actor_stat(1, ::WenbuLive.text("\\x6d\\x61\\x78\\x48\\x70"), 999) }',
    )

    expect(rubyLiteral([['a', 1], []])).toBe('[[::WenbuLive.text("\\x61"), 1], []]')

    expect([rubyLiteral(null), rubyLiteral(true), rubyLiteral(1.5), rubyLiteral('あ')]).toEqual([
      'nil',
      'true',
      '1.5',
      '::WenbuLive.text("\\xe3\\x81\\x82")',
    ])
  })

  it.live('calls the game and reads its Marshal answers and errors', () =>
    Effect.gen(function* () {
      const runtime = yield* connectRgss(4242)

      const snapshot = yield* runtime.call('snapshot')
      const error = yield* Effect.flip(runtime.call('setGold', [10]))

      expect(snapshot).toEqual({ ready: true, gold: 120 })
      expect([error.reason, error.message]).toEqual(['not-ready', 'Load a save first.'])
    }).pipe(
      Effect.scoped,
      Effect.provide([
        fakeBridge({
          hello: [true, 'RGSS301.dll'],
          answer: (code) =>
            code.includes('set_gold')
              ? [false, textEncoder.encode('not-ready: Load a save first.')]
              : [true, encodeRubyMarshal({ ready: true, gold: 120 })],
        }),
        NodeServices.layer,
      ]),
    ),
  )

  it.live('refuses games the bridge cannot drive', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(connectRgss(4242))

      expect([error.reason, error.message]).toEqual([
        'unsupported',
        'This game does not run on the standard RPG Maker player (no RGSSEval).',
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide([
        fakeBridge({
          hello: [false, 'This game does not run on the standard RPG Maker player (no RGSSEval).'],
          answer: () => [true, encodeRubyMarshal(null)],
        }),
        NodeServices.layer,
      ]),
    ),
  )
})
