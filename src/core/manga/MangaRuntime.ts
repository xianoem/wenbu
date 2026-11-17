import {
  type Cause,
  Config,
  Context,
  Data,
  Deferred,
  type Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  Struct,
  SubscriptionRef,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { MangaError, type MangaRuntimeState, PageStage } from '#contract/Manga'
import type { MangaEngine } from '../plugins/Plugins'

export type MangaWorker = MangaEngine

const workerKey = (worker: MangaWorker) =>
  [worker.engine, worker.folder, Option.getOrElse(worker.nvidia, () => '')].join('|')

export interface WorkerCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  /** Asks the worker to warm up once it is ready. */
  readonly warm?: boolean
  /** How long a closing worker gets to end on its own before it is stopped. */
  readonly stopGrace?: Duration.Input
}

export type WorkerCommandOf = (worker: MangaWorker) => WorkerCommand

/** A started worker: JSON lines from it, a way to send it lines, and its error output once it has stopped. */
export interface WorkerConnection {
  readonly lines: Stream.Stream<string>
  readonly send: (line: string) => Effect.Effect<void>
  readonly output: Effect.Effect<string>
  readonly pid: number | undefined
  /** Whether to ask the worker to warm up once it is ready. */
  readonly warm: boolean
}

/** Starts a worker. Closing the scope stops it. */
export type WorkerLauncher = (
  worker: MangaWorker,
) => Effect.Effect<WorkerConnection, MangaError, Scope.Scope>

export interface RunOptions {
  readonly [option: string]: string | number | boolean
}

export interface RunRequest {
  readonly options: RunOptions
  readonly pages: ReadonlyArray<{ readonly source: string; readonly output: string }>
}

export type RunEvent = Data.TaggedEnum<{
  LoadingModels: {}
  ModelsLoaded: { readonly device: string }
  PageStarted: { readonly page: number }
  Stage: { readonly page: number; readonly stage: PageStage }
  Translate: { readonly id: number; readonly page: number; readonly texts: ReadonlyArray<string> }
  PageDone: { readonly page: number; readonly regions: number }
  PageFailed: { readonly page: number; readonly message: string }
  Done: { readonly cancelled: boolean; readonly seconds: number | undefined }
  Failed: { readonly message: string }
}>

export const RunEvent = Data.taggedEnum<RunEvent>()

const OptionValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])

export const EditorOptions = Schema.Record(Schema.String, OptionValue)

export const EditorBlock = Schema.Struct({
  box: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
  drawn: Schema.optional(Schema.Boolean),
  text: Schema.optional(Schema.String),
  translation: Schema.optional(Schema.String),
  fg: Schema.optional(Schema.Array(Schema.Int)),
  bg: Schema.optional(Schema.Array(Schema.Int)),
  fontSize: Schema.optional(Schema.Int),
  vertical: Schema.optional(Schema.Boolean),
  method: Schema.optional(Schema.Literals(['fill', 'inpaint'])),
  lettering: Schema.optional(
    Schema.Struct({
      breakMode: Schema.Literals(['balanced', 'greedy', 'manual']),
      avoidOrphans: Schema.Boolean,
      hyphenate: Schema.Boolean,
      uppercase: Schema.optional(Schema.Boolean),
      size: Schema.optional(Schema.Int),
      fontDir: Schema.optional(Schema.String),
      fontFamily: Schema.optional(Schema.String),
      leading: Schema.optional(Schema.Finite),
      textBox: Schema.optional(
        Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
      ),
    }),
  ),
})

const EditorFields = {
  op: Schema.Literals(['scan', 'clean', 'render', 'breaks', 'picture']),
  options: EditorOptions,
  source: Schema.String,
  mask: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  cleaned: Schema.optional(Schema.String),
  brush: Schema.optional(Schema.String),
  blocks: Schema.optional(Schema.Array(EditorBlock)),
}

export type EditorRequest = Schema.Struct.Type<typeof EditorFields>

export type TranslateReply =
  | { readonly translations: ReadonlyArray<string> }
  | { readonly error: string }

