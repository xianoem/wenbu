import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Result,
  Schedule,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { SubtitleWindow } from '#contract/CoreMessages'
import {
  appName,
  type AudioLevel,
  type AudioSources,
  type SubtitleLine,
  type SubtitleSettings,
  type SubtitleState,
  type SubtitleStatus,
  SubtitlesError,
  SubtitlesRpc,
  type SpeechModelId,
  sameAudioSource,
  speechModels,
} from '#contract/Subtitles'
import { LlmClient } from '../llm/LlmClient'
import type { ContextPair } from '../overlay/TranslationContext'
import { installedName, modelPaths, readManifest } from '../plugins/definitions/SpeechModel'
import { speechModelSpecs } from '../plugins/definitions/SpeechModels'
import { Plugins } from '../plugins/Plugins'
import { SpeechEvent, SpeechHelper, type SpeechSession } from './SpeechHelper'
import {
  closeCjkGaps,
  endsSentence,
  joinUtterances,
  recentPairs,
  recognitionSlow,
  systemPrompt,
  vadThreshold,
} from './SubtitleLines'
import { SubtitlePreferences } from './SubtitlePreferences'

const recentCount = 3

const holdFor = '500 millis'

const contextTokens = 2000

const stoppedState: SubtitleState = {
  status: 'stopped',
  recent: [],
  tokens: 0,
  overlayVisible: true,
  overlayLocked: false,
  overlayMode: 'both',
  textSize: 1,
}

interface Utterance {
  readonly text: string
  readonly language: string
  readonly start: number
  readonly end: number
  readonly ms: number
}

interface Held {
  readonly utterance: Utterance
  readonly timer: Fiber.Fiber<void>
}

interface Session {
  readonly scope: Scope.Closeable
  readonly speech: SpeechSession
  readonly settings: SubtitleSettings
  readonly modelName: string
  readonly held: Ref.Ref<Option.Option<Held>>
  readonly pairs: Ref.Ref<ReadonlyArray<ContextPair>>
  readonly stopping: Ref.Ref<boolean>
  readonly recogniseMs: Ref.Ref<ReadonlyArray<number>>
}

const loadingModel: SubtitleStatus = 'loading-model'

const listeningStatus = (status: SubtitleStatus): SubtitleStatus =>
  status === 'paused' ? 'paused' : 'listening'

const noPlugin = (model: SpeechModelId) =>
  new SubtitlesError({
    reason: 'no-plugin',
    message: `Install ${speechModels[model].name} from the Plugins page to use Live Subtitles.`,
  })

export class LiveSubtitles extends Context.Service<
  LiveSubtitles,
  {
    readonly state: Stream.Stream<SubtitleState>
    readonly backlog: Stream.Stream<ReadonlyArray<SubtitleLine>>
    readonly levels: Stream.Stream<AudioLevel>
    readonly window: Stream.Stream<SubtitleWindow>
    readonly sources: Stream.Stream<AudioSources, SubtitlesError>
    readonly start: Effect.Effect<void, SubtitlesError>
    readonly stop: Effect.Effect<void>
    readonly setPaused: (paused: boolean) => Effect.Effect<void>
    readonly setOverlayVisible: (visible: boolean) => Effect.Effect<void>
    readonly setOverlayLocked: (locked: boolean) => Effect.Effect<void>
    readonly toggleOverlayLocked: Effect.Effect<void>
    readonly setTextSize: (textSize: number) => Effect.Effect<void>
    readonly retry: (lineId: number) => Effect.Effect<void>
    readonly clearBacklog: Effect.Effect<void>
    readonly settingsChanged: (settings: SubtitleSettings) => Effect.Effect<void>
  }
