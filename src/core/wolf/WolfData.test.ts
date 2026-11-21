import * as NodeServices from '@effect/platform-node/NodeServices'
import { expect, layer } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { DiskSpace } from '../platform/DiskSpace'
import { GameData } from '../rpgmaker/GameData'
import { getAt, type RpgData } from '../rpgmaker/RpgData'
import { prepareEntries } from '../rpgmaker/TextEntries'
import { WolfTools } from './WolfTools'

const Json = Schema.fromJsonString(Schema.Unknown)

const message = (index: number, text: string) => ({
  code: 101,
  codeStr: 'Message',
  stringArgs: [text],
  index,
})

/** Sixty messages, so Wenbu can measure the window: twelve and fourteen ems wide, three lines. */
const mapDump = {
  events: [
    {
      id: 0,
      name: '',
      pages: [
        {
          id: 0,
          list: [
            message(0, '@10\n冬子：\n　　はい、お願いします。\n'),
            ...Array.from({ length: 59 }, (_, index) =>
              message(index + 1, `@1\n冬子：\n　　${'あ'.repeat(12)}\n　　${'い'.repeat(14)}`),
            ),
          ],
        },
      ],
    },
  ],
}

/** Stands in for UberWolf and WolfTL: the patched map file holds the JSON it was patched with. */
const FakeTools = Layer.effect(
  WolfTools,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const write = (target: string, text: string) =>
      fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(Effect.andThen(fs.writeFileString(target, text)), Effect.orDie)

    const encode = (value: RpgData) => Effect.orDie(Schema.encodeEffect(Json)(value))

    return {
      unpack: Effect.fnUntraced(function* (program: string) {
        const data = path.join(path.dirname(program), 'Data')

        yield* write(path.join(data, 'BasicData', 'Game.dat'), 'GAME')
        yield* write(path.join(data, 'MapData', 'Map001.mps'), 'MAP')
        yield* write(path.join(data, 'Picture', 'face.png'), 'PNG')
      }),
      dump: Effect.fnUntraced(function* (_dataFolder: string, output: string) {
        yield* write(path.join(output, 'dump', 'mps', 'Map001.json'), yield* encode(mapDump))
        yield* write(path.join(output, 'dump', 'db', 'DataBase.json'), '{"types":[]}')
      }),
      patch: Effect.fnUntraced(function* (_dataFolder: string, output: string) {
        const patched = yield* fs
          .readFileString(path.join(output, 'dump', 'mps', 'Map001.json'))
          .pipe(Effect.orDie)

        yield* write(path.join(output, 'patched', 'data', 'MapData', 'Map001.mps'), patched)
      }),
    }
  }),
)

const TestLayer = GameData.base.pipe(
  Layer.provide(FakeTools),
  Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
  Layer.provideMerge(NodeServices.layer),
)

const makeWolfGame = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-wolf-' })

  yield* fs.writeFileString(path.join(folder, 'Game.exe'), 'MZ')
  yield* fs.writeFileString(path.join(folder, 'Data.wolf'), 'WOLF')

  return { folderPath: folder, engine: 'wolf-rpg' as const }
})

layer(TestLayer)('WOLF RPG game data', (it) => {
  it.effect('reads the text without changing what the game runs', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const gameData = yield* GameData
      const game = yield* makeWolfGame

      const first = (yield* gameData.originalLocations(game)).slice(0, 2)

      expect(first.map((found) => [found.context, found.value])).toEqual([
        ['mps/Map001.json -> events[0] pages[0] -> Speaker Name', '冬子'],
        [
          'mps/Map001.json -> events[0] pages[0] -> Show Text, said by 冬子',
          'はい、お願いします。',
        ],
      ])

      expect((yield* fs.readDirectory(game.folderPath)).toSorted()).toEqual([
        'Data.wenbu-original',
        'Data.wolf',
        'Game.exe',
      ])

      expect(yield* gameData.hasOriginals(game)).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect('writes wrapped translations into loose files, then puts the archive back', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const gameData = yield* GameData
      const game = yield* makeWolfGame

      expect(yield* gameData.saveOriginals(game)).toBe('unpacked')
      expect(yield* fs.exists(path.join(game.folderPath, 'Data.wolf.wenbu-backup'))).toBe(true)
      expect(yield* fs.exists(path.join(game.folderPath, 'Data.wolf'))).toBe(false)

      const prepared = prepareEntries(
        yield* gameData.originalLocations(game),
        defaultTranslationSettings,
      )

      const translations: Record<string, string> = {
        冬子: 'Fuyuko',
        'はい、お願いします。': 'Yes, please take care of the luggage for me.',
      }

      const entries = prepared.entries.map((entry) => ({
        ...entry,
        dst: translations[entry.src] ?? '',
      }))

      const result = yield* gameData.writeTranslations(game, entries, defaultTranslationSettings)

      expect(result.written).toBe(61)

      const patched = yield* fs.readFileString(
        path.join(game.folderPath, 'Data', 'MapData', 'Map001.mps'),
      )

      // SAFETY: the fake patch writes the JSON Wenbu gave it.
      const map = (yield* Schema.decodeUnknownEffect(Json)(patched)) as RpgData

      expect(getAt(map, '/events/0/pages/0/list/0/stringArgs/0')).toBe(
        '@10\nFuyuko:\n　　Yes, please take care of the\n　　luggage for me.\n',
      )

      expect(getAt(map, '/events/0/pages/0/list/0/wenbu')).toBeUndefined()

      yield* gameData.restoreOriginals(game)
      yield* gameData.discardOriginals(game)

      expect((yield* fs.readDirectory(game.folderPath)).toSorted()).toEqual([
        'Data.wolf',
        'Game.exe',
      ])
    }).pipe(Effect.scoped),
  )
})
