import {
  type Cause,
  Config,
  Context,
  Data,
  Deferred,
  Effect,
  Layer,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Schema,
  type Scope,
  Stream,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { OverlayError } from '#contract/TranslationOverlay'
import { watchSidecar } from '../platform/SidecarOutput'
import { lunaHookHelper } from '../plugins/definitions/LunaHook'
import type { RunningProcess } from './GameProcesses'

export type HelperCommand = (args: ReadonlyArray<string>) => {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const EventLine = Schema.Union([
  Schema.Struct({ event: Schema.Literal('ready') }),
  Schema.Struct({ event: Schema.Literal('error'), message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('connected'), pid: Schema.Int }),
  Schema.Struct({ event: Schema.Literal('disconnected'), pid: Schema.Int }),
  Schema.Struct({
    event: Schema.Literal('thread'),
    thread: Schema.String,
    pid: Schema.Int,
    ctx: Schema.String,
    ctx2: Schema.String,
    code: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ event: Schema.Literal('removed'), thread: Schema.String }),
  Schema.Struct({ event: Schema.Literal('text'), thread: Schema.String, text: Schema.String }),
  Schema.Struct({ event: Schema.Literal('log'), level: Schema.String, message: Schema.String }),
])

type EventLine = typeof EventLine.Type

const ReplyLine = Schema.Struct({
  id: Schema.Int,
  reason: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

type ReplyLine = typeof ReplyLine.Type

const decodeLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([EventLine, ReplyLine])),
)

const encodeCommand = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.Int,
      op: Schema.String,
      pid: Schema.Int,
      code: Schema.optional(Schema.String),
    }),
  ),
)

const ProcessList = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      processes: Schema.Array(
        Schema.Struct({
          pid: Schema.Int,
          parent: Schema.Int,
          name: Schema.String,
          path: Schema.String,
        }),
      ),
    }),
    Schema.Struct({ error: Schema.String }),
  ]),
)

export type HostEvent = Data.TaggedEnum<{
  Connected: { readonly pid: number }
  Disconnected: { readonly pid: number }
  Thread: {
    readonly thread: string
    readonly pid: number
    readonly ctx: string
    readonly ctx2: string
    readonly code: string
    readonly name: string
  }
  Removed: { readonly thread: string }
  Text: { readonly thread: string; readonly text: string }
  Log: { readonly level: string; readonly message: string }
  Stopped: {}
}>

export const HostEvent = Data.taggedEnum<HostEvent>()

export interface HookSession {
  readonly events: Stream.Stream<HostEvent>
  readonly attach: (pid: number) => Effect.Effect<void, OverlayError>
  readonly elevate: (pid: number) => Effect.Effect<void, OverlayError>
  readonly detach: (pid: number) => Effect.Effect<void, OverlayError>
  readonly insertHook: (pid: number, code: string) => Effect.Effect<void, OverlayError>
}

const failed = (message: string) => new OverlayError({ reason: 'failed', message })

const stopped = () => failed('LunaHook stopped unexpectedly.')

const replyError = (reply: ReplyLine) => {
  if (reply.error === undefined) {
    return undefined
  }

  return new OverlayError({
    reason: reply.reason === 'elevated' ? 'elevated' : 'failed',
    message: reply.error,
  })
}

export class LunaHookHost extends Context.Service<
  LunaHookHost,
  {
    readonly start: (folder: string) => Effect.Effect<HookSession, OverlayError, Scope.Scope>
    readonly processes: Effect.Effect<ReadonlyArray<RunningProcess>, OverlayError>
  }
