import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Path, Stream } from 'effect'
import { OverlayError } from '#contract/TranslationOverlay'
import { HostEvent, LunaHookHost } from './LunaHookHost'

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fake = path.join(import.meta.dirname, '__fixtures__', 'fake-luna-hook.mjs')
  const log = yield* fs.makeTempFileScoped()

  const layer = LunaHookHost.layer((args) => ({
    command: process.execPath,
    args: [fake, ...args, '--log', log],
  }))

  const host = Context.get(yield* Layer.build(layer), LunaHookHost)
  const commands = Effect.map(fs.readFileString(log), (text) => text.split('\n').filter(Boolean))

  return { host, commands }
})

const take = (events: Stream.Stream<HostEvent>, count: number) =>
  Stream.runCollect(Stream.take(events, count))

describe('LunaHookHost', () => {
  it.live('attaches to a game and reports its threads and text', () =>
    Effect.gen(function* () {
      const { host } = yield* setup
      const session = yield* host.start('plugins/luna-hook/v12')

      yield* session.attach(100)

      const events = yield* take(session.events, 4)

      expect(events).toEqual([
        HostEvent.Connected({ pid: 100 }),
        HostEvent.Thread({
          thread: '100:HS8@0:Game.exe:0:0',
          pid: 100,
          ctx: '0',
          ctx2: '0',
          code: 'HS8@0:Game.exe',
          name: 'TextOutA',
        }),
        HostEvent.Text({ thread: '100:HS8@0:Game.exe:0:0', text: 'こんにちは、世界。' }),
        HostEvent.Log({ level: 'info', message: 'Game engine: KiriKiri.' }),
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('sends hook codes to the helper', () =>
    Effect.gen(function* () {
      const { host } = yield* setup
      const session = yield* host.start('plugins/luna-hook/v12')

      yield* session.insertHook(100, 'HS-1C@0:Game.exe')

      const [event] = yield* take(session.events, 1)

      expect(event).toMatchObject(
        HostEvent.Thread({
          thread: '100:HS-1C@0:Game.exe:0:0',
          pid: 100,
          ctx: '0',
          ctx2: '0',
          code: 'HS-1C@0:Game.exe',
          name: 'Manual',
        }),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('reports a game that runs as administrator', () =>
    Effect.gen(function* () {
      const { host } = yield* setup
      const session = yield* host.start('plugins/luna-hook/v12')

      const error = yield* Effect.flip(session.attach(666))

      expect(error).toBeInstanceOf(OverlayError)
      expect(error.reason).toBe('elevated')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('fails a missing plugin with a typed error instead of a fake', () =>
    Effect.gen(function* () {
      const { host } = yield* setup

      const error = yield* Effect.flip(host.start('plugins/missing'))

      expect(error.reason).toBe('not-ready')
      expect(error.message).toContain('LunaHost64.dll could not be loaded')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('ends the events and fails pending commands when the helper crashes', () =>
    Effect.gen(function* () {
      const { host } = yield* setup
      const session = yield* host.start('plugins/luna-hook/v12')

      const error = yield* Effect.flip(session.attach(13))
      const events = yield* Stream.runCollect(session.events)

      expect(error.message).toBe('LunaHook stopped unexpectedly.')
      expect(events).toEqual([HostEvent.Stopped()])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('tells the helper to quit when the session closes', () =>
    Effect.gen(function* () {
      const { host, commands } = yield* setup

      yield* Effect.scoped(host.start('plugins/luna-hook/v12'))

      expect(yield* commands).toEqual(['quit'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('lists running processes', () =>
    Effect.gen(function* () {
      const { host } = yield* setup

      expect(yield* host.processes).toEqual([
        { pid: 4, parentPid: 0, name: 'System', path: '' },
        { pid: 100, parentPid: 4, name: 'Game.exe', path: 'C:\\Games\\Aki\\Game.exe' },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