export interface RunHandle {
  readonly events: Stream.Stream<RunEvent>
  readonly answer: (id: number, reply: TranslateReply) => Effect.Effect<void>
  readonly cancel: Effect.Effect<void>
}

const RunScoped = { run: Schema.String }

export const WorkerLine = Schema.Union([
  Schema.Struct({ event: Schema.Literal('ready'), protocol: Schema.Int }),
  Schema.Struct({ event: Schema.Literal('error'), message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('loading-models'), ...RunScoped }),
  Schema.Struct({ event: Schema.Literal('models-loaded'), ...RunScoped, device: Schema.String }),
  Schema.Struct({ event: Schema.Literal('page-started'), ...RunScoped, page: Schema.Int }),
  Schema.Struct({
    event: Schema.Literal('stage'),
    ...RunScoped,
    page: Schema.Int,
    stage: PageStage,
  }),
  Schema.Struct({
    event: Schema.Literal('translate'),
    ...RunScoped,
    id: Schema.Int,
    page: Schema.Int,
    texts: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    event: Schema.Literal('page-done'),
    ...RunScoped,
    page: Schema.Int,
    regions: Schema.Int,
  }),
  Schema.Struct({
    event: Schema.Literal('page-failed'),
    ...RunScoped,
    page: Schema.Int,
    message: Schema.String,
  }),
  Schema.Struct({
    event: Schema.Literal('run-done'),
    ...RunScoped,
    cancelled: Schema.Boolean,
    seconds: Schema.optional(Schema.Finite),
  }),
  Schema.Struct({ event: Schema.Literal('run-failed'), ...RunScoped, message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('editor-done'), id: Schema.Int, result: Schema.Unknown }),
  Schema.Struct({
    event: Schema.Literal('editor-failed'),
    id: Schema.Int,
    message: Schema.String,
  }),
  Schema.Struct({ event: Schema.Literal('warm-progress'), done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ event: Schema.Literal('warm-done'), seconds: Schema.Finite }),
  Schema.Struct({ event: Schema.Literal('warm-skipped') }),
  Schema.Struct({ event: Schema.Literal('warm-failed'), message: Schema.String }),
])

export type WorkerLine = typeof WorkerLine.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(WorkerLine))

export const WorkerMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('run'),
    run: Schema.String,
    options: Schema.Record(Schema.String, OptionValue),
    pages: Schema.Array(Schema.Struct({ source: Schema.String, output: Schema.String })),
  }),
  Schema.Struct({
    type: Schema.Literal('translated'),
    id: Schema.Int,
    translations: Schema.Array(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('translated'), id: Schema.Int, error: Schema.String }),
  Schema.Struct({ type: Schema.Literal('cancel'), run: Schema.String }),
  Schema.Struct({ type: Schema.Literal('editor'), id: Schema.Int, ...EditorFields }),
  Schema.Struct({
    type: Schema.Literal('warm'),
    options: Schema.Record(Schema.String, OptionValue),
  }),
])

type WorkerMessage = typeof WorkerMessage.Type

const encodeMessage = Schema.encodeEffect(Schema.fromJsonString(WorkerMessage))

export const PROTOCOL = 2

const STDERR_TAIL = 4_000

