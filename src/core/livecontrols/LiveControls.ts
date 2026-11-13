import {
  Context,
  type Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { LiveControlsWindow } from '#contract/CoreMessages'
import type { Game } from '#contract/Library'
import {
  Actor,
  ActorSummary,
  CharacterSpeed,
  characterSpeeds,
  dialogueFontSizes,
  HookedControl,
  HpMode,
  idleLiveControls,
  InventoryEntry,
  type InventoryKind,
  LiveControlsError,
  LiveControlsRpc,
  type LiveControlsState,
  supportsLiveControls,
  SwitchEntry,
  type UnsupportedControl,
  VariableEntry,
  type VariableValue,
} from '#contract/LiveControls'
import { LaunchHooks, type LaunchPlan, plainLaunch } from '../library/GameLauncher'
import { Games } from '../library/Games'
import * as SettingsStore from '../platform/SettingsStore'
import { type Connector, GameConnector } from './GameConnector'
import type { GameRuntime, RuntimeArgument } from './GameRuntime'

export interface LiveControlsTiming {
  readonly installEvery: Duration.Input
  readonly installAttempts: number
  readonly poll: Duration.Input
}

const Snapshot = Schema.Struct({
  ready: Schema.Boolean,
  gold: Schema.Number,
  maxGold: Schema.Number,
  hpMode: HpMode,
  fontSize: Schema.NullOr(Schema.Number),
  defaultFontSize: Schema.Number,
  speed: Schema.Number,
})

type Snapshot = typeof Snapshot.Type

const Installed = Schema.Struct({
  snapshot: Snapshot,
  unsupported: Schema.Record(Schema.String, Schema.String),
})

const Preferences = Schema.Struct({
  fontSize: Schema.optional(Schema.Int),
  speed: Schema.optional(CharacterSpeed),
})

type Preferences = typeof Preferences.Type

const isHookedControl = Schema.is(HookedControl)

export interface ConnectedGame {
  readonly game: Game
  readonly runtime: GameRuntime
}

interface Session {
  readonly id: number
  readonly game: Game
  readonly scope: Scope.Closeable
  readonly connector: Connector
  readonly processId: Ref.Ref<Option.Option<number>>
  readonly runtime: Ref.Ref<Option.Option<GameRuntime>>
  readonly attempt: Ref.Ref<Option.Option<Scope.Closeable>>
}

const notConnected = () =>
  new LiveControlsError({
    reason: 'not-connected',
    message: 'Live Game Controls is not connected to a game.',
  })

const unreadable = () =>
  new LiveControlsError({
    reason: 'failed',
    message: 'The game answered with data Wenbu could not read.',
  })

const answer =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  <E, R>(effect: Effect.Effect<unknown, E, R>) =>
    Effect.flatMap(effect, (value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(unreadable)),
    )

const toSpeed = (value: number) => characterSpeeds.find((speed) => speed === value) ?? 1

const withSnapshot = (state: LiveControlsState, snapshot: Snapshot): LiveControlsState => ({
  ...state,
  ready: snapshot.ready,
  hpMode: snapshot.hpMode,
  gold: snapshot.gold,
  maxGold: snapshot.maxGold,
  dialogueFontSize: Math.round(snapshot.fontSize ?? snapshot.defaultFontSize),
  defaultFontSize: Math.round(snapshot.defaultFontSize),
  characterSpeed: toSpeed(snapshot.speed),
})

const toUnsupported = (reasons: Readonly<Record<string, string>>) =>
  Object.entries(reasons).flatMap(([control, reason]): Array<UnsupportedControl> =>
    isHookedControl(control) ? [{ control, reason }] : [],
  )

const isOpen = (state: LiveControlsState) =>
  state.status === 'connecting' || state.status === 'connected' || state.status === 'disconnected'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const whole = (value: number) => Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0))

