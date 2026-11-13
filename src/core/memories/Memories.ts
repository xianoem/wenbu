import { Effect, FileSystem, Option, Path, Predicate, Ref, Schema } from 'effect'
import { type Game, isTranslatable } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { type Memories, MemoriesRpc } from '#contract/Memories'
import { LiveControls } from '../livecontrols/LiveControls'
import type { GameRuntime } from '../livecontrols/GameRuntime'
import { GameData } from '../rpgmaker/GameData'
import type { RpgData } from '../rpgmaker/RpgData'
import {
  type GameMemoryData,
  parsePluginList,
  type Plugin,
  planMemories,
  recollectionModeSwitches,
  roomMapsOf,
  type SharedSave,
  sharedSaveOf,
} from './MemoryDetection'

const SharedSwitches = Schema.NullOr(
  Schema.Struct({ name: Schema.String, switchIds: Schema.Array(Schema.Int) }),
)

const SwitchValues = Schema.Array(Schema.Boolean)

const Unlocked = Schema.Struct({ saved: Schema.Boolean })

const RecollectionScenes = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ switch_id: Schema.Int })),
)

const failed = (message: string) => new LiveControlsError({ reason: 'failed', message })

const unreadable = () => failed('The game answered with data Wenbu could not read.')

const answer =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  <E, R>(effect: Effect.Effect<unknown, E, R>) =>
    Effect.flatMap(effect, (value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(unreadable)),
    )

const mapFileName = (mapId: number, engine: Game['engine']) =>
  `Map${String(mapId).padStart(3, '0')}.${engine === 'rpg-maker-vx-ace' ? 'rvdata2' : 'json'}`

const switchNamesOf = (system: RpgData | undefined) => {
  const switches =
    Predicate.isObject(system) && 'switches' in system ? system['switches'] : undefined

  return Array.isArray(switches)
    ? switches.map((name) => (Predicate.isString(name) ? name : ''))
    : []
}

