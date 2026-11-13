import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, FileSystem, Layer, Path, Schedule, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { GameCandidate } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { MemoriesRpc } from '#contract/Memories'
import { Games } from '../library/Games'
import { GameConnector } from '../livecontrols/GameConnector'
import type { GameRuntime, RuntimeArgument } from '../livecontrols/GameRuntime'
import { LiveControls } from '../livecontrols/LiveControls'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { GameData } from '../rpgmaker/GameData'
import { MemoriesRpcLive } from './Memories'

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const page = (switchId: number) => ({
  conditions: { switch1Valid: true, switch1Id: switchId, switch2Valid: false, switch2Id: 1 },
  list: [],
})

const dataFiles = {
  'System.json': { switches: ['', '夜', 'シーン1回想', 'シーン2回想', 'シーン3回想'] },
  'MapInfos.json': [null, { id: 1, name: '町' }, { id: 2, name: '回想ルーム' }],
  'CommonEvents.json': [null],
  'Map002.json': {
    events: [
      null,
      { id: 1, name: 'Crystal 1', pages: [page(2)] },
      { id: 2, name: 'Crystal 2', pages: [page(3)] },
      { id: 3, name: 'Clock', pages: [page(1)] },
    ],
  },
}

const plugins = [
  {
    name: 'UTA_CommonSaveMZ',
    status: true,
    description: '',
    parameters: { targetSwitches: '["2-4"]' },
  },
]

const fakeRuntime = (switches: Map<number, boolean>, calls: Array<string>) =>
  Effect.gen(function* () {
    const lost = yield* Deferred.make<void>()

    const snapshot = {
      ready: true,
      gold: 0,
      maxGold: 9999,
      hpMode: 'none',
      fontSize: null,
      defaultFontSize: 24,
      speed: 1,
    }

    const ids = (args: ReadonlyArray<RuntimeArgument>) =>
      Array.isArray(args[0]) ? args[0].map((id) => Number(id)) : []

    const commands: Record<string, (args: ReadonlyArray<RuntimeArgument>) => unknown> = {
      install: () => ({ snapshot, unsupported: {} }),
      snapshot: () => snapshot,
      sharedSwitches: () => null,
      switchValues: (args) => ids(args).map((id) => switches.get(id) === true),
      unlockMemories: (args) => {
        calls.push(`unlock ${ids(args).join(',')}`)

        for (const id of ids(args)) {
          switches.set(id, true)
        }

        return { saved: true }
      },
    }

    const call = (name: string, args: ReadonlyArray<RuntimeArgument> = []) =>
      Effect.suspend(() => {
        const run = commands[name]

        return run === undefined
          ? Effect.fail(new LiveControlsError({ reason: 'invalid', message: name }))
          : Effect.succeed(run(args))
      })

    return { call, lost: Deferred.await(lost) } satisfies GameRuntime
  })

const setup = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folderPath = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-memories-' })
  const switches = new Map([[2, true]])
  const calls: Array<string> = []

  yield* fs.makeDirectory(path.join(folderPath, 'data'), { recursive: true })
  yield* fs.makeDirectory(path.join(folderPath, 'js'), { recursive: true })

  for (const [name, data] of Object.entries(dataFiles)) {
    yield* fs.writeFileString(
      path.join(folderPath, 'data', name),
      yield* Effect.orDie(encodeJson(data)),
    )
  }

  yield* fs.writeFileString(
    path.join(folderPath, 'js', 'plugins.js'),
    `var $plugins =\n${yield* Effect.orDie(encodeJson(plugins))};\n`,
  )

  const connector = Layer.succeed(GameConnector)({
    prepare: () => Effect.succeed({ args: [], connect: () => fakeRuntime(switches, calls) }),
    attach: () => Effect.succeed({ args: [], connect: () => fakeRuntime(switches, calls) }),
    isRunning: () => Effect.succeed(true),
    recover: () => Effect.void,
  })

  const layer = MemoriesRpcLive.pipe(
    Layer.provideMerge(
      LiveControls.layerWith({ installEvery: '5 millis', installAttempts: 5, poll: '50 millis' }),
    ),
    Layer.provide(connector),
    Layer.provideMerge(GameData.layer),
    Layer.provideMerge(Games.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
    Layer.provideMerge(NodeServices.layer),
  )

  const services = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(MemoriesRpc).pipe(Effect.provide(services))
  const games = yield* Games.pipe(Effect.provide(services))
  const live = yield* LiveControls.pipe(Effect.provide(services))

  const game = yield* games.add(
    GameCandidate.make({
      title: 'Smith Sister',
      folderPath,
      executablePath: path.join(folderPath, 'Game.exe'),
      engine: 'rpg-maker-mz',
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  yield* live.attach(game.id, 10)

  return { client, switches, calls }
})

const eventually = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.retry({ schedule: Schedule.spaced('20 millis'), times: 100 }))

describe('Memories', () => {
  it.live('finds the scene switches of the running game and which are unlocked', () =>
    Effect.gen(function* () {
      const { client } = yield* setup()
      const memories = yield* eventually(client.findMemories())

      expect(memories.sharedSave).toBe('UTA_CommonSaveMZ')
      expect(memories.rooms).toEqual(['回想ルーム'])

      expect(memories.switches.map((entry) => [entry.id, entry.unlocked, entry.suggested])).toEqual(
        [
          [1, false, false],
          [2, true, true],
          [3, false, true],
          [4, false, true],
        ],
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('unlocks the chosen switches and says the shared save keeps them', () =>
    Effect.gen(function* () {
      const { client, switches, calls } = yield* setup()

      yield* eventually(client.findMemories())

      expect(yield* client.unlockMemories({ switchIds: [3, 4, 3] })).toEqual({
        unlocked: 2,
        persisted: true,
      })

      expect(calls).toEqual(['unlock 3,4'])
      expect(switches.get(4)).toBe(true)

      expect(yield* client.unlockMemories({ switchIds: [1] })).toEqual({
        unlocked: 1,
        persisted: false,
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