export class LiveControls extends Context.Service<
  LiveControls,
  {
    readonly state: Stream.Stream<LiveControlsState>
    readonly sessions: Stream.Stream<Option.Option<ConnectedGame>>
    readonly session: Effect.Effect<Option.Option<ConnectedGame>>
    readonly window: Stream.Stream<LiveControlsWindow>
    readonly plan: (game: Game) => Effect.Effect<LaunchPlan>
    readonly attach: (gameId: string, processId: number) => Effect.Effect<void, LiveControlsError>
    readonly retry: Effect.Effect<void, LiveControlsError>
    readonly stop: Effect.Effect<void>
    readonly setHpMode: (mode: HpMode) => Effect.Effect<void, LiveControlsError>
    readonly setGold: (gold: number) => Effect.Effect<void, LiveControlsError>
    readonly setDialogueFontSize: (size: number) => Effect.Effect<void, LiveControlsError>
    readonly setCharacterSpeed: (speed: CharacterSpeed) => Effect.Effect<void, LiveControlsError>
    readonly reset: Effect.Effect<void, LiveControlsError>
    readonly actors: Effect.Effect<ReadonlyArray<ActorSummary>, LiveControlsError>
    readonly actor: (actorId: number) => Effect.Effect<Actor, LiveControlsError>
    readonly setActorStat: (
      actorId: number,
      key: string,
      value: number,
    ) => Effect.Effect<Actor, LiveControlsError>
    readonly inventory: Effect.Effect<ReadonlyArray<InventoryEntry>, LiveControlsError>
    readonly setInventoryQuantity: (
      kind: InventoryKind,
      id: number,
      quantity: number,
    ) => Effect.Effect<InventoryEntry, LiveControlsError>
    readonly switches: Effect.Effect<ReadonlyArray<SwitchEntry>, LiveControlsError>
    readonly setSwitch: (
      id: number,
      value: boolean,
    ) => Effect.Effect<SwitchEntry, LiveControlsError>
    readonly variables: Effect.Effect<ReadonlyArray<VariableEntry>, LiveControlsError>
    readonly setVariable: (
      id: number,
      value: VariableValue,
    ) => Effect.Effect<VariableEntry, LiveControlsError>
  }
