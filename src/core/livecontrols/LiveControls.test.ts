import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Layer, Option, Ref, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { type GameEngine, GameCandidate } from '#contract/Library'
import { LiveControlsError, LiveControlsRpc, type LiveControlsState } from '#contract/LiveControls'
import { Games } from '../library/Games'
import * as Database from '../platform/Database'
import { GameConnector } from './GameConnector'
import type { GameRuntime, RuntimeArgument } from './GameRuntime'
import { LiveControls, LiveControlsRpcLive } from './LiveControls'

interface FakeGame {
  readonly calls: Ref.Ref<ReadonlyArray<string>>
  readonly running: Ref.Ref<boolean>
  readonly loadingFor: Ref.Ref<number>
  readonly lost: Ref.Ref<Deferred.Deferred<void>>
}

const fakeRuntime = (game: FakeGame) =>
  Effect.gen(function* () {
    const world: { gold: number; hpMode: string; fontSize: number | null; speed: number } = {
      gold: 50,
      hpMode: 'none',
      fontSize: null,
      speed: 1,
    }

    const lost = yield* Deferred.make<void>()

    yield* Ref.set(game.lost, lost)

    const snapshot = () => ({
      ready: true,
      gold: world.gold,
      maxGold: 9999,
      hpMode: world.hpMode,
      fontSize: world.fontSize,
      defaultFontSize: 24,
      speed: world.speed,
    })

    const commands: Record<string, (args: ReadonlyArray<RuntimeArgument>) => unknown> = {
      install: () => ({ snapshot: snapshot(), unsupported: { oneHit: 'Game_Battler: replaced' } }),
      snapshot,
      setGold: ([gold]) => {
        world.gold = Number(gold)

        return snapshot()
      },
      setHpMode: ([mode]) => {
        world.hpMode = String(mode)

        return snapshot()
      },
      setFontSize: ([size]) => {
        world.fontSize = size === null || size === undefined ? null : Number(size)

        return snapshot()
      },
      setSpeed: ([speed]) => {
        world.speed = Number(speed)

        return snapshot()
      },
      actors: () => [{ id: 1, name: 'Eric', nickname: '' }],
    }

    const call = (command: string, args: ReadonlyArray<RuntimeArgument> = []) =>
      Effect.gen(function* () {
        yield* Ref.update(game.calls, (all) => [...all, `${command}(${args.join(',')})`])

        if (command === 'install' && (yield* Ref.getAndUpdate(game.loadingFor, (n) => n - 1)) > 0) {
          return yield* new LiveControlsError({ reason: 'not-ready', message: 'Still loading.' })
        }

        const run = commands[command]

        if (run === undefined) {
          return yield* new LiveControlsError({ reason: 'invalid', message: 'Unknown command.' })
        }

        return run(args)
      })

    return { call, lost: Deferred.await(lost) } satisfies GameRuntime
  })