export const MemoriesRpcLive = MemoriesRpc.toLayer(
  Effect.gen(function* () {
    const live = yield* LiveControls
    const gameData = yield* GameData
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cache = yield* Ref.make(new Map<string, GameMemoryData>())

    const readText = (file: string) =>
      fs.readFileString(file).pipe(Effect.option, Effect.map(Option.getOrUndefined))

    const webRoot = (game: Game) =>
      game.engine === 'rpg-maker-mv' ? path.join(game.folderPath, 'www') : game.folderPath

    const recollectionSwitchesOf = Effect.fnUntraced(function* (
      game: Game,
      plugins: ReadonlyArray<Plugin>,
    ) {
      const ids: Array<number> = []

      for (const plugin of plugins.filter((entry) => entry.status)) {
        const name = plugin.name.split('/').at(-1)

        if (name === 'RecollectionModeMZ') {
          const listName = plugin.parameters['recoCgSettingList']
          const fileName = Predicate.isString(listName) ? listName : 'RecollectionModeMZData.json'
          const text = yield* readText(path.join(webRoot(game), 'img', 'system', fileName))

          const scenes = Option.getOrElse(
            Schema.decodeUnknownOption(RecollectionScenes)(text?.replace(/^﻿/, '')),
            () => [],
          )

          ids.push(...scenes.map((scene) => scene.switch_id))
        }

        if (name === 'RecollectionMode') {
          const source = yield* readText(
            path.join(webRoot(game), 'js', 'plugins', `${plugin.name}.js`),
          )

          ids.push(...recollectionModeSwitches(source ?? ''))
        }
      }

      return ids
    })

    const readGame = Effect.fnUntraced(function* (game: Game) {
      const files = new Map<string, RpgData>()

      yield* gameData.forEachOriginal(
        game,
        (name) => /^(System|MapInfos|CommonEvents)\./i.test(name),
        (name, data) => Effect.sync(() => files.set(name.split('.')[0] ?? name, data)),
      )

      const roomIds = new Set(roomMapsOf(files.get('MapInfos')).map((room) => room.id))
      const roomFiles = new Map([...roomIds].map((id) => [mapFileName(id, game.engine), id]))
      const maps = new Map<number, RpgData>()

      yield* gameData.forEachOriginal(
        game,
        (name) => roomFiles.has(name),
        (name, data) => Effect.sync(() => maps.set(roomFiles.get(name) ?? 0, data)),
      )

      const plugins =
        game.engine === 'rpg-maker-vx-ace'
          ? []
          : parsePluginList((yield* readText(path.join(webRoot(game), 'js', 'plugins.js'))) ?? '')

      return {
        switchNames: switchNamesOf(files.get('System')),
        mapInfos: files.get('MapInfos'),
        maps,
        commonEvents: files.get('CommonEvents'),
        plugins,
        recollectionSwitches: yield* recollectionSwitchesOf(game, plugins),
      } satisfies GameMemoryData
    })

    const dataOf = Effect.fnUntraced(function* (game: Game) {
      const cached = (yield* Ref.get(cache)).get(game.id)

      if (cached !== undefined) {
        return cached
      }

      const data = yield* readGame(game).pipe(Effect.mapError((error) => failed(error.message)))

      yield* Ref.update(cache, (all) => new Map(all).set(game.id, data))

      return data
    })

    const connected = Effect.flatMap(live.session, (session) => {
      if (Option.isNone(session)) {
        return Effect.fail(
          new LiveControlsError({
            reason: 'not-connected',
            message: 'Live Game Controls is not connected to a game.',
          }),
        )
      }

      if (!isTranslatable(session.value.game.engine)) {
        return Effect.fail(
          new LiveControlsError({
            reason: 'unsupported',
            message: 'Wenbu finds memories in RPG Maker MV, MZ and VX Ace games.',
          }),
        )
      }

      return Effect.succeed(session.value)
    })

    const sharedSaveIn = (runtime: GameRuntime, data: GameMemoryData) =>
      runtime.call('sharedSwitches').pipe(
        answer(SharedSwitches),
        Effect.map((shared): SharedSave | undefined => shared ?? sharedSaveOf(data.plugins)),
      )

    const findMemories = Effect.fn('Memories.find')(function* () {
      const { game, runtime } = yield* connected
      const data = yield* dataOf(game)
      const sharedSave = yield* sharedSaveIn(runtime, data)
      const found = planMemories(data, [], sharedSave)
      const ids = found.switches.map((entry) => entry.id)

      const values = yield* runtime.call('switchValues', [ids]).pipe(
        answer(SwitchValues),
        Effect.catchIf(
          (error) => error.reason === 'not-ready',
          () => Effect.succeed([]),
        ),
      )

      return planMemories(
        data,
        ids.filter((_, index) => values[index] === true),
        sharedSave,
      ) satisfies Memories
    })

    const unlockMemories = Effect.fn('Memories.unlock')(function* (
      switchIds: ReadonlyArray<number>,
    ) {
      const { game, runtime } = yield* connected
      const ids = [...new Set(switchIds.filter((id) => id > 0))]

      if (ids.length === 0) {
        return yield* new LiveControlsError({
          reason: 'invalid',
          message: 'Pick a scene to unlock.',
        })
      }

      const sharedSave = yield* sharedSaveIn(runtime, yield* dataOf(game))
      const shared = new Set(sharedSave?.switchIds ?? [])

      const { saved } = yield* runtime.call('unlockMemories', [ids]).pipe(answer(Unlocked))

      yield* Effect.logInfo('Memories unlocked').pipe(
        Effect.annotateLogs({ feature: 'memories', game: game.id, switches: ids.length, saved }),
      )

      return { unlocked: ids.length, persisted: saved && ids.every((id) => shared.has(id)) }
    })

    return MemoriesRpc.of({
      findMemories: () => findMemories(),
      unlockMemories: ({ switchIds }) => unlockMemories(switchIds),
    })
  }),
)
