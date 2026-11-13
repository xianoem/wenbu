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
  Schema,
  type Scope,
  Stream,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { type AudioSource, AudioSources, isAppAudio, SubtitlesError } from '#contract/Subtitles'
import { watchSidecar } from '../platform/SidecarOutput'
import { speechHelper } from '../plugins/definitions/SpeechModel'

export type HelperCommand = (args: ReadonlyArray<string>) => {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const EventLine = Schema.Union([
  Schema.Struct({ event: Schema.Literal('ready'), protocol: Schema.Int }),
  Schema.Struct({ event: Schema.Literal('loading-model') }),
  Schema.Struct({
    event: Schema.Literal('model-loaded'),
    device: Schema.String,
    type: Schema.String,
    seconds: Schema.Finite,
  }),
  Schema.Struct({ event: Schema.Literal('listening') }),
  Schema.Struct({ event: Schema.Literal('level'), rms: Schema.Finite, speech: Schema.Boolean }),
  Schema.Struct({ event: Schema.Literal('partial'), id: Schema.Int, text: Schema.String }),
  Schema.Struct({ event: Schema.Literal('partials-off'), ms: Schema.Finite }),
  Schema.Struct({
    event: Schema.Literal('utterance'),
    id: Schema.Int,
    text: Schema.String,
    language: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite,
    ms: Schema.Finite,
  }),
  Schema.Struct({
    event: Schema.Literal('dropped'),
    id: Schema.Int,
    reason: Schema.String,
    ms: Schema.Finite,
  }),
  Schema.Struct({ event: Schema.Literal('capture-failed'), message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('error'), message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('log'), message: Schema.String }),
  Schema.Struct({ event: Schema.Literal('stopped') }),
])

type EventLine = typeof EventLine.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(EventLine))

const SourcesLine = Schema.fromJsonString(
  Schema.Struct({
    event: Schema.Literal('sources'),
    outputs: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, default: Schema.Boolean }),
    ),
    apps: Schema.Array(
      Schema.Struct({ pid: Schema.Int, name: Schema.String, path: Schema.String }),
    ),
    appCapture: Schema.Boolean,
  }),
)

const Command = Schema.fromJsonString(
  Schema.Struct({
    op: Schema.String,
    model: Schema.optional(Schema.String),
    vad: Schema.optional(Schema.String),
    language: Schema.optional(Schema.String),
    device: Schema.optional(Schema.String),
    threshold: Schema.optional(Schema.Finite),
    pause: Schema.optional(Schema.Int),
    pid: Schema.optional(Schema.Int),
    output: Schema.optional(Schema.String),
  }),
)

const encodeCommand = Schema.encodeEffect(Command)

export type SpeechEvent = Data.TaggedEnum<{
  ModelLoaded: { readonly device: string; readonly seconds: number }
  Listening: {}
  Level: { readonly level: number; readonly speech: boolean }
  Partial: { readonly id: number; readonly text: string }
  Utterance: {
    readonly id: number
    readonly text: string
    readonly language: string
    readonly start: number
    readonly end: number
    readonly ms: number
  }
  Dropped: { readonly id: number; readonly reason: string }
  CaptureFailed: { readonly message: string }
  Failed: { readonly message: string }
  Stopped: {}
}>

export const SpeechEvent = Data.taggedEnum<SpeechEvent>()

export interface SpeechOptions {
  readonly model: string
  readonly vad: string
  readonly source: AudioSource
  readonly outputId: string | undefined
  readonly language: string | undefined
  readonly device: string
  readonly threshold: number
  readonly pauseMs: number
}

export interface SpeechSession {
  readonly events: Stream.Stream<SpeechEvent>
  readonly setSource: (source: AudioSource, outputId: string | undefined) => Effect.Effect<void>
  readonly setPaused: (paused: boolean) => Effect.Effect<void>
}

const failed = (message: string) => new SubtitlesError({ reason: 'speech-failed', message })

const sourceFields = (source: AudioSource, outputId: string | undefined) => {
  if (isAppAudio(source)) {
    return { pid: source.pid }
  }

  return outputId === undefined ? {} : { output: outputId }
}

export class SpeechHelper extends Context.Service<
  SpeechHelper,
  {
    readonly start: (
      options: SpeechOptions,
    ) => Effect.Effect<SpeechSession, SubtitlesError, Scope.Scope>
    readonly sources: Effect.Effect<AudioSources, SubtitlesError>
  }
