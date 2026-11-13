// Effect's FileSystem only makes symlinks, which Windows keeps for administrators.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { symlink } from 'node:fs/promises'
import { type Cause, Config, Context, Effect, FileSystem, Layer, Path } from 'effect'
import type { Game } from '#contract/Library'
import type { RunningProcess } from '../overlay/GameProcesses'

export interface LaunchPaths {
  readonly folderPath: string
  readonly executablePath: string
}

type AliasedGame = Pick<Game, 'id' | 'folderPath' | 'executablePath'>

export type LinkFolder = (target: string, link: string) => Effect.Effect<void, Cause.UnknownError>

export const linkWithNode: LinkFolder = (target, link) =>
  Effect.tryPromise(() => symlink(target, link, 'junction'))

const isPlain = (text: string) => /^[ -~]*$/.test(text)

const comparable = (path: string) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()

/** Games built for Japanese Windows fail on a Japanese path elsewhere, even with a locale tool. */
export class LaunchAlias extends Context.Service<
  LaunchAlias,
  {
    readonly prepare: (game: AliasedGame) => Effect.Effect<LaunchPaths>
    readonly resolve: (
      game: AliasedGame,
      processes: ReadonlyArray<RunningProcess>,
    ) => ReadonlyArray<RunningProcess>
  }
>()('wenbu/core/library/LaunchAlias') {
  static readonly layerWith = (options: {
    readonly roots: ReadonlyArray<string>
    readonly link: LinkFolder
  }) =>
    Layer.effect(
      LaunchAlias,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = options.roots.find((candidate) => isPlain(candidate))

        const aliasOf = (game: AliasedGame): LaunchPaths | undefined => {
          if (root === undefined || isPlain(game.executablePath)) {
            return undefined
          }

          const executable = path.relative(game.folderPath, game.executablePath)

          if (executable.startsWith('..') || path.isAbsolute(executable)) {
            return undefined
          }

          const folderPath = path.join(root, game.id)

          return { folderPath, executablePath: path.join(folderPath, executable) }
        }

        const pointsAt = (link: string, target: string) =>
          Effect.zipWith(
            fs.realPath(link),
            fs.realPath(target),
            (linked, wanted) => comparable(linked) === comparable(wanted),
          ).pipe(Effect.orElseSucceed(() => false))

        const prepare = Effect.fn('LaunchAlias.prepare')(function* (game: AliasedGame) {
          const own: LaunchPaths = {
            folderPath: game.folderPath,
            executablePath: game.executablePath,
          }

          const alias = aliasOf(game)

          if (alias === undefined) {
            return own
          }

          if (yield* pointsAt(alias.folderPath, game.folderPath)) {
            return alias
          }

          // Never recursive: removing a junction that way would empty the game's folder.
          return yield* Effect.ignore(fs.remove(alias.folderPath)).pipe(
            Effect.andThen(fs.makeDirectory(path.dirname(alias.folderPath), { recursive: true })),
            Effect.andThen(options.link(game.folderPath, alias.folderPath)),
            Effect.as(alias),
            Effect.catch((error) =>
              Effect.logWarning('Game folder could not be aliased', error).pipe(
                Effect.annotateLogs({ feature: 'library', game: game.id }),
                Effect.as(own),
              ),
            ),
          )
        })

        const resolve = (game: AliasedGame, processes: ReadonlyArray<RunningProcess>) => {
          const alias = aliasOf(game)

          if (alias === undefined) {
            return processes
          }

          const prefix = `${comparable(alias.folderPath)}\\`

          return processes.map((process) =>
            comparable(process.path).startsWith(prefix)
              ? { ...process, path: game.folderPath + process.path.slice(alias.folderPath.length) }
              : process,
          )
        }

        return LaunchAlias.of({ prepare, resolve })
      }),
    )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const dataDir = yield* Config.String('WENBU_DATA_DIR')
      const shared = yield* Config.String('ALLUSERSPROFILE').pipe(Config.withDefault(''))

      return LaunchAlias.layerWith({
        roots: [
          path.join(dataDir, 'launch'),
          ...(shared === '' ? [] : [path.join(shared, 'Wenbu', 'launch')]),
        ],
        link: linkWithNode,
      })
    }),
  )

  static readonly none = LaunchAlias.layerWith({ roots: [], link: linkWithNode })
}