>()('wenbu/core/livecontrols/LiveControls') {
  static readonly layerWith = (timing: LiveControlsTiming) =>
    Layer.effect(
      LiveControls,
      Effect.gen(function* () {
        const games = yield* Games
        const connector = yield* GameConnector
        const store = SettingsStore.make(yield* KeyValueStore.KeyValueStore, Preferences, {})
        const layerScope = yield* Scope.Scope
        const state = yield* SubscriptionRef.make<LiveControlsState>(idleLiveControls)
        const active = yield* Ref.make<Option.Option<Session>>(Option.none())
        const sessionCount = yield* Ref.make(0)
        const connected = yield* SubscriptionRef.make(Option.none<ConnectedGame>())

        const patch = (f: (current: LiveControlsState) => LiveControlsState) =>
          SubscriptionRef.update(state, f)

        const preferenceKey = (game: Game) => `live-controls:${game.id}`

        const preferences = (game: Game) =>
          store.get(preferenceKey(game)).pipe(Effect.orElseSucceed((): Preferences => ({})))

        const savePreferences = (game: Game, change: (current: Preferences) => Preferences) =>
          Effect.flatMap(preferences(game), (current) =>
            Effect.ignore(store.set(preferenceKey(game), change(current))),
          )

        const isCurrent = (session: Session) =>
          Effect.map(
            Ref.get(active),
            Option.exists((current) => current.id === session.id),
          )

        const end = Effect.fnUntraced(function* (session: Session, message: string) {
          if (!(yield* isCurrent(session))) {
            return
          }

          yield* Ref.set(active, Option.none())
          yield* SubscriptionRef.set(connected, Option.none())
          yield* patch(() => ({ ...idleLiveControls, status: 'stopped', message }))
          yield* Effect.forkIn(Scope.close(session.scope, Exit.void), layerScope)
        })

        const install = (runtime: GameRuntime) =>
          runtime.call('install').pipe(
            Effect.retry({
              while: (error) => error.reason === 'not-ready',
              schedule: Schedule.spaced(timing.installEvery),
              times: timing.installAttempts,
            }),
            answer(Installed),
          )

        const snapshotOf = (
          runtime: GameRuntime,
          command: string,
          args: ReadonlyArray<RuntimeArgument>,
        ) => runtime.call(command, args).pipe(answer(Snapshot))

        const applyPreferences = Effect.fnUntraced(function* (
          game: Game,
          runtime: GameRuntime,
          initial: Snapshot,
        ) {
          const saved = yield* preferences(game)
          let snapshot = initial

          if (saved.fontSize !== undefined) {
            snapshot = yield* snapshotOf(runtime, 'setFontSize', [saved.fontSize])
          }

          if (saved.speed !== undefined) {
            snapshot = yield* snapshotOf(runtime, 'setSpeed', [saved.speed])
          }

          return snapshot
        })

        const disconnected = Effect.fnUntraced(function* (session: Session, message: string) {
          yield* Ref.set(session.runtime, Option.none())

          if (yield* isCurrent(session)) {
            yield* SubscriptionRef.set(connected, Option.none())
          }

          const processId = yield* Ref.get(session.processId)

          const running = Option.isSome(processId)
            ? yield* connector.isRunning(processId.value)
            : false

          if (!running) {
            return yield* end(session, `${session.game.title} closed.`)
          }

          if (yield* isCurrent(session)) {
            yield* patch((current) => ({
              ...current,
              status: 'disconnected',
              message,
              canRetry: true,
            }))

            yield* Effect.logWarning('Live controls disconnected').pipe(
              Effect.annotateLogs({
                feature: 'livecontrols',
                game: session.game.id,
                engine: session.game.engine,
                detail: message,
              }),
            )
          }
        })

        const watch = (session: Session, runtime: GameRuntime) =>
          Effect.raceFirst(
            snapshotOf(runtime, 'snapshot', []).pipe(
              Effect.flatMap((snapshot) => patch((current) => withSnapshot(current, snapshot))),
              Effect.ignore,
              Effect.repeat(Schedule.spaced(timing.poll)),
              Effect.andThen(Effect.never),
            ),
            runtime.lost,
          ).pipe(Effect.andThen(disconnected(session, 'The connection to the game was lost.')))

        const connect = Effect.fnUntraced(function* (session: Session) {
          const previous = yield* Ref.getAndSet(session.attempt, Option.none())

          if (Option.isSome(previous)) {
            yield* Scope.close(previous.value, Exit.void)
          }

          const attempt = yield* Scope.fork(session.scope)
          const title = session.game.title

          yield* Ref.set(session.attempt, Option.some(attempt))

          yield* patch((current) => ({
            ...current,
            status: 'connecting',
            message: `Connecting to ${title}…`,
            canRetry: false,
          }))

          const joined = Effect.gen(function* () {
            const processId = yield* Ref.get(session.processId)

            if (Option.isNone(processId)) {
              return yield* notConnected()
            }

            const runtime = yield* session.connector
              .connect(processId.value)
              .pipe(Scope.provide(attempt))

            const installed = yield* install(runtime)
            const snapshot = yield* applyPreferences(session.game, runtime, installed.snapshot)

            yield* Ref.set(session.runtime, Option.some(runtime))
            yield* SubscriptionRef.set(connected, Option.some({ game: session.game, runtime }))

            yield* patch((current) =>
              withSnapshot(
                {
                  ...current,
                  status: 'connected',
                  message: `Connected to ${title}.`,
                  canRetry: false,
                  unsupported: toUnsupported(installed.unsupported),
                },
                snapshot,
              ),
            )

            yield* Effect.logInfo('Live controls connected').pipe(
              Effect.annotateLogs({
                feature: 'livecontrols',
                game: session.game.id,
                engine: session.game.engine,
                unsupported: installed.unsupported.length,
              }),
            )

            yield* Effect.forkIn(watch(session, runtime), attempt)
          })

          yield* joined.pipe(Effect.catch((error) => disconnected(session, error.message)))
        })

        const start = Effect.fnUntraced(function* (
          game: Game,
          gameConnector: Connector,
          processId: Effect.Effect<Option.Option<number>>,
          exited: Effect.Effect<void>,
        ) {
          const previous = yield* Ref.get(active)

          if (Option.isSome(previous)) {
            yield* end(previous.value, `${previous.value.game.title} closed.`)
          }

          const session: Session = {
            id: yield* Ref.updateAndGet(sessionCount, (count) => count + 1),
            game,
            scope: yield* Scope.make(),
            connector: gameConnector,
            processId: yield* Ref.make(Option.none<number>()),
            runtime: yield* Ref.make(Option.none<GameRuntime>()),
            attempt: yield* Ref.make(Option.none<Scope.Closeable>()),
          }

          yield* Ref.set(active, Option.some(session))

          yield* patch(() => ({
            ...idleLiveControls,
            status: 'connecting',
            message: `Starting ${game.title}…`,
            gameId: game.id,
            gameTitle: game.title,
          }))

          const join = Effect.gen(function* () {
            const found = yield* processId

            if (Option.isNone(found)) {
              return yield* end(session, `${game.title} did not start.`)
            }

            yield* Ref.set(session.processId, found)
            yield* connect(session)
          })

          yield* Effect.forkIn(join, session.scope)

          yield* Effect.forkIn(
            Effect.andThen(exited, end(session, `${game.title} closed.`)),
            session.scope,
          )
        })

        const prepare = (game: Game): Effect.Effect<LaunchPlan> =>
          connector.prepare(game).pipe(
            Effect.map((prepared): LaunchPlan => ({
              args: prepared.args,
              started: (launch) =>
                start(game, prepared, launch.gameProcessId, Effect.asVoid(launch.exited)),
            })),
            Effect.catch((error) =>
              Effect.as(
                patch(() => ({
                  ...idleLiveControls,
                  message: `Live Game Controls is off for ${game.title}: ${error.message}`,
                })),
                plainLaunch,
              ),
            ),
          )

        const plan = (game: Game) =>
          Effect.flatMap(Ref.get(active), (session) =>
            Option.isNone(session) && supportsLiveControls(game.engine)
              ? prepare(game)
              : Effect.succeed(plainLaunch),
          )

        const attach = Effect.fn('LiveControls.attach')(function* (
          gameId: string,
          processId: number,
        ) {
          const game = yield* games
            .get(gameId)
            .pipe(
              Effect.mapError(
                (error) => new LiveControlsError({ reason: 'invalid', message: error.message }),
              ),
            )

          const gameConnector = yield* connector.attach(game)

          yield* start(game, gameConnector, Effect.succeed(Option.some(processId)), Effect.never)
        })

        const current = Effect.flatMap(Ref.get(active), (session) =>
          Option.isSome(session) ? Effect.succeed(session.value) : Effect.fail(notConnected()),
        )

        const runtimeOf = Effect.flatMap(current, (session) =>
          Effect.flatMap(Ref.get(session.runtime), (runtime) =>
            Option.isSome(runtime)
              ? Effect.succeed({ session, runtime: runtime.value })
              : Effect.fail(notConnected()),
          ),
        )

        const call = (command: string, args: ReadonlyArray<RuntimeArgument> = []) =>
          Effect.flatMap(runtimeOf, ({ runtime }) => runtime.call(command, args))

        const control = (command: string, args: ReadonlyArray<RuntimeArgument>) =>
          call(command, args).pipe(
            answer(Snapshot),
            Effect.flatMap((snapshot) => patch((now) => withSnapshot(now, snapshot))),
          )

        const setDialogueFontSize = Effect.fn('LiveControls.setDialogueFontSize')(function* (
          size: number,
        ) {
          const { session } = yield* runtimeOf
          const fontSize = clamp(Math.round(size), dialogueFontSizes.min, dialogueFontSizes.max)
          const gameSize = (yield* SubscriptionRef.get(state)).defaultFontSize
          const own = fontSize === gameSize

          yield* control('setFontSize', [own ? null : fontSize])

          yield* savePreferences(session.game, ({ fontSize: _saved, ...rest }) =>
            own ? rest : { ...rest, fontSize },
          )
        })

        const setCharacterSpeed = Effect.fn('LiveControls.setCharacterSpeed')(function* (
          speed: CharacterSpeed,
        ) {
          const { session } = yield* runtimeOf

          yield* control('setSpeed', [speed])

          yield* savePreferences(session.game, ({ speed: _saved, ...rest }) =>
            speed === 1 ? rest : { ...rest, speed },
          )
        })

        const reset = Effect.fn('LiveControls.reset')(function* () {
          const { session } = yield* runtimeOf

          yield* control('setHpMode', ['none'])
          yield* control('setFontSize', [null])
          yield* control('setSpeed', [1])
          yield* Effect.ignore(store.remove(preferenceKey(session.game)))
        })

        const retry = Effect.fn('LiveControls.retry')(function* () {
          const session = yield* current

          yield* Effect.forkIn(connect(session), session.scope)
        })

        const stop = Effect.flatMap(Ref.get(active), (session) =>
          Option.isSome(session)
            ? Effect.andThen(
                end(session.value, ''),
                patch(() => idleLiveControls),
              )
            : Effect.void,
        )

        yield* games.list.pipe(
          Effect.flatMap((all) =>
            Effect.forEach(all, (game) => connector.recover(game), { discard: true }),
          ),
          Effect.forkIn(layerScope),
        )

        const window = SubscriptionRef.changes(state).pipe(
          Stream.map((now) =>
            LiveControlsWindow.make({
              open: isOpen(now),
              ...(now.gameTitle === undefined ? {} : { gameTitle: now.gameTitle }),
            }),
          ),
          Stream.changesWith(
            (left, right) => left.open === right.open && left.gameTitle === right.gameTitle,
          ),
        )

        return LiveControls.of({
          state: SubscriptionRef.changes(state),
          sessions: SubscriptionRef.changes(connected),
          session: SubscriptionRef.get(connected),
          window,
          plan,
          attach,
          retry: retry(),
          stop,
          setHpMode: (mode) => control('setHpMode', [mode]),
          setGold: (gold) => control('setGold', [whole(gold)]),
          setDialogueFontSize,
          setCharacterSpeed,
          reset: reset(),
          actors: call('actors').pipe(answer(Schema.Array(ActorSummary))),
          actor: (actorId) => call('actor', [actorId]).pipe(answer(Actor)),
          setActorStat: (actorId, key, value) =>
            call('setStat', [actorId, key, whole(value)]).pipe(answer(Actor)),
          inventory: call('inventory').pipe(answer(Schema.Array(InventoryEntry))),
          setInventoryQuantity: (kind, id, quantity) =>
            call('setQuantity', [kind, id, whole(quantity)]).pipe(answer(InventoryEntry)),
          switches: call('switches').pipe(answer(Schema.Array(SwitchEntry))),
          setSwitch: (id, value) => call('setSwitch', [id, value]).pipe(answer(SwitchEntry)),
          variables: call('variables').pipe(answer(Schema.Array(VariableEntry))),
          setVariable: (id, value) => call('setVariable', [id, value]).pipe(answer(VariableEntry)),
        })
      }),
    )

  static readonly layer = LiveControls.layerWith({
    installEvery: '1 second',
    installAttempts: 120,
    poll: '1 second',
  })

  static readonly launchHooks = Layer.effect(
    LaunchHooks,
    Effect.gen(function* () {
      const live = yield* LiveControls

      return LaunchHooks.of({ plan: live.plan })
    }),
  )
}