>()('wenbu/core/overlay/LunaHookHost') {
  static readonly layer = (helperCommand: HelperCommand) =>
    Layer.effect(
      LunaHookHost,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const start = Effect.fn('LunaHookHost.start')(function* (folder: string) {
          const input = yield* Queue.unbounded<string, Cause.Done>()
          const events = yield* Queue.unbounded<HostEvent, Cause.Done>()
          const ready = yield* Deferred.make<void, OverlayError>()
          const pending = yield* Ref.make(new Map<number, Deferred.Deferred<void, OverlayError>>())
          const nextId = yield* Ref.make(1)
          const { command, args } = helperCommand(['--plugin', folder])

          const handle = yield* spawner
            .spawn(
              ChildProcess.make(command, args, {
                stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
                stdout: 'pipe',
                stderr: 'pipe',
              }),
            )
            .pipe(Effect.mapError(() => failed('The LunaHook helper could not be started.')))

          yield* watchSidecar('lunahook', handle)

          const settle = (reply: ReplyLine) =>
            Effect.flatMap(
              Ref.modify(pending, (map) => {
                const deferred = map.get(reply.id)
                const rest = new Map(map)

                rest.delete(reply.id)

                return [deferred, rest]
              }),
              (deferred) => {
                if (deferred === undefined) {
                  return Effect.void
                }

                const error = replyError(reply)

                return error === undefined
                  ? Deferred.succeed(deferred, undefined)
                  : Deferred.fail(deferred, error)
              },
            )

          const onEvent = (line: EventLine) =>
            Match.value(line).pipe(
              Match.discriminatorsExhaustive('event')({
                ready: () => Deferred.succeed(ready, undefined),
                error: ({ message }) =>
                  Deferred.fail(ready, new OverlayError({ reason: 'not-ready', message })),
                connected: ({ pid }) => Queue.offer(events, HostEvent.Connected({ pid })),
                disconnected: ({ pid }) => Queue.offer(events, HostEvent.Disconnected({ pid })),
                thread: ({ event: _event, ...thread }) =>
                  Queue.offer(events, HostEvent.Thread(thread)),
                removed: ({ thread }) => Queue.offer(events, HostEvent.Removed({ thread })),
                text: ({ thread, text }) => Queue.offer(events, HostEvent.Text({ thread, text })),
                log: ({ level, message }) => Queue.offer(events, HostEvent.Log({ level, message })),
              }),
            )

          const shutDown = Effect.gen(function* () {
            yield* Deferred.fail(ready, stopped())

            const waiting = yield* Ref.getAndSet(pending, new Map())

            yield* Effect.forEach(waiting.values(), (deferred) =>
              Deferred.fail(deferred, stopped()),
            )

            yield* Queue.offer(events, HostEvent.Stopped())
            yield* Queue.end(events)
          })

          yield* handle.stdout.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.runForEach((text) => {
              const line = decodeLine(text)

              if (Option.isNone(line)) {
                return Effect.void
              }

              return 'id' in line.value ? settle(line.value) : onEvent(line.value)
            }),
            Effect.ignore,
            Effect.ensuring(shutDown),
            Effect.forkScoped,
          )

          yield* Effect.addFinalizer(() =>
            Queue.offer(input, 'quit\n').pipe(
              Effect.andThen(Queue.end(input)),
              Effect.andThen(handle.exitCode),
              Effect.timeout('3 seconds'),
              Effect.ignore,
            ),
          )

          yield* Deferred.await(ready).pipe(
            Effect.timeoutOrElse({
              duration: '20 seconds',
              orElse: () => Effect.fail(failed('LunaHook took too long to start.')),
            }),
          )

          yield* Effect.logInfo('LunaHook ready')

          const send = (op: string, pid: number, code?: string) =>
            Effect.gen(function* () {
              const id = yield* Ref.getAndUpdate(nextId, (value) => value + 1)
              const reply = yield* Deferred.make<void, OverlayError>()

              const command = yield* encodeCommand({
                id,
                op,
                pid,
                ...(code === undefined ? {} : { code }),
              }).pipe(Effect.orDie)

              yield* Ref.update(pending, (map) => new Map(map).set(id, reply))
              yield* Queue.offer(input, `${command}\n`)

              return yield* Deferred.await(reply)
            })

          return {
            events: Stream.fromQueue(events),
            attach: (pid) => send('attach', pid),
            elevate: (pid) => send('elevate', pid),
            detach: (pid) => send('detach', pid),
            insertHook: (pid, code) => send('insertHook', pid, code),
          } satisfies HookSession
        })

        const processes = Effect.gen(function* () {
          const { command, args } = helperCommand(['--processes'])

          const output = yield* spawner
            .string(ChildProcess.make(command, args, { stderr: 'ignore' }))
            .pipe(Effect.mapError(() => failed('The running processes could not be listed.')))

          const list = yield* Schema.decodeUnknownEffect(ProcessList)(output.trim()).pipe(
            Effect.mapError(() => failed('The running processes could not be read.')),
          )

          if ('error' in list) {
            return yield* failed(`The running processes could not be listed: ${list.error}`)
          }

          return list.processes.map((entry): RunningProcess => ({
            pid: entry.pid,
            parentPid: entry.parent,
            name: entry.name,
            path: entry.path,
          }))
        }).pipe(Effect.withSpan('LunaHookHost.processes'))

        return LunaHookHost.of({ start, processes })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path
      const helper = lunaHookHelper(resources, path)

      return LunaHookHost.layer((args) => ({ command: helper, args }))
    }),
  )
}
