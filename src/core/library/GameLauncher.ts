import {
  Clock,
  Context,
  Deferred,
  type Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Scope,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { type Game, LibraryError, type StartLocale, startLocaleOf } from '#contract/Library'
import { matchGameProcesses } from '../overlay/GameProcesses'
import { LunaHookHost } from '../overlay/LunaHookHost'
import { localeTools, machineOf } from '../plugins/definitions/LunaHook'
import { Plugins } from '../plugins/Plugins'
import { Games } from './Games'
import { LaunchAlias } from './LaunchAlias'

export interface Launch {
  readonly game: Game
  readonly locale: StartLocale
  readonly processId: number
  readonly gameProcessId: Effect.Effect<Option.Option<number>>
  readonly exited: Effect.Effect<GameExit>
}

export interface LaunchPlan {
  readonly args: ReadonlyArray<string>
  readonly started: (launch: Launch) => Effect.Effect<void>
}

export const plainLaunch: LaunchPlan = { args: [], started: () => Effect.void }

export class LaunchHooks extends Context.Service<
  LaunchHooks,
  { readonly plan: (game: Game) => Effect.Effect<LaunchPlan> }
>()('wenbu/core/library/LaunchHooks') {
  static readonly none = Layer.succeed(LaunchHooks)({ plan: () => Effect.succeed(plainLaunch) })
}

export interface GameExit {
  readonly seconds: number
  readonly found: boolean
}

export interface LaunchTiming {
  readonly poll: Duration.Input
  readonly searchFor: Duration.Input
}

const failed = (message: string) => new LibraryError({ reason: 'failed', message })

const lunaHookMissing = () =>
  new LibraryError({
    reason: 'not-ready',
    message: 'Install LunaHook in Settings → Plugins to start games in a Japanese locale.',
  })

const ntleasArguments = ['C932', 'L1041', 'FMS PGothic', 'P4']

export const japaneseProfile = (config: string) => {
  for (const [, attributes = '', body = ''] of config.matchAll(
    /<Profile\b([^>]*)>([\s\S]*?)<\/Profile>/g,
  )) {
    const guid = /\bGuid="([^"]+)"/.exec(attributes)?.[1]

    if (guid !== undefined && /<Location>\s*ja-JP\s*<\/Location>/i.test(body)) {
      return guid
    }
  }

  return undefined
}

const secondsSince = (startedAt: number) =>
  Effect.map(Clock.currentTimeMillis, (now) => Math.max(1, Math.round((now - startedAt) / 1000)))

export class GameLauncher extends Context.Service<
  GameLauncher,
  { readonly launch: (id: string) => Effect.Effect<Launch, LibraryError> }