export const LiveControlsRpcLive = LiveControlsRpc.toLayer(
  Effect.gen(function* () {
    const live = yield* LiveControls

    return LiveControlsRpc.of({
      watchLiveControls: () => live.state,
      attachLiveControls: ({ gameId, processId }) => live.attach(gameId, processId),
      retryLiveControls: () => live.retry,
      stopLiveControls: () => live.stop,
      setHpMode: ({ mode }) => live.setHpMode(mode),
      setGold: ({ gold }) => live.setGold(gold),
      setDialogueFontSize: ({ size }) => live.setDialogueFontSize(size),
      setCharacterSpeed: ({ speed }) => live.setCharacterSpeed(speed),
      resetLiveControls: () => live.reset,
      listActors: () => live.actors,
      getActor: ({ actorId }) => live.actor(actorId),
      setActorStat: ({ actorId, key, value }) => live.setActorStat(actorId, key, value),
      listInventory: () => live.inventory,
      setInventoryQuantity: ({ kind, id, quantity }) =>
        live.setInventoryQuantity(kind, id, quantity),
      listSwitches: () => live.switches,
      setSwitch: ({ id, value }) => live.setSwitch(id, value),
      listVariables: () => live.variables,
      setVariable: ({ id, value }) => live.setVariable(id, value),
    })
  }),
)
