import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { RpcTest } from 'effect/rpc'
import { GameCandidate, LibraryRpc } from '#contract/Library'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { GameData } from '../rpgmaker/GameData'
import { Games } from './Games'
import { LibraryRpcLive } from './Library'
import { LocaleDetector } from './LocaleDetector'
import { ansiWindow, japanese, makeMvGame, program, TestLauncher } from './TestGames'

const TestLayer = LibraryRpcLive.pipe(
  Layer.provideMerge(TestLauncher),
  Layer.provideMerge(Games.layer),
  Layer.provideMerge(GameData.layer),
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
  Layer.provideMerge(NodeServices.layer),
)

const Detecting = Layer.merge(
  TestLauncher,
  LocaleDetector.layerWith({ systemCodePage: Effect.succeed(Option.some(1252)) }),
)

const StoreLayer = Games.layer.pipe(
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
  Layer.provideMerge(NodeServices.layer),
)

const DetectingLayer = LibraryRpcLive.pipe(
  Layer.provideMerge(Detecting),
  Layer.provideMerge(GameData.layer),
  Layer.provideMerge(StoreLayer),
)

const client = RpcTest.makeClient(LibraryRpc)

describe('Library', () => {
  it.effect('inspects an MV game: title, launcher, engine, size and dialogue length', () =>
    Effect.gen(function* () {
      const library = yield* client
      const path = yield* Path.Path
      const folder = yield* makeMvGame(['こんにちは。', '元気ですか？'])
      const candidate = yield* library.inspectFolder({ path: path.join(folder, 'Game.exe') })

      expect(candidate).toMatchObject({
        title: '魔法の森',
        folderPath: folder,
        executablePath: path.join(folder, 'Game.exe'),
        engine: 'rpg-maker-mv',
        translation: 'original',
        text: { language: 'Japanese', dialogueCharacters: 12, readingMinutes: 1 },
      })

      assert.isAbove(candidate.sizeBytes, 0)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.effect('recognises RPG Maker XP and VX games by their engine library and archive', () =>
    Effect.gen(function* () {
      const library = yield* client
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const makeRgssGame = Effect.fnUntraced(function* (library: string, archive: string) {
        const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-game-' })

        yield* fs.writeFileString(
          path.join(folder, 'Game.ini'),
          `[Game]\nLibrary=${library}\nTitle=Old Game\n`,
        )

        yield* fs.writeFileString(path.join(folder, archive), 'RGSSAD')
        yield* fs.writeFileString(path.join(folder, 'Game.exe'), 'MZ')

        return folder
      })

      const xp = yield* makeRgssGame('RGSS104E.dll', 'Game.rgssad')
      const vx = yield* makeRgssGame('System\\RGSS202J.dll', 'Game.rgss2a')

      const engines = yield* Effect.forEach([xp, vx], (folder) =>
        Effect.map(library.inspectFolder({ path: folder }), (candidate) => candidate.engine),
      )

      expect(engines).toEqual(['rpg-maker-xp', 'rpg-maker-vx'])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.effect('explains folders that are not games', () =>
    Effect.gen(function* () {
      const library = yield* client
      const fs = yield* FileSystem.FileSystem
      const empty = yield* fs.makeTempDirectoryScoped()

      const missing = yield* Effect.flip(library.inspectFolder({ path: `${empty}-missing` }))
      const noGame = yield* Effect.flip(library.inspectFolder({ path: empty }))

      expect([missing.message, noGame.message]).toEqual([
        "This folder doesn't exist.",
        "This folder doesn't contain a Windows game (.exe).",
      ])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.effect('adds a game once, renames it and removes it', () =>
    Effect.gen(function* () {
      const library = yield* client
      const folder = yield* makeMvGame(['やあ'])
      const game = yield* library.addGame({ path: folder })
      const path = yield* Path.Path

      const sameFolder =
        process.platform === 'win32' ? folder.toUpperCase() : path.join(folder, 'www', '..')

      const duplicate = yield* Effect.flip(library.addGame({ path: sameFolder }))

      expect(duplicate).toMatchObject({
        reason: 'conflict',
        message: '“魔法の森” is already in the library.',
      })

      const renamed = yield* library.updateGame({
        id: game.id,
        title: ' Magic Forest ',
        notes: '  ',
      })

      expect([renamed.title, renamed.notes]).toEqual(['Magic Forest', undefined])
      expect((yield* library.listGames()).map((listed) => listed.title)).toEqual(['Magic Forest'])

      yield* library.removeGame({ id: game.id })

      expect(yield* library.listGames()).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.live('explains a launcher that will not start', () =>
    Effect.gen(function* () {
      const library = yield* client
      const folder = yield* makeMvGame(['やあ'])
      const game = yield* library.addGame({ path: folder })
      const error = yield* Effect.flip(library.launchGame({ id: game.id }))

      expect(error).toMatchObject({ reason: 'failed', message: '魔法の森 could not be started.' })
      expect((yield* library.listGames())[0]?.launchCount).toBe(0)
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.effect('remembers how each game is started', () =>
    Effect.gen(function* () {
      const library = yield* client
      const folder = yield* makeMvGame(['やあ'])
      const game = yield* library.addGame({ path: folder })

      expect(game).toMatchObject({ locale: 'auto', needsJapaneseLocale: false })

      const updated = yield* library.setLaunchLocale({ id: game.id, locale: 'ntleas' })

      expect(updated.locale).toBe('ntleas')
      expect((yield* library.listGames())[0]?.locale).toBe('ntleas')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )

  it.effect('notes a game built for Japanese Windows when it is added', () =>
    Effect.gen(function* () {
      const library = yield* client
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-game-' })

      yield* fs.writeFile(
        path.join(folder, 'kabef.exe'),
        program({ imports: ansiWindow, languages: [japanese] }),
      )

      const game = yield* library.addGame({ path: folder })

      expect(game).toMatchObject({ locale: 'auto', needsJapaneseLocale: true })
    }).pipe(Effect.scoped, Effect.provide(DetectingLayer)),
  )

  it.effect('checks games that were in the library before programs were checked', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-game-' })
      const executablePath = path.join(folder, 'kabef.exe')

      yield* fs.writeFile(executablePath, program({ imports: ansiWindow, languages: [japanese] }))

      const stored = yield* Layer.build(StoreLayer)
      const games = Context.get(stored, Games)

      const candidate = (title: string, executable: string) =>
        GameCandidate.make({
          title,
          folderPath: path.dirname(executable),
          executablePath: executable,
          engine: 'windows',
          sizeBytes: 1,
          translation: 'original',
        })

      const old = yield* games.add(candidate('Old', executablePath))
      const unplugged = yield* games.add(candidate('Away', path.join(folder, 'away', 'Game.exe')))

      expect(old.needsJapaneseLocale).toBe(false)

      yield* Layer.build(
        LibraryRpcLive.pipe(
          Layer.provide(Detecting),
          Layer.provide(GameData.layer),
          Layer.provide(Layer.succeedContext(stored)),
        ),
      )

      expect((yield* games.get(old.id)).needsJapaneseLocale).toBe(true)
      expect((yield* games.localeUnchecked).map((game) => game.id)).toEqual([unplugged.id])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('builds a CG pack, restoring encrypted pictures', () =>
    Effect.gen(function* () {
      const library = yield* client
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const folder = yield* makeMvGame(['やあ'])
      const game = yield* library.addGame({ path: folder })

      expect(yield* library.listImageFolders({ id: game.id })).toEqual(['pictures', 'faces'])

      const pack = yield* library.createCgPack({ id: game.id, folders: ['pictures'] })
      const restored = yield* fs.readFile(path.join(folder, 'CGPack', 'pictures', 'cg01.png'))

      expect(pack).toEqual({ path: path.join(folder, 'CGPack'), imageCount: 1, skippedCount: 1 })
      expect([...restored.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      expect([...restored.subarray(16)]).toEqual([7, 7, 7])
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )
})