>()('wenbu/core/subtitles/LiveSubtitles') {
  static readonly layer = Layer.effect(
    LiveSubtitles,
    Effect.gen(function* () {
      const speechHelper = yield* SpeechHelper
      const plugins = yield* Plugins
      const preferences = yield* SubtitlePreferences
      const llm = yield* LlmClient
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const layerScope = yield* Effect.scope
      const initial = yield* preferences.settings

      const state = yield* SubscriptionRef.make<SubtitleState>({
        ...stoppedState,
        overlayMode: initial.overlayMode,
        textSize: initial.textSize,
      })

      const backlog = yield* SubscriptionRef.make<ReadonlyArray<SubtitleLine>>([])
      const levels = yield* PubSub.sliding<AudioLevel>(4)
      const current = yield* Ref.make<Option.Option<Session>>(Option.none())
      const lineIds = yield* Ref.make(1)
      const hideFromCapture = yield* Ref.make(initial.hideFromCapture)

      const patch = (update: (value: SubtitleState) => SubtitleState) =>
        SubscriptionRef.update(state, update)

      const refreshRecent = Effect.flatMap(SubscriptionRef.get(backlog), (lines) =>
        patch((value) => ({ ...value, recent: lines.slice(-recentCount) })),
      )

      const updateLine = (id: number, update: (line: SubtitleLine) => SubtitleLine) =>
        SubscriptionRef.update(backlog, (lines) =>
          lines.map((line) => (line.id === id ? update(line) : line)),
        ).pipe(Effect.andThen(refreshRecent))

      const addUsage = (completion: {
        readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
        readonly costUsd: number | undefined
      }) =>
        patch((value) => {
          const tokens = value.tokens + completion.usage.inputTokens + completion.usage.outputTokens
          const priced = completion.costUsd !== undefined || value.costUsd !== undefined

          return {
            ...value,
            tokens,
            ...(priced ? { costUsd: (value.costUsd ?? 0) + (completion.costUsd ?? 0) } : {}),
          }
        })

      const translate = Effect.fnUntraced(function* (session: Session, line: SubtitleLine) {
        const { settings } = session
        const began = yield* Clock.currentTimeMillis

        const pairs = recentPairs(
          yield* Ref.get(session.pairs),
          settings.contextLines,
          contextTokens,
        )

        const completion = yield* llm
          .complete({
            presetId: settings.presetId,
            feature: 'subtitles',
            system: systemPrompt(settings.targetLanguage),
            history: pairs.flatMap((pair) => [
              { role: 'user' as const, text: pair.source },
              { role: 'assistant' as const, text: pair.translation },
            ]),
            prompt: line.original,
            timeout: '30 seconds',
          })
          .pipe(Effect.retry(Schedule.recurs(1)), Effect.result)

        if (Result.isFailure(completion)) {
          yield* Effect.logWarning('Subtitle line not translated').pipe(
            Effect.annotateLogs({ line: line.id, detail: completion.failure.message }),
          )

          return yield* updateLine(line.id, (value) => ({
            ...value,
            status: 'failed',
            error: completion.failure.message,
          }))
        }

        const translation = completion.success.text.trim()
        const finished = yield* Clock.currentTimeMillis

        yield* Ref.update(session.pairs, (list) =>
          [...list, { source: line.original, translation }].slice(-50),
        )

        yield* addUsage(completion.success)

        yield* patch((value) => ({
          ...value,
          translationDelay: (value.textDelay ?? 0) + (finished - began) / 1000,
        }))

        yield* Effect.logInfo('Subtitle line translated').pipe(
          Effect.annotateLogs({ line: line.id, translateMs: finished - began }),
        )

        yield* updateLine(line.id, ({ error: _error, ...value }) => ({
          ...value,
          status: 'translated',
          translation,
        }))
      })

      const commit = Effect.fnUntraced(function* (session: Session, utterance: Utterance) {
        const id = yield* Ref.getAndUpdate(lineIds, (value) => value + 1)

        const line: SubtitleLine = {
          id,
          start: utterance.start,
          end: utterance.end,
          original: utterance.text,
          language: utterance.language,
          status: 'translating',
        }

        yield* SubscriptionRef.update(backlog, (lines) => [...lines, line])

        yield* patch((value) => ({
          ...value,
          textDelay: (session.settings.pauseMs + utterance.ms) / 1000,
        }))

        yield* Effect.logInfo('Subtitle line heard').pipe(
          Effect.annotateLogs({
            line: id,
            speechSeconds: Math.round((utterance.end - utterance.start) * 10) / 10,
            recogniseMs: Math.round(utterance.ms),
          }),
        )

        yield* refreshRecent
        yield* translate(session, line).pipe(Effect.forkIn(session.scope))
      })

      const releaseHeld = (session: Session) =>
        Effect.flatMap(Ref.getAndSet(session.held, Option.none()), (held) =>
          Option.isSome(held) ? commit(session, held.value.utterance) : Effect.void,
        )

      const heard = Effect.fnUntraced(function* (session: Session, spoken: Utterance) {
        const utterance = { ...spoken, text: closeCjkGaps(spoken.text) }

        const recent = yield* Ref.updateAndGet(session.recogniseMs, (all) =>
          [...all, utterance.ms].slice(-3),
        )

        const slow = recognitionSlow(recent)
        const wasSlow = (yield* SubscriptionRef.get(state)).slowRecognition === true

        if (slow && !wasSlow) {
          yield* Effect.logWarning('Recognition is running slowly').pipe(
            Effect.annotateLogs({ recentMs: recent.map((ms) => Math.round(ms)).join(', ') }),
          )
        }

        yield* patch(({ partial: _partial, ...value }) => ({ ...value, slowRecognition: slow }))

        const held = yield* Ref.getAndSet(session.held, Option.none())

        if (Option.isSome(held)) {
          yield* Fiber.interrupt(held.value.timer)
        }

        const joined: Utterance = Option.isSome(held)
          ? {
              ...utterance,
              text: joinUtterances(held.value.utterance.text, utterance.text),
              start: held.value.utterance.start,
            }
          : utterance

        if (!session.settings.waitForSentences || endsSentence(joined.text)) {
          return yield* commit(session, joined)
        }

        const timer = yield* Effect.sleep(holdFor).pipe(
          Effect.andThen(releaseHeld(session)),
          Effect.forkIn(session.scope),
        )

        yield* Ref.set(session.held, Option.some({ utterance: joined, timer }))
      })

      const fail = (message: string) =>
        patch(({ partial: _partial, ...value }) => ({ ...value, status: 'failed', message }))

      const detach = Effect.gen(function* () {
        const session = yield* Ref.getAndSet(current, Option.none())

        if (Option.isSome(session)) {
          yield* Ref.set(session.value.stopping, true)
        }

        return session
      })

      const close = (session: Session) =>
        releaseHeld(session).pipe(Effect.andThen(Scope.close(session.scope, Exit.void)))

      const endSession = Effect.flatMap(detach, (session) =>
        Option.isSome(session) ? close(session.value) : Effect.void,
      )

      // The session's own event fiber can't close the scope it runs in, so it hands the close over.
      const endFromEvent = Effect.flatMap(detach, (session) =>
        Option.isSome(session) ? Effect.forkIn(close(session.value), layerScope) : Effect.void,
      )

      const onEvent = (session: Session, event: SpeechEvent) =>
        SpeechEvent.$match(event, {
          ModelLoaded: ({ device, seconds }) =>
            Effect.logInfo('Speech model loaded').pipe(
              Effect.annotateLogs({ model: session.modelName, device, seconds }),
              Effect.andThen(patch((value) => ({ ...value, device, model: session.modelName }))),
            ),
          Listening: () =>
            patch(({ message: _message, ...value }) => ({
              ...value,
              status: listeningStatus(value.status),
            })),
          Level: (level) => PubSub.publish(levels, level),
          Partial: ({ text }) => patch((value) => ({ ...value, partial: text })),
          Utterance: (utterance) => heard(session, utterance),
          Dropped: () => patch(({ partial: _partial, ...value }) => value),
          CaptureFailed: ({ message }) =>
            Effect.logWarning('Audio capture failed').pipe(
              Effect.annotateLogs({ detail: message }),
              Effect.andThen(fail(message)),
              Effect.andThen(endFromEvent),
            ),
          Failed: ({ message }) => Effect.logWarning('Speech helper reported an error', message),
          Stopped: () =>
            Effect.flatMap(Ref.get(session.stopping), (stopping) =>
              stopping
                ? Effect.void
                : Effect.logError('Speech helper stopped unexpectedly').pipe(
                    Effect.andThen(fail("Wenbu's speech helper stopped unexpectedly.")),
                    Effect.andThen(endFromEvent),
                  ),
            ),
        })

      const start = Effect.gen(function* () {
        if (Option.isSome(yield* Ref.get(current))) {
          return
        }

        const settings = yield* preferences.settings

        if (settings.presetId === '') {
          return yield* new SubtitlesError({
            reason: 'no-preset',
            message: 'Choose an LLM preset to translate with.',
          })
        }

        const spec = speechModelSpecs[settings.model]
        const folder = yield* plugins.installedFolder(settings.model)

        if (Option.isNone(folder)) {
          return yield* noPlugin(settings.model)
        }

        const manifest = yield* readManifest(folder.value).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        )

        const paths = Option.flatMap(manifest, (value) =>
          modelPaths(folder.value, spec, value, path),
        )

        if (Option.isNone(manifest) || Option.isNone(paths)) {
          return yield* noPlugin(settings.model)
        }

        const modelName = installedName(spec, manifest.value)
        const sourceName = appName(settings.source)

        yield* SubscriptionRef.set(backlog, [])

        yield* SubscriptionRef.update(state, (value) => ({
          ...stoppedState,
          overlayVisible: value.overlayVisible,
          overlayLocked: value.overlayLocked,
          overlayMode: value.overlayMode,
          textSize: value.textSize,
          status: loadingModel,
          ...(sourceName === undefined ? {} : { sourceName }),
        }))

        const scope = yield* Scope.make()

        const speech = yield* speechHelper
          .start({
            model: paths.value.model,
            vad: paths.value.vad,
            source: settings.source,
            outputId: settings.outputId,
            language: settings.spokenLanguage,
            device: settings.device,
            threshold: vadThreshold[settings.sensitivity],
            pauseMs: settings.pauseMs,
          })
          .pipe(
            Scope.provide(scope),
            Effect.tapError((error) =>
              Scope.close(scope, Exit.void).pipe(Effect.andThen(fail(error.message))),
            ),
          )

        const session: Session = {
          scope,
          speech,
          settings,
          modelName,
          held: yield* Ref.make<Option.Option<Held>>(Option.none()),
          pairs: yield* Ref.make<ReadonlyArray<ContextPair>>([]),
          stopping: yield* Ref.make(false),
          recogniseMs: yield* Ref.make<ReadonlyArray<number>>([]),
        }

        yield* Ref.set(current, Option.some(session))

        yield* Effect.logInfo('Live Subtitles started').pipe(
          Effect.annotateLogs({
            model: modelName,
            source: sourceName === undefined ? 'computer audio' : 'one app',
            device: settings.device,
            spokenLanguage: settings.spokenLanguage ?? 'detect',
          }),
        )

        yield* speech.events.pipe(
          Stream.runForEach((event) => onEvent(session, event)),
          Effect.forkIn(scope),
        )
      }).pipe(Effect.withSpan('LiveSubtitles.start'))

      const stop = Effect.flatMap(Ref.get(current), (session) =>
        Option.isSome(session) ? Effect.logInfo('Live Subtitles stopped') : Effect.void,
      ).pipe(
        Effect.andThen(endSession),
        Effect.andThen(
          patch(({ partial: _partial, message: _message, ...value }) => ({
            ...value,
            status: 'stopped',
          })),
        ),
      )

      const setPaused = (paused: boolean) =>
        Effect.flatMap(Ref.get(current), (session) => {
          if (Option.isNone(session)) {
            return Effect.void
          }

          const status: SubtitleStatus = paused ? 'paused' : 'listening'

          return session.value.speech
            .setPaused(paused)
            .pipe(
              Effect.andThen(patch(({ partial: _partial, ...value }) => ({ ...value, status }))),
            )
        })

      const retry = (lineId: number) =>
        Effect.gen(function* () {
          const session = yield* Ref.get(current)
          const line = (yield* SubscriptionRef.get(backlog)).find((entry) => entry.id === lineId)

          if (Option.isNone(session) || line === undefined) {
            return
          }

          yield* updateLine(lineId, ({ error: _error, ...value }) => ({
            ...value,
            status: 'translating',
          }))

          yield* translate(session.value, line).pipe(Effect.forkIn(session.value.scope))
        })

      const settingsChanged = (settings: SubtitleSettings) =>
        Effect.gen(function* () {
          yield* Ref.set(hideFromCapture, settings.hideFromCapture)

          yield* patch((value) => ({
            ...value,
            overlayMode: settings.overlayMode,
            textSize: settings.textSize,
          }))

          const session = yield* Ref.get(current)

          if (Option.isNone(session)) {
            return
          }

          const before = session.value.settings

          if (
            !sameAudioSource(before.source, settings.source) ||
            before.outputId !== settings.outputId
          ) {
            yield* session.value.speech.setSource(settings.source, settings.outputId)
          }

          yield* Ref.set(current, Option.some({ ...session.value, settings }))

          const sourceName = appName(settings.source)

          yield* patch(({ sourceName: _name, ...value }) => ({
            ...value,
            ...(sourceName === undefined ? {} : { sourceName }),
          }))
        })

      const window = SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((value) =>
          Effect.gen(function* () {
            const open = value.status !== 'stopped'
            const bounds = open ? yield* preferences.bounds : Option.none()

            return SubtitleWindow.make({
              open,
              visible: value.overlayVisible,
              locked: value.overlayLocked,
              hideFromCapture: yield* Ref.get(hideFromCapture),
              ...(Option.isSome(bounds) ? { bounds: bounds.value } : {}),
            })
          }),
        ),
        Stream.changesWith(
          (left, right) =>
            left.open === right.open &&
            left.visible === right.visible &&
            left.locked === right.locked &&
            left.hideFromCapture === right.hideFromCapture,
        ),
      )

      yield* Effect.addFinalizer(() => endSession)

      return LiveSubtitles.of({
        state: SubscriptionRef.changes(state),
        backlog: SubscriptionRef.changes(backlog),
        levels: Stream.fromPubSub(levels),
        window,
        sources: Stream.fromEffectSchedule(speechHelper.sources, Schedule.spaced('2 seconds')),
        start,
        stop,
        setPaused,
        setOverlayVisible: (visible) => patch((value) => ({ ...value, overlayVisible: visible })),
        setOverlayLocked: (locked) => patch((value) => ({ ...value, overlayLocked: locked })),
        toggleOverlayLocked: patch((value) => ({ ...value, overlayLocked: !value.overlayLocked })),
        setTextSize: (textSize) =>
          preferences.settings.pipe(
            Effect.flatMap((settings) => preferences.save({ ...settings, textSize })),
            Effect.flatMap((saved) => settingsChanged(saved)),
            Effect.orDie,
          ),
        retry,
        clearBacklog: SubscriptionRef.set(backlog, []).pipe(Effect.andThen(refreshRecent)),
        settingsChanged,
      })
    }),
  )
}