>()('wenbu/core/library/GameLauncher') {
  static readonly layerWith = (timing: LaunchTiming) =>
    Layer.effect(
      GameLauncher,
      Effect.gen(function* () {
        const games = yield* Games
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const plugins = yield* Plugins
        const host = yield* LunaHookHost
        const hooks = yield* LaunchHooks
        const aliases = yield* LaunchAlias
        const layerScope = yield* Scope.Scope

        const toolPath = (folder: string, relative: string) =>
          path.join(folder, ...relative.split('/'))

        const isThirtyTwoBit = (game: Game) =>
          Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(game.executablePath)
              const header = yield* file.readAlloc(4096)

              return Option.isSome(header) && machineOf(header.value) === 0x14c
            }),
          ).pipe(Effect.mapError(() => failed(`${game.title}'s program could not be read.`)))

        const commandFor = Effect.fnUntraced(function* (
          game: Game,
          locale: StartLocale,
          folder: Option.Option<string>,
          executablePath: string,
          gameArgs: ReadonlyArray<string>,
        ) {
          if (locale === 'system') {
            return { command: executablePath, args: gameArgs }
          }

          if (Option.isNone(folder)) {
            return yield* lunaHookMissing()
          }

          if (locale === 'ntleas') {
            const tool = (yield* isThirtyTwoBit(game))
              ? localeTools.ntleas.x86
              : localeTools.ntleas.x64

            return {
              command: toolPath(folder.value, tool),
              args: [
                executablePath,
                ...(gameArgs.length > 0 ? [`A${gameArgs.join(' ')}`] : []),
                ...ntleasArguments,
              ],
            }
          }

          const remulator = toolPath(folder.value, localeTools.localeRemulator)

          const config = yield* fs
            .readFileString(path.join(path.dirname(remulator), 'LRConfig.xml'))
            .pipe(Effect.mapError(() => lunaHookMissing()))

          const guid = japaneseProfile(config)

          if (guid === undefined) {
            return yield* failed("Locale Remulator's settings have no Japanese profile.")
          }

          return { command: remulator, args: [guid, executablePath, ...gameArgs] }
        })

        const findGame = (game: Game, toolPid: number) =>
          host.processes.pipe(
            Effect.map((processes) =>
              matchGameProcesses(game, aliases.resolve(game, processes)).find(
                (match) =>
                  match.processId !== toolPid &&
                  match.matchReason !== 'Process name matches this game executable.',
              ),
            ),
            Effect.orElseSucceed(() => undefined),
          )

        const isRunning = (pid: number) =>
          host.processes.pipe(
            Effect.map((processes) => processes.some((process) => process.pid === pid)),
            Effect.orElseSucceed(() => false),
          )

        /** Locale tools exit once the game is up, so the game's own process is looked up. */
        const waitForGame = Effect.fnUntraced(function* (
          game: Game,
          toolPid: number,
          gameProcess: Deferred.Deferred<Option.Option<number>>,
        ) {
          const found = yield* findGame(game, toolPid).pipe(
            Effect.repeat({
              schedule: Schedule.spaced(timing.poll),
              until: (match) => match !== undefined,
            }),
            Effect.timeoutOption(timing.searchFor),
          )

          const match = Option.flatMap(found, Option.fromNullishOr)

          yield* Deferred.succeed(
            gameProcess,
            Option.map(match, (process) => process.processId),
          )

          if (Option.isNone(match)) {
            return false
          }

          yield* isRunning(match.value.processId).pipe(
            Effect.repeat({ schedule: Schedule.spaced(timing.poll), while: (running) => running }),
          )

          return true
        })

        const launch = Effect.fn('GameLauncher.launch')(function* (id: string) {
          const game = yield* games.get(id)
          const plan = yield* hooks.plan(game)
          const paths = yield* aliases.prepare(game)
          const folder = yield* plugins.installedFolder('luna-hook')
          const locale = startLocaleOf(game, Option.isSome(folder))

          const { command, args } = yield* commandFor(
            game,
            locale,
            folder,
            paths.executablePath,
            plan.args,
          )

          const processScope = yield* Scope.make()

          // Node throws from `spawn` for files Windows can't run, which arrives as a defect.
          const handle = yield* spawner
            .spawn(
              ChildProcess.make(command, args, {
                cwd: path.dirname(paths.executablePath),
                detached: true,
                stdin: 'ignore',
                stdout: 'ignore',
                stderr: 'ignore',
              }),
            )
            .pipe(
              Scope.provide(processScope),
              Effect.catchCause((cause) =>
                Effect.logWarning('Game could not be started', cause).pipe(
                  Effect.annotateLogs({ game: id, engine: game.engine }),
                  Effect.andThen(Scope.close(processScope, Exit.void)),
                  Effect.andThen(failed(`${game.title} could not be started.`)),
                ),
              ),
            )

          yield* Effect.orDie(Effect.asVoid(handle.unref))
          yield* games.recordLaunch(id)

          yield* Effect.logInfo('Game launched').pipe(
            Effect.annotateLogs({
              game: id,
              engine: game.engine,
              locale,
              aliased: paths.folderPath !== game.folderPath,
              pid: handle.pid,
              hookArgs: plan.args.length,
            }),
          )

          const startedAt = yield* Clock.currentTimeMillis
          const exited = yield* Deferred.make<GameExit>()
          const gameProcess = yield* Deferred.make<Option.Option<number>>()
          const processId = Number(handle.pid)

          if (locale === 'system') {
            yield* Deferred.succeed(gameProcess, Option.some(processId))
          }

          const ran =
            locale === 'system'
              ? Effect.as(Effect.ignore(handle.exitCode), true)
              : waitForGame(game, processId, gameProcess)

          yield* ran.pipe(
            Effect.flatMap((found) =>
              Effect.map(secondsSince(startedAt), (seconds): GameExit => ({ seconds, found })),
            ),
            Effect.tap((exit) => (exit.found ? games.recordPlay(id, exit.seconds) : Effect.void)),
            Effect.tap((exit) =>
              Effect.logInfo('Game exited').pipe(
                Effect.annotateLogs({
                  feature: 'library',
                  game: id,
                  seconds: exit.seconds,
                  found: exit.found,
                }),
              ),
            ),
            Effect.flatMap((exit) => Deferred.succeed(exited, exit)),
            Effect.ensuring(
              Effect.andThen(
                Deferred.succeed(gameProcess, Option.none()),
                Scope.close(processScope, Exit.void),
              ),
            ),
            Effect.forkIn(layerScope),
          )

          const launch = {
            game,
            locale,
            processId,
            gameProcessId: Deferred.await(gameProcess),
            exited: Deferred.await(exited),
          } satisfies Launch

          yield* Effect.forkIn(plan.started(launch), layerScope)

          return launch
        })

        return GameLauncher.of({ launch })
      }),
    )

  static readonly layer = GameLauncher.layerWith({ poll: '1 second', searchFor: '20 seconds' })
}