>()('wenbu/core/subtitles/SpeechHelper') {
  static readonly layer = (helperCommand: HelperCommand) =>
    Layer.effect(
      SpeechHelper,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const start = Effect.fn('SpeechHelper.start')(function* (options: SpeechOptions) {
          const input = yield* Queue.unbounded<string, Cause.Done>()
          const events = yield* Queue.unbounded<SpeechEvent, Cause.Done>()
          const ready = yield* Deferred.make<void, SubtitlesError>()
          const { command, args } = helperCommand([])

          const handle = yield* spawner
            .spawn(
              ChildProcess.make(command, args, {
                stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
                stdout: 'pipe',
                stderr: 'pipe',
              }),
            )
            .pipe(Effect.mapError(() => failed("Wenbu's speech helper could not be started.")))

          yield* watchSidecar('speech', handle)

          const send = (fields: typeof Command.Type) =>
            encodeCommand(fields).pipe(
              Effect.orDie,
              Effect.flatMap((line) => Queue.offer(input, `${line}\n`)),
              Effect.asVoid,
            )

          const offer = (event: SpeechEvent) => Queue.offer(events, event)

          const onEvent = (line: EventLine) =>
            Match.value(line).pipe(
              Match.discriminatorsExhaustive('event')({
                ready: () => Deferred.succeed(ready, undefined),
                'loading-model': () => Effect.void,
                'model-loaded': ({ device, seconds }) =>
                  offer(SpeechEvent.ModelLoaded({ device, seconds })),
                listening: () => offer(SpeechEvent.Listening()),
                level: ({ rms, speech }) => offer(SpeechEvent.Level({ level: rms, speech })),
                partial: ({ id, text }) => offer(SpeechEvent.Partial({ id, text })),
                'partials-off': ({ ms }) =>
                  Effect.logInfo('Partial lines turned off; recognition is too slow').pipe(
                    Effect.annotateLogs({ ms }),
                  ),
                utterance: ({ event: _event, ...utterance }) =>
                  offer(SpeechEvent.Utterance(utterance)),
                dropped: ({ id, reason, ms }) =>
                  Effect.logDebug('Speech dropped').pipe(
                    Effect.annotateLogs({ reason, ms }),
                    Effect.andThen(offer(SpeechEvent.Dropped({ id, reason }))),
                  ),
                'capture-failed': ({ message }) => offer(SpeechEvent.CaptureFailed({ message })),
                error: ({ message }) => offer(SpeechEvent.Failed({ message })),
                log: ({ message }) =>
                  Effect.logInfo('Speech helper').pipe(Effect.annotateLogs({ message })),
                stopped: () => Effect.void,
              }),
            )

          const shutDown = Effect.gen(function* () {
            yield* Deferred.fail(ready, failed("Wenbu's speech helper stopped unexpectedly."))
            yield* Queue.offer(events, SpeechEvent.Stopped())
            yield* Queue.end(events)
          })

          yield* handle.stdout.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.runForEach((text) => {
              const line = decodeLine(text)

              return Option.isNone(line) ? Effect.void : onEvent(line.value)
            }),
            Effect.ignore,
            Effect.ensuring(shutDown),
            Effect.forkScoped,
          )

          yield* Effect.addFinalizer(() =>
            send({ op: 'stop' }).pipe(
              Effect.andThen(Queue.end(input)),
              Effect.andThen(handle.exitCode),
              Effect.timeout('5 seconds'),
              Effect.ignore,
            ),
          )

          yield* Deferred.await(ready).pipe(
            Effect.timeoutOrElse({
              duration: '20 seconds',
              orElse: () => Effect.fail(failed("Wenbu's speech helper took too long to start.")),
            }),
          )

          yield* send({
            op: 'start',
            model: options.model,
            vad: options.vad,
            device: options.device,
            threshold: options.threshold,
            pause: options.pauseMs,
            ...(options.language === undefined ? {} : { language: options.language }),
            ...sourceFields(options.source, options.outputId),
          })

          return {
            events: Stream.fromQueue(events),
            setSource: (source, outputId) =>
              send({ op: 'set-source', ...sourceFields(source, outputId) }),
            setPaused: (paused) => send({ op: paused ? 'pause' : 'resume' }),
          } satisfies SpeechSession
        })

        const sources = Effect.gen(function* () {
          const { command, args } = helperCommand(['--sources'])

          const output = yield* spawner
            .string(ChildProcess.make(command, args, { stderr: 'ignore' }))
            .pipe(Effect.mapError(() => failed('The audio sources could not be listed.')))

          const line = yield* Schema.decodeUnknownEffect(SourcesLine)(output.trim()).pipe(
            Effect.mapError(() => failed('The audio sources could not be read.')),
          )

          return AudioSources.make({
            outputs: line.outputs.map((output) => ({
              id: output.id,
              name: output.name,
              isDefault: output.default,
            })),
            apps: line.apps,
            appCapture: line.appCapture,
          })
        }).pipe(Effect.withSpan('SpeechHelper.sources'))

        return SpeechHelper.of({ start, sources })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const path = yield* Path.Path
      const helper = speechHelper(resources, path)

      return SpeechHelper.layer((args) => ({ command: helper, args }))
    }),
  )
}