export const SubtitlesRpcLive = SubtitlesRpc.toLayer(
  Effect.gen(function* () {
    const subtitles = yield* LiveSubtitles
    const preferences = yield* SubtitlePreferences

    return SubtitlesRpc.of({
      getSubtitleSettings: () => preferences.settings,
      saveSubtitleSettings: (settings) =>
        preferences.save(settings).pipe(Effect.tap((saved) => subtitles.settingsChanged(saved))),
      watchAudioSources: () => subtitles.sources,
      startSubtitles: () => subtitles.start,
      stopSubtitles: () => subtitles.stop,
      setSubtitlesPaused: ({ paused }) => subtitles.setPaused(paused),
      setSubtitleOverlayVisible: ({ visible }) => subtitles.setOverlayVisible(visible),
      setSubtitleOverlayLocked: ({ locked }) => subtitles.setOverlayLocked(locked),
      setSubtitleTextSize: ({ textSize }) => subtitles.setTextSize(textSize),
      retrySubtitleTranslation: ({ lineId }) => subtitles.retry(lineId),
      clearSubtitleBacklog: () => subtitles.clearBacklog,
      watchSubtitles: () => subtitles.state,
      watchSubtitleBacklog: () => subtitles.backlog,
      watchAudioLevel: () => subtitles.levels,
    })
  }),
)
