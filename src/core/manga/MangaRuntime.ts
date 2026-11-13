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
  SubscriptionRef,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { MangaError, type MangaRuntimeState, PageStage } from '#contract/Manga'

export interface WorkerCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
}

export type WorkerCommandOf = (folder: string) => WorkerCommand

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
  op: Schema.Literals(['scan', 'clean', 'render', 'breaks']),
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

const WorkerLine = Schema.Union([
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
])

type WorkerLine = typeof WorkerLine.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(WorkerLine))

const WorkerMessage = Schema.Union([
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
])

type WorkerMessage = typeof WorkerMessage.Type

const encodeMessage = Schema.encodeEffect(Schema.fromJsonString(WorkerMessage))

const PROTOCOL = 2

const STDERR_TAIL = 4_000

interface ActiveRun {
  readonly id: string
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

interface Worker {
  readonly folder: string
  readonly scope: Scope.Closeable
  readonly send: (message: WorkerMessage) => Effect.Effect<void>
  readonly runs: Ref.Ref<Option.Option<ActiveRun>>
  readonly editors: Ref.Ref<ReadonlyMap<number, Deferred.Deferred<unknown, MangaError>>>
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const lastLines = (text: string) => text.trim().split('\n').slice(-3).join(' ').trim()

export class MangaRuntime extends Context.Service<
  MangaRuntime,
  {
    readonly state: Stream.Stream<MangaRuntimeState>
    readonly run: (folder: string, request: RunRequest) => Effect.Effect<RunHandle, MangaError>
    readonly editor: (folder: string, request: EditorRequest) => Effect.Effect<unknown, MangaError>
    readonly stop: Effect.Effect<void>
  }
>()('wenbu/core/manga/MangaRuntime') {
  static readonly layer = (
    commandOf: WorkerCommandOf,
    options: { readonly idle: Duration.Input },
  ) =>
    Layer.effect(
      MangaRuntime,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
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

          const timer = yield* Effect.sleep(options.idle).pipe(
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

        const startWorker = Effect.fnUntraced(function* (folder: string) {
          yield* setState({ status: 'starting' })

          const scope = yield* Scope.make()
          const input = yield* Queue.unbounded<string, Cause.Done>()
          const ready = yield* Deferred.make<void, MangaError>()
          const stderr = yield* Ref.make('')
          const runs = yield* Ref.make<Option.Option<ActiveRun>>(Option.none())

          const editors = yield* Ref.make<
            ReadonlyMap<number, Deferred.Deferred<unknown, MangaError>>
          >(new Map())

          const { command, args, env } = commandOf(folder)

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
              Scope.provide(scope),
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
            Effect.forkIn(scope),
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

              if (line.event === 'loading-models') {
                yield* setState({ status: 'loading-models' })
              }

              if (line.event === 'models-loaded') {
                yield* setState({ status: 'busy', device: line.device })

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
            const tail = lastLines(yield* Ref.get(stderr))

            const message =
              tail === '' ? 'The manga worker stopped.' : `The manga worker stopped: ${tail}`

            yield* Deferred.fail(ready, failed(message))

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
                Effect.annotateLogs({ sidecar: 'manga-worker', pid: handle.pid, output: tail }),
              )
            }
          })

          yield* handle.stdout.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.runForEach((text) =>
              Option.match(decodeLine(text), { onNone: () => Effect.void, onSome: route }),
            ),
            Effect.ignore,
            Effect.ensuring(onExit),
            Effect.forkIn(scope),
          )

          yield* Scope.addFinalizer(
            scope,
            Queue.end(input).pipe(
              Effect.andThen(handle.exitCode),
              Effect.timeout('5 seconds'),
              Effect.ignore,
            ),
          )

          yield* Deferred.await(ready).pipe(
            Effect.timeoutOrElse({
              duration: '3 minutes',
              orElse: () => Effect.fail(failed('The manga worker took too long to start.')),
            }),
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          )

          const worker: Worker = {
            folder,
            scope,
            runs,
            editors,
            send: (message) =>
              encodeMessage(message).pipe(
                Effect.orDie,
                Effect.flatMap((line) => Queue.offer(input, `${line}\n`)),
                Effect.asVoid,
              ),
          }

          yield* Ref.set(current, Option.some(worker))
          yield* setState({ status: 'ready' })

          return worker
        })

        const workerFor = Effect.fnUntraced(function* (folder: string) {
          const existing = yield* Ref.get(current)

          if (Option.isSome(existing) && existing.value.folder === folder) {
            return existing.value
          }

          yield* stopWorker

          return yield* startWorker(folder)
        })

        const settle = Effect.gen(function* () {
          if (Option.isSome(yield* Ref.get(current))) {
            yield* SubscriptionRef.update(state, (now) => ({ ...now, status: 'ready' as const }))
            yield* scheduleIdle
          }
        })

        const run = Effect.fn('MangaRuntime.run')(function* (folder: string, request: RunRequest) {
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

          const worker = yield* workerFor(folder).pipe(Effect.onError(() => turn.release(1)))

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
          folder: string,
          request: EditorRequest,
        ) {
          return yield* turn.withPermits(1)(
            Effect.gen(function* () {
              yield* cancelIdle

              const worker = yield* workerFor(folder)
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

        yield* Effect.addFinalizer(() => Effect.andThen(cancelIdle, stopWorker))

        return MangaRuntime.of({
          state: SubscriptionRef.changes(state),
          run,
          editor,
          stop: Effect.andThen(cancelIdle, stopWorker),
        })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path

      return MangaRuntime.layer((folder) => workerCommand(resources, folder, path), {
        idle: '10 minutes',
      })
    }),
  )
}

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