interface ActiveRun {
  readonly id: string
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

interface Worker {
  readonly key: string
  readonly scope: Scope.Closeable
  readonly send: (message: WorkerMessage) => Effect.Effect<void>
  readonly runs: Ref.Ref<Option.Option<ActiveRun>>
  readonly editors: Ref.Ref<ReadonlyMap<number, Deferred.Deferred<unknown, MangaError>>>
  readonly warmed: Deferred.Deferred<void>
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

export interface RuntimeOptions {
  /** How long an unused worker stays up. */
  readonly idle: Duration.Input
}

const lastLines = (text: string) => text.trim().split('\n').slice(-3).join(' ').trim()

export class MangaRuntime extends Context.Service<
  MangaRuntime,
  {
    readonly state: Stream.Stream<MangaRuntimeState>
    readonly run: (worker: MangaWorker, request: RunRequest) => Effect.Effect<RunHandle, MangaError>
    readonly editor: (
      worker: MangaWorker,
      request: EditorRequest,
    ) => Effect.Effect<unknown, MangaError>
    /** Starts the worker so it prepares for the graphics card before the first run needs it. */
    readonly warm: (worker: MangaWorker) => Effect.Effect<void, MangaError>
    readonly stop: Effect.Effect<void>
  }
>()('wenbu/core/manga/MangaRuntime') {
  static readonly layerWith = (launch: WorkerLauncher, options: RuntimeOptions) =>
    Layer.effect(
      MangaRuntime,
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.make<MangaRuntimeState>({ status: 'stopped' })
        const current = yield* Ref.make<Option.Option<Worker>>(Option.none())
        const idleTimer = yield* Ref.make<Option.Option<Fiber.Fiber<void>>>(Option.none())
        const runCount = yield* Ref.make(0)
        const editorCount = yield* Ref.make(0)
        const turn = yield* Semaphore.make(1)
        const layerScope = yield* Effect.scope

        const setState = (next: MangaRuntimeState) => SubscriptionRef.set(state, next)

        const stopWorker = Effect.gen(function* () {
          const worker = yield* Ref.getAndSet(current, Option.none())

          if (Option.isSome(worker)) {
            yield* Scope.close(worker.value.scope, Exit.void)
            yield* setState({ status: 'stopped' })
          }
        })

        const cancelIdle = Effect.flatMap(Ref.getAndSet(idleTimer, Option.none()), (timer) =>
          Option.isSome(timer) ? Fiber.interrupt(timer.value) : Effect.void,
        )

        const scheduleIdle = Effect.gen(function* () {
          yield* cancelIdle

          const worker = yield* Ref.get(current)

          const warmed = Option.isSome(worker) ? Deferred.await(worker.value.warmed) : Effect.void

          const timer = yield* Effect.andThen(warmed, Effect.sleep(options.idle)).pipe(
            Effect.andThen(stopWorker),
            Effect.forkIn(layerScope),
          )

          yield* Ref.set(idleTimer, Option.some(timer))
        })

        const toEvent = (line: WorkerLine): Option.Option<RunEvent> =>
          Match.value(line).pipe(
            Match.discriminatorsExhaustive('event')({
              ready: () => Option.none(),
              error: () => Option.none(),
              'editor-done': () => Option.none(),
              'editor-failed': () => Option.none(),
              'warm-progress': () => Option.none(),
              'warm-done': () => Option.none(),
              'warm-skipped': () => Option.none(),
              'warm-failed': () => Option.none(),
              'loading-models': () => Option.some(RunEvent.LoadingModels()),
              'models-loaded': ({ device }) => Option.some(RunEvent.ModelsLoaded({ device })),
              'page-started': ({ page }) => Option.some(RunEvent.PageStarted({ page })),
              stage: ({ page, stage }) => Option.some(RunEvent.Stage({ page, stage })),
              translate: ({ id, page, texts }) =>
                Option.some(RunEvent.Translate({ id, page, texts })),
              'page-done': ({ page, regions }) => Option.some(RunEvent.PageDone({ page, regions })),
              'page-failed': ({ page, message }) =>
                Option.some(RunEvent.PageFailed({ page, message })),
              'run-done': ({ cancelled, seconds }) =>
                Option.some(RunEvent.Done({ cancelled, seconds })),
              'run-failed': ({ message }) => Option.some(RunEvent.Failed({ message })),
            }),
          )

        const startWorker = Effect.fnUntraced(function* (spec: MangaWorker) {
          yield* setState({ status: 'starting' })

          const scope = yield* Scope.make()
          const ready = yield* Deferred.make<void, MangaError>()
          const warmed = yield* Deferred.make<void>()
          const runs = yield* Ref.make<Option.Option<ActiveRun>>(Option.none())

          const editors = yield* Ref.make<
            ReadonlyMap<number, Deferred.Deferred<unknown, MangaError>>
          >(new Map())

          const connection = yield* launch(spec).pipe(
            Scope.provide(scope),
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          )

          const route = (line: WorkerLine) =>
            Effect.gen(function* () {
              if (line.event === 'ready') {
                return yield* line.protocol === PROTOCOL
                  ? Deferred.succeed(ready, undefined)
                  : Deferred.fail(
                      ready,
                      failed(
                        'The manga worker is from another Wenbu version. Reinstall the plugin.',
                      ),
                    )
              }

              if (line.event === 'error') {
                return yield* Effect.logWarning('Manga worker reported a problem').pipe(
                  Effect.annotateLogs({ detail: line.message }),
                )
              }

              if (line.event === 'editor-done' || line.event === 'editor-failed') {
                const waiting = (yield* Ref.get(editors)).get(line.id)

                if (waiting !== undefined) {
                  yield* line.event === 'editor-done'
                    ? Deferred.succeed(waiting, line.result)
                    : Deferred.fail(waiting, failed(line.message))
                }

                return
              }

              if (line.event === 'warm-progress') {
                return yield* SubscriptionRef.update(state, (now) => ({
                  ...now,
                  warming: { done: line.done, total: line.total },
                }))
              }

              if (
                line.event === 'warm-done' ||
                line.event === 'warm-skipped' ||
                line.event === 'warm-failed'
              ) {
                yield* SubscriptionRef.update(state, (now) => Struct.omit(now, ['warming']))
                yield* Deferred.succeed(warmed, undefined)
              }

              if (line.event === 'warm-done') {
                return yield* Effect.logInfo('Manga engine warmed up').pipe(
                  Effect.annotateLogs({ seconds: line.seconds }),
                )
              }

              if (line.event === 'warm-failed') {
                return yield* Effect.logWarning('Manga engine could not warm up').pipe(
                  Effect.annotateLogs({ detail: line.message }),
                )
              }

              if (line.event === 'warm-skipped') {
                return
              }

              if (line.event === 'loading-models') {
                yield* SubscriptionRef.update(state, (now) => ({
                  ...now,
                  status: 'loading-models' as const,
                }))
              }

              if (line.event === 'models-loaded') {
                yield* SubscriptionRef.update(state, (now) => ({
                  ...now,
                  status: 'busy' as const,
                  device: line.device,
                }))

                yield* Effect.logInfo('Manga models loaded').pipe(
                  Effect.annotateLogs({ device: line.device }),
                )
              }

              const run = yield* Ref.get(runs)

              if (Option.isNone(run) || run.value.id !== line.run) {
                return
              }

              const event = toEvent(line)

              if (Option.isSome(event)) {
                yield* Queue.offer(run.value.events, event.value)
              }

              if (line.event === 'run-done' || line.event === 'run-failed') {
                yield* Queue.end(run.value.events)
                yield* Ref.set(runs, Option.none())
              }
            })

          const onExit = Effect.gen(function* () {
            const tail = lastLines(yield* connection.output)

            const message =
              tail === '' ? 'The manga worker stopped.' : `The manga worker stopped: ${tail}`

            yield* Deferred.fail(ready, failed(message))
            yield* Deferred.succeed(warmed, undefined)

            for (const waiting of (yield* Ref.getAndSet(editors, new Map())).values()) {
              yield* Deferred.fail(waiting, failed(message))
            }

            const run = yield* Ref.getAndSet(runs, Option.none())

            if (Option.isSome(run)) {
              yield* Queue.offer(run.value.events, RunEvent.Failed({ message }))
              yield* Queue.end(run.value.events)
            }

            const worker = yield* Ref.get(current)

            if (Option.isSome(worker) && worker.value.scope === scope) {
              yield* Ref.set(current, Option.none())
              yield* setState({ status: 'failed', message })

              yield* Effect.logError('Sidecar exited with an error').pipe(
                Effect.annotateLogs({ sidecar: 'manga-worker', pid: connection.pid, output: tail }),
              )
            }
          })

          yield* connection.lines.pipe(
            Stream.runForEach((text) =>
              Option.match(decodeLine(text), { onNone: () => Effect.void, onSome: route }),
            ),
            Effect.ignore,
            Effect.ensuring(onExit),
            Effect.forkIn(scope),
          )

          yield* Deferred.await(ready).pipe(
            Effect.timeoutOrElse({
              duration: '3 minutes',
              orElse: () => Effect.fail(failed('The manga worker took too long to start.')),
            }),
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          )

          const worker: Worker = {
            key: workerKey(spec),
            scope,
            runs,
            editors,
            warmed,
            send: (message) =>
              encodeMessage(message).pipe(Effect.orDie, Effect.flatMap(connection.send)),
          }

          yield* Ref.set(current, Option.some(worker))

          yield* setState({ status: 'ready' })

          if (connection.warm) {
            yield* worker.send({ type: 'warm', options: {} })
          } else {
            yield* Deferred.succeed(warmed, undefined)
          }

          return worker
        })

        const workerFor = Effect.fnUntraced(function* (spec: MangaWorker) {
          const existing = yield* Ref.get(current)

          if (Option.isSome(existing) && existing.value.key === workerKey(spec)) {
            return existing.value
          }

          yield* stopWorker

          return yield* startWorker(spec)
        })

        const settle = Effect.gen(function* () {
          if (Option.isSome(yield* Ref.get(current))) {
            yield* SubscriptionRef.update(state, (now) => ({ ...now, status: 'ready' as const }))
            yield* scheduleIdle
          }
        })

        const run = Effect.fn('MangaRuntime.run')(function* (
          spec: MangaWorker,
          request: RunRequest,
        ) {
          const running = yield* Effect.flatMap(Ref.get(current), (worker) =>
            Option.isSome(worker) ? Ref.get(worker.value.runs) : Effect.succeedNone,
          )

          if (Option.isSome(running)) {
            return yield* new MangaError({
              reason: 'conflict',
              message: 'Another manga run is going.',
            })
          }

          yield* turn.take(1)
          yield* cancelIdle

          const worker = yield* workerFor(spec).pipe(Effect.onError(() => turn.release(1)))

          const id = `run-${yield* Ref.updateAndGet(runCount, (count) => count + 1)}`
          const events = yield* Queue.unbounded<RunEvent, Cause.Done>()

          yield* Ref.set(worker.runs, Option.some({ id, events }))
          yield* SubscriptionRef.update(state, (now) => ({ ...now, status: 'busy' as const }))

          yield* worker.send({
            type: 'run',
            run: id,
            options: request.options,
            pages: request.pages,
          })

          return {
            events: Stream.fromQueue(events).pipe(
              Stream.ensuring(Effect.andThen(turn.release(1), settle)),
            ),
            answer: (requestId, reply) =>
              worker.send({ type: 'translated', id: requestId, ...reply }),
            cancel: worker.send({ type: 'cancel', run: id }),
          } satisfies RunHandle
        })

        const editor = Effect.fn('MangaRuntime.editor')(function* (
          spec: MangaWorker,
          request: EditorRequest,
        ) {
          return yield* turn.withPermits(1)(
            Effect.gen(function* () {
              yield* cancelIdle

              const worker = yield* workerFor(spec)
              const id = yield* Ref.updateAndGet(editorCount, (count) => count + 1)
              const done = yield* Deferred.make<unknown, MangaError>()

              yield* Ref.update(worker.editors, (all) => new Map(all).set(id, done))
              yield* SubscriptionRef.update(state, (now) => ({ ...now, status: 'busy' as const }))
              yield* worker.send({ type: 'editor', id, ...request })

              const forget = Ref.update(worker.editors, (all) => {
                const rest = new Map(all)

                rest.delete(id)

                return rest
              })

              return yield* Deferred.await(done).pipe(
                Effect.ensuring(Effect.andThen(forget, settle)),
              )
            }),
          )
        })

        const warm = Effect.fn('MangaRuntime.warm')(function* (spec: MangaWorker) {
          yield* turn.withPermits(1)(Effect.andThen(cancelIdle, workerFor(spec)))
          yield* settle
        })

        yield* Effect.addFinalizer(() => Effect.andThen(cancelIdle, stopWorker))

        return MangaRuntime.of({
          state: SubscriptionRef.changes(state),
          run,
          editor,
          warm,
          stop: Effect.andThen(cancelIdle, stopWorker),
        })
      }),
    )

