import { Effect, FileSystem, Option, type Path } from 'effect'
import { type Game, LibraryError, LibraryRpc } from '#contract/Library'
import { createCgPack, imageFolders } from './CgPack'
import { inspectFolder } from './GameFolder'
import { GameLauncher } from './GameLauncher'
import { listPrograms } from './GamePrograms'
import { Games } from './Games'
import { LocaleDetector } from './LocaleDetector'
import type { GameData } from '../rpgmaker/GameData'

const invalidProgram = (message: string) =>
  new LibraryError({ reason: 'invalid', field: 'program', message })

export const LibraryRpcLive = LibraryRpc.toLayer(
  Effect.gen(function* () {
    const games = yield* Games
    const launcher = yield* GameLauncher
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | GameData>()
    const fs = yield* FileSystem.FileSystem

    const detector = yield* LocaleDetector

    const inspect = (folder: string) => inspectFolder(folder).pipe(Effect.provideContext(services))

    const checkLocale = Effect.fnUntraced(function* (game: Game) {
      const needed = yield* detector.needsJapaneseLocale(game.executablePath)

      if (Option.isSome(needed)) {
        yield* games.setNeedsJapaneseLocale(game.id, needed.value)
      }
    })

    yield* Effect.forEach(yield* games.localeUnchecked, (game) => checkLocale(game), {
      discard: true,
    })

    return LibraryRpc.of({
      listGames: () => games.list,
      inspectFolder: ({ path: folder }) => inspect(folder),
      addGame: Effect.fn('Library.addGame')(function* ({ path: folder }) {
        const game = yield* games.add(yield* inspect(folder))

        yield* checkLocale(game)

        return yield* games.get(game.id)
      }),
      updateGame: ({ id, title, notes }) => games.update(id, title, notes),
      removeGame: ({ id }) => games.remove(id),
      launchGame: ({ id }) => Effect.asVoid(launcher.launch(id)),
      listGamePrograms: Effect.fn('Library.listGamePrograms')(function* ({ id }) {
        const game = yield* games.get(id)

        return yield* listPrograms(game.folderPath, game.title).pipe(
          Effect.provideContext(services),
          Effect.mapError(() => invalidProgram("The game's folder can't be read.")),
        )
      }),
      setGameProgram: Effect.fn('Library.setGameProgram')(function* ({ id, path: program }) {
        yield* games.get(id)

        if (!/\.exe$/i.test(program)) {
          return yield* invalidProgram('Choose a Windows program (.exe).')
        }

        const isFile = yield* fs.stat(program).pipe(
          Effect.map((info) => info.type === 'File'),
          Effect.orElseSucceed(() => false),
        )

        if (!isFile) {
          return yield* invalidProgram('This program no longer exists.')
        }

        const game = yield* games.setExecutable(id, program)

        yield* checkLocale(game)
        yield* launcher.dismissProblem(id)

        return yield* games.get(id)
      }),
      watchLaunchProblem: ({ id }) => launcher.problem(id),
      dismissLaunchProblem: ({ id }) => launcher.dismissProblem(id),
      setLaunchLocale: ({ id, locale }) => games.setLocale(id, locale),
      listImageFolders: Effect.fn('Library.listImageFolders')(function* ({ id }) {
        return yield* imageFolders(yield* games.get(id)).pipe(Effect.provideContext(services))
      }),
      createCgPack: Effect.fn('Library.createCgPack')(function* ({ id, folders }) {
        return yield* createCgPack(yield* games.get(id), folders).pipe(
          Effect.provideContext(services),
        )
      }),
    })
  }),
)