const setup = Effect.fn(function* (engine: GameEngine) {
  const game: FakeGame = {
    calls: yield* Ref.make<ReadonlyArray<string>>([]),
    running: yield* Ref.make(true),
    loadingFor: yield* Ref.make(0),
    lost: yield* Ref.make(yield* Deferred.make<void>()),
  }

  const connector = Layer.succeed(GameConnector)({
    prepare: () =>
      Effect.succeed({ args: ['--remote-debugging-port=9222'], connect: () => fakeRuntime(game) }),
    attach: () => Effect.succeed({ args: [], connect: () => fakeRuntime(game) }),
    isRunning: () => Ref.get(game.running),
    recover: () => Effect.void,
  })

  const layer = LiveControlsRpcLive.pipe(
    Layer.provideMerge(
      LiveControls.layerWith({ installEvery: '5 millis', installAttempts: 20, poll: '20 millis' }),
    ),
    Layer.provide(connector),
    Layer.provideMerge(Games.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(NodeServices.layer),
  )

  const services = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(LiveControlsRpc).pipe(Effect.provide(services))
  const live = Context.get(services, LiveControls)
  const games = Context.get(services, Games)
  const store = Context.get(services, KeyValueStore.KeyValueStore)

  const registered = yield* games.add(
    GameCandidate.make({
      title: 'Aki',
      folderPath: 'C:\\Games\\Aki',
      executablePath: 'C:\\Games\\Aki\\Game.exe',
      engine,
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  const until = (done: (state: LiveControlsState) => boolean) =>
    client
      .watchLiveControls()
      .pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow))

  return { client, live, game, registered, store, until }
})

const connected = (state: LiveControlsState) => state.status === 'connected'

describe('LiveControls', () => {
  it.live('joins a running game and brings back its font size and speed next time', () =>
    Effect.gen(function* () {
      const { client, game, registered, until } = yield* setup('rpg-maker-vx-ace')

      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })

      const first = yield* until(connected)

      expect(first).toMatchObject({
        gameTitle: 'Aki',
        gold: 50,
        dialogueFontSize: 24,
        unsupported: [{ control: 'oneHit', reason: 'Game_Battler: replaced' }],
      })

      yield* client.setDialogueFontSize({ size: 30 })
      yield* client.setCharacterSpeed({ speed: 2 })
      yield* client.stopLiveControls()
      yield* Ref.set(game.calls, [])
      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })

      const second = yield* until((state) => connected(state) && state.characterSpeed === 2)

      expect(second.dialogueFontSize).toBe(30)

      const commands = (yield* Ref.get(game.calls)).filter((call) => call !== 'snapshot()')

      expect(commands.slice(0, 3)).toEqual(['install()', 'setFontSize(30)', 'setSpeed(2)'])
    }).pipe(Effect.scoped),
  )

  it.live('shares the connected game with other features until it closes', () =>
    Effect.gen(function* () {
      const { client, game, live, registered, until } = yield* setup('rpg-maker-vx-ace')

      const titleOf = (session: Option.Option<{ readonly game: { readonly title: string } }>) =>
        Option.map(session, (connected) => connected.game.title)

      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })
      yield* until(connected)

      const session = yield* live.sessions.pipe(
        Stream.filter(Option.isSome),
        Stream.runHead,
        Effect.map(Option.flatten),
      )

      expect(titleOf(session)).toEqual(Option.some('Aki'))

      const gold = yield* Option.getOrThrow(session).runtime.call('setGold', [7])

      expect(gold).toMatchObject({ gold: 7 })

      yield* Ref.set(game.running, false)
      yield* Deferred.succeed(yield* Ref.get(game.lost), undefined)

      const after = yield* live.sessions.pipe(
        Stream.filter(Option.isNone),
        Stream.runHead,
        Effect.map(Option.flatten),
      )

      expect(after).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.live('brings back the saved preferences that still fit', () =>
    Effect.gen(function* () {
      const { client, game, registered, store, until } = yield* setup('rpg-maker-vx-ace')

      yield* store.set(`live-controls:${registered.id}`, '{"fontSize":"large","speed":2}')
      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })
      yield* until((state) => connected(state) && state.characterSpeed === 2)

      const commands = (yield* Ref.get(game.calls)).filter((call) => call !== 'snapshot()')

      expect(commands.slice(0, 2)).toEqual(['install()', 'setSpeed(2)'])
    }).pipe(Effect.scoped),
  )

  it.live('gives the font back to the game at its own size, and resets everything but gold', () =>
    Effect.gen(function* () {
      const { client, game, registered, until } = yield* setup('rpg-maker-vx-ace')

      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })
      yield* until(connected)
      yield* client.setDialogueFontSize({ size: 24 })
      yield* client.setGold({ gold: 1234.7 })
      yield* client.setHpMode({ mode: 'god' })
      yield* client.resetLiveControls()

      const state = yield* until((now) => now.hpMode === 'none' && now.gold === 1234)

      expect(state).toMatchObject({ dialogueFontSize: 24, characterSpeed: 1 })
      expect(yield* Ref.get(game.calls)).toContain('setFontSize()')
    }).pipe(Effect.scoped),
  )

  it.live('waits for a game still loading its classes', () =>
    Effect.gen(function* () {
      const { client, game, registered, until } = yield* setup('rpg-maker-xp')

      yield* Ref.set(game.loadingFor, 3)
      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })
      yield* until(connected)

      expect((yield* Ref.get(game.calls)).filter((call) => call === 'install()')).toHaveLength(4)
    }).pipe(Effect.scoped),
  )

  it.live('offers a retry when the connection drops, and closes when the game is gone', () =>
    Effect.gen(function* () {
      const { client, game, registered, until } = yield* setup('rpg-maker-vx')

      yield* client.attachLiveControls({ gameId: registered.id, processId: 10 })
      yield* until(connected)
      yield* Deferred.succeed(yield* Ref.get(game.lost), undefined)

      const dropped = yield* until((state) => state.status === 'disconnected')
      const error = yield* Effect.flip(client.listActors())

      expect([dropped.canRetry, error.reason]).toEqual([true, 'not-connected'])

      yield* client.retryLiveControls()
      yield* until(connected)

      expect(yield* client.listActors()).toEqual([{ id: 1, name: 'Eric', nickname: '' }])

      yield* Ref.set(game.running, false)
      yield* Deferred.succeed(yield* Ref.get(game.lost), undefined)

      expect(yield* until((state) => state.status === 'stopped')).toMatchObject({
        message: 'Aki closed.',
      })
    }).pipe(Effect.scoped),
  )

  it.live('leaves a second game alone while the first one has the controls', () =>
    Effect.gen(function* () {
      const { live, registered, until } = yield* setup('rpg-maker-mv')
      const first = yield* live.plan(registered)

      yield* first.started({
        game: registered,
        locale: 'system',
        processId: 42,
        gameProcessId: Effect.succeed(Option.some(42)),
        exited: Effect.never,
      })

      yield* until(connected)

      expect((yield* live.plan(registered)).args).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.live('prepares MV and MZ games before they start and leaves other games alone', () =>
    Effect.gen(function* () {
      const mv = yield* setup('rpg-maker-mv')
      const windows = yield* setup('windows')

      const mvPlan = yield* mv.live.plan(mv.registered)
      const windowsPlan = yield* windows.live.plan(windows.registered)

      yield* mvPlan.started({
        game: mv.registered,
        locale: 'system',
        processId: 42,
        gameProcessId: Effect.succeed(Option.some(42)),
        exited: Effect.never,
      })

      yield* mv.until(connected)

      expect([mvPlan.args, windowsPlan.args]).toEqual([['--remote-debugging-port=9222'], []])
    }).pipe(Effect.scoped),
  )
})