  static readonly layer = (commandOf: WorkerCommandOf, options: RuntimeOptions) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        return MangaRuntime.layerWith(childWorker(spawner, commandOf), options)
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const dataDir = yield* Config.String('WENBU_DATA_DIR')
      const path = yield* Path.Path

      return MangaRuntime.layer(
        (worker) =>
          worker.engine === 'manga-engine'
            ? engineCommand(
                { resources, dataDir, models: worker.folder, nvidia: worker.nvidia },
                path,
              )
            : workerCommand(resources, worker.folder, path),
        { idle: '10 minutes' },
      )
    }),
  )
}

/** A worker started as a child process that speaks NDJSON over stdio. */
export const childWorker =
  (
    spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
    commandOf: WorkerCommandOf,
  ): WorkerLauncher =>
  (worker) =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<string, Cause.Done>()
      const stderr = yield* Ref.make('')
      const { command, args, env, warm, stopGrace } = commandOf(worker)

      const handle = yield* spawner
        .spawn(
          ChildProcess.make(command, args, {
            stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
            stdout: 'pipe',
            stderr: 'pipe',
            env,
            extendEnv: true,
          }),
        )
        .pipe(
          Effect.mapError(() =>
            failed('The manga worker could not be started. Reinstall the plugin.'),
          ),
        )

      yield* handle.stderr.pipe(
        Stream.decodeText,
        Stream.runForEach((chunk) =>
          Ref.update(stderr, (tail) => (tail + chunk).slice(-STDERR_TAIL)),
        ),
        Effect.ignore,
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer(() =>
        Queue.end(input).pipe(
          Effect.andThen(handle.exitCode),
          Effect.timeout(stopGrace ?? '5 seconds'),
          Effect.ignore,
        ),
      )

      return {
        lines: handle.stdout.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.ignore({ log: false }),
        ),
        send: (line) => Queue.offer(input, `${line}\n`).pipe(Effect.asVoid),
        output: Ref.get(stderr),
        pid: handle.pid,
        warm: warm === true,
      } satisfies WorkerConnection
    })

