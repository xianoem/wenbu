import { Context, Effect, type FileSystem, Layer, type Path, type Scope } from 'effect'
import type { HttpClient } from 'effect/http'
import type { Game } from '#contract/Library'
import { attachesToRunningGame, LiveControlsError } from '#contract/LiveControls'
import { LunaHookHost } from '../overlay/LunaHookHost'
import type { GameRuntime } from './GameRuntime'
import { connectNwjs, planLaunch, restoreFiles } from './NwjsRuntime'
import { connectRgss, type RgssBridge } from './RgssRuntime'

export interface Connector {
  readonly args: ReadonlyArray<string>
  readonly connect: (
    processId: number,
  ) => Effect.Effect<GameRuntime, LiveControlsError, Scope.Scope>
}

const unsupported = (message: string) => new LiveControlsError({ reason: 'unsupported', message })

export class GameConnector extends Context.Service<
  GameConnector,
  {
    readonly prepare: (game: Game) => Effect.Effect<Connector, LiveControlsError>
    readonly attach: (game: Game) => Effect.Effect<Connector, LiveControlsError>
    readonly isRunning: (processId: number) => Effect.Effect<boolean>
    readonly recover: (game: Game) => Effect.Effect<void>
  }
>()('wenbu/core/livecontrols/GameConnector') {
  static readonly layer = Layer.effect(
    GameConnector,
    Effect.gen(function* () {
      const host = yield* LunaHookHost

      const context = yield* Effect.context<
        RgssBridge | FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
      >()

      const rgss: Connector = {
        args: [],
        connect: (processId) => connectRgss(processId).pipe(Effect.provideContext(context)),
      }

      const attach = (game: Game) =>
        attachesToRunningGame(game.engine)
          ? Effect.succeed(rgss)
          : Effect.fail(
              unsupported('MV and MZ games get Live Game Controls only when Wenbu starts them.'),
            )

      const prepare = Effect.fn('GameConnector.prepare')(function* (game: Game) {
        if (attachesToRunningGame(game.engine)) {
          return rgss
        }

        if (game.engine !== 'rpg-maker-mv' && game.engine !== 'rpg-maker-mz') {
          return yield* unsupported('Live Game Controls works with RPG Maker games.')
        }

        const launch = yield* planLaunch(game)

        return {
          args: launch.args,
          connect: () => connectNwjs(game, launch).pipe(Effect.provideContext(context)),
        } satisfies Connector
      })

      return GameConnector.of({
        prepare: (game) => prepare(game).pipe(Effect.provideContext(context)),
        attach,
        isRunning: (processId) =>
          host.processes.pipe(
            Effect.map((processes) => processes.some((process) => process.pid === processId)),
            Effect.orElseSucceed(() => true),
          ),
        recover: (game) =>
          game.engine === 'rpg-maker-mv' || game.engine === 'rpg-maker-mz'
            ? restoreFiles(game).pipe(Effect.provideContext(context), Effect.ignore)
            : Effect.void,
      })
    }),
  )
}
