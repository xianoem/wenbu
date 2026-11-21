import { Config, Context, Effect, Layer, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { GameDataError } from '../rpgmaker/GameDataError'
import { platformKey } from '../plugins/PluginDefinition'

/** The bundled WOLF RPG tools: UberWolf unpacks a game's archives, WolfTL reads and patches its text. */
export class WolfTools extends Context.Service<
  WolfTools,
  {
    /** Unpacks every archive of the game next to itself, the way the game's own folders are laid out. */
    readonly unpack: (program: string) => Effect.Effect<void, GameDataError>
    /** Writes the text of the data folder as JSON into `output/dump`. */
    readonly dump: (dataFolder: string, output: string) => Effect.Effect<void, GameDataError>
    /** Writes the data folder patched with `output/dump` into `output/patched/data`. */
    readonly patch: (dataFolder: string, output: string) => Effect.Effect<void, GameDataError>
  }
>()('wenbu/core/wolf/WolfTools') {
  static readonly layer = (toolsFolder: Effect.Effect<string, GameDataError, Path.Path>) =>
    Layer.effect(
      WolfTools,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const path = yield* Path.Path

        const run = Effect.fnUntraced(function* (
          tool: string,
          args: ReadonlyArray<string>,
          what: string,
        ) {
          const folder = yield* Effect.provideService(toolsFolder, Path.Path, path)
          const command = path.join(folder, tool)

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make(command, args, {
                  stdin: 'ignore',
                  stdout: 'pipe',
                  stderr: 'pipe',
                }),
              )

              const output = yield* handle.all.pipe(Stream.decodeText, Stream.mkString)
              const exitCode = yield* handle.exitCode

              if (exitCode !== 0) {
                const tail = output.trim().split(/\r?\n/).slice(-2).join(' ').trim()

                return yield* new GameDataError({
                  message: tail === '' ? `${what} failed.` : `${what} failed: ${tail}`,
                })
              }
            }),
          ).pipe(
            Effect.catchTag('PlatformError', () =>
              Effect.fail(new GameDataError({ message: `${what} could not be started.` })),
            ),
          )
        })

        return {
          unpack: (program) => run('UberWolfCli.exe', [program], "Unpacking the game's archives"),
          dump: (dataFolder, output) =>
            run('WolfTL.exe', [dataFolder, output, '--create'], "Reading the game's text"),
          patch: (dataFolder, output) =>
            run(
              'WolfTL.exe',
              [dataFolder, output, '--patch', '--skip-game_dat'],
              "Writing the game's text",
            ),
        }
      }),
    )

  /** The tools shipped with Wenbu. The folder is looked up only when a tool runs. */
  static readonly live = WolfTools.layer(
    Effect.gen(function* () {
      const path = yield* Path.Path

      const resources = yield* Config.String('WENBU_RESOURCES_DIR').pipe(
        Effect.mapError(
          () => new GameDataError({ message: "Wenbu's WOLF RPG tools could not be found." }),
        ),
      )

      return path.join(resources, 'native', platformKey, 'wolf')
    }),
  )
}