export interface EngineFolders {
  readonly resources: string
  readonly dataDir: string
  /** The folder holding the engine's `models` folder. */
  readonly models: string
  /** The NVIDIA TensorRT-RTX pack, when it is installed. */
  readonly nvidia: Option.Option<string>
}

/** The C++ engine ships with Wenbu, beside its other native helpers. */
export const engineExecutable = (resources: string, path: Path.Path) =>
  path.join(resources, 'native', `${process.platform}-${process.arch}`, 'wenbu-manga-engine.exe')

/**
 * The C++ engine, which speaks the worker protocol over stdio. It warms up once it is ready, and gets
 * two minutes to close, since saving TensorRT-RTX's compiled kernels takes up to half a minute.
 */
export const engineCommand = (folders: EngineFolders, path: Path.Path): WorkerCommand => ({
  command: engineExecutable(folders.resources, path),
  args: [],
  warm: true,
  stopGrace: '2 minutes',
  env: {
    WENBU_MANGA_ENGINE_DIR: folders.models,
    WENBU_MANGA_CACHE: path.join(folders.dataDir, 'manga-engine'),
    ...Option.match(folders.nvidia, {
      onNone: () => ({}),
      onSome: (pack) => ({ WENBU_NVIDIA_PACK: pack }),
    }),
  },
})

export const workerCommand = (
  resources: string,
  folder: string,
  path: Path.Path,
): WorkerCommand => ({
  command: path.join(
    folder,
    'env',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  ),
  args: ['-m', 'wenbu_manga.worker'],
  env: {
    PYTHONPATH: [path.join(resources, 'python'), path.join(folder, 'upstream')].join(
      process.platform === 'win32' ? ';' : ':',
    ),
    PYTHONPYCACHEPREFIX: path.join(folder, 'pycache'),
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
  },
})
