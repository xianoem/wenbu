import {
  Clock,
  Context,
  Crypto,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  type LogLevel,
  Option,
  Queue,
  Ref,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'
import { OverlayWindow } from '#contract/CoreMessages'
import type { Game, StartLocale } from '#contract/Library'
import {
  defaultOverlayAppearance,
  defaultTextPipeline,
  type GameProcess,
  type OverlayAppearance,
  type OverlayDiagnostic,
  OverlayError,
  type OverlayGame,
  type OverlayHook,
  type OverlaySettings,
  type OverlayState,
  type SavedHook,
  type TextPipeline,
  contextBudget,
  TranslationOverlayRpc,
} from '#contract/TranslationOverlay'
import { GameLauncher, type GameExit, type Launch } from '../library/GameLauncher'
import { Games } from '../library/Games'
import { LaunchAlias } from '../library/LaunchAlias'
import { LlmClient, type PresetDescription } from '../llm/LlmClient'
import { Plugins } from '../plugins/Plugins'
import { estimateTokens } from '../translation/Batches'
import { descendantsOf, matchGameProcesses } from './GameProcesses'
import { scoreHook } from './HookScore'
import { HostEvent, type HookSession, LunaHookHost } from './LunaHookHost'
import { OverlayPreferences } from './OverlayPreferences'
import { OverlayStore } from './OverlayStore'
import { applyTextPipeline } from './TextPipeline'
import {
  type ContextPair,
  contextFor,
  summaryLimit,
  summaryPrompt,
  systemPrompt,
} from './TranslationContext'

export interface OverlayTiming {
  readonly debounce: Duration.Input
  readonly poll: Duration.Input
  readonly searchFor: Duration.Input
  readonly crashWithin: Duration.Input
  readonly hooksEvery: Duration.Input
}

interface HookEntry {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly pid: number
  readonly ctx: string
  readonly ctx2: string
  readonly samples: ReadonlyArray<{ readonly raw: string; readonly text: string }>
  readonly updateCount: number
  readonly lastSeenAt: string
  readonly manual: boolean
}

interface Hooks {
  readonly version: number
  readonly entries: ReadonlyMap<string, HookEntry>
}

interface Selection {
  readonly id: string
  readonly byUser: boolean
  readonly exact: boolean
}

interface TranslationRequest {
  readonly text: string
  readonly fresh: boolean
}

type ThreadEvent = Extract<HostEvent, { readonly _tag: 'Thread' }>

interface LaunchMark {
  readonly processId: number
  readonly locale: StartLocale
  readonly at: number
}

const byNameOnly = 'Process name matches this game executable.'

interface Session {
  readonly id: string
  readonly game: Game
  readonly scope: Scope.Closeable
  readonly hook: HookSession
  readonly settings: OverlaySettings
  readonly model: PresetDescription | undefined
  readonly pipeline: Ref.Ref<TextPipeline>
  readonly savedHook: Ref.Ref<Option.Option<SavedHook>>
  readonly selection: Ref.Ref<Selection | undefined>
  readonly connected: Ref.Ref<ReadonlySet<number>>
  readonly attempted: Ref.Ref<ReadonlySet<number>>
  readonly sawText: Ref.Ref<boolean>
  readonly watching: Ref.Ref<boolean>
  readonly launch: Ref.Ref<LaunchMark | undefined>
  readonly manualCodes: Ref.Ref<ReadonlySet<string>>
  readonly lastLine: Ref.Ref<string>
  readonly lines: Queue.Queue<string>
  readonly requests: Queue.Queue<TranslationRequest>
  readonly pairs: Ref.Ref<ReadonlyArray<ContextPair>>
  readonly story: Ref.Ref<{ readonly summary: string; readonly lineCount: number }>
  readonly sinceStory: Ref.Ref<ReadonlyArray<ContextPair>>
  readonly refreshing: Ref.Ref<boolean>
}

const maxSamples = 5

const maxPairs = 50

const maxDiagnostics = 40

const logLevelOf = {
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
} as const satisfies Record<OverlayDiagnostic['level'], LogLevel.Severity>

const idleState: OverlayState = {
  status: 'idle',
  message: '',
  processIds: [],
  cacheHit: false,
  translating: false,
  canRetry: false,
  paused: false,
  visible: false,
  usage: { inputTokens: 0, outputTokens: 0 },
  appearance: defaultOverlayAppearance,
  diagnostics: [],
}

const notReady = (message: string) => new OverlayError({ reason: 'not-ready', message })

const noSession = () =>
  new OverlayError({ reason: 'conflict', message: 'Start the Translation Overlay first.' })

const now = Effect.map(DateTime.now, DateTime.formatIso)

const nextLocale = (locale: StartLocale): StartLocale | undefined => {
  if (locale === 'system') {
    return 'ntleas'
  }

  if (locale === 'ntleas') {
    return 'locale-remulator'
  }

  return undefined
}

const closedEarly = (title: string, locale: StartLocale) => {
  const closed = `${title} closed right after starting`

  if (locale === 'system') {
    return `${closed}. Some games only run on a Japanese system.`
  }

  const tool = locale === 'ntleas' ? 'Ntleas' : 'Locale Remulator'

  return nextLocale(locale) === undefined
    ? `${closed} with ${tool}. Try another locale.`
    : `${closed} with ${tool}.`
}

const latestText = (entry: HookEntry) => entry.samples.at(-1)?.text ?? ''

const toOverlayHook = (
  entry: HookEntry,
  selection: Selection | undefined,
  sourceLanguage: string,
): OverlayHook => {
  const score = scoreHook(sourceLanguage, latestText(entry), entry.updateCount)

  return {
    id: entry.id,
    code: entry.code,
    name: entry.name,
    processId: entry.pid,
    confidence: score.confidence,
    score: score.score,
    reasons: score.reasons,
    signal: score.signal,
    samples: entry.samples,
    updateCount: entry.updateCount,
    lastSeenAt: entry.lastSeenAt,
    selected: selection?.id === entry.id,
    manual: entry.manual,
  }
}

const sameWindow = (left: OverlayWindow, right: OverlayWindow) =>
  left.open === right.open && left.visible === right.visible && left.locked === right.locked

export class TranslationOverlay extends Context.Service<
  TranslationOverlay,
  {
    readonly state: Stream.Stream<OverlayState>
    readonly hooks: Stream.Stream<ReadonlyArray<OverlayHook>>
    readonly window: Stream.Stream<OverlayWindow>
    readonly launch: (gameId: string) => Effect.Effect<void, OverlayError>
    readonly attach: (gameId: string, processId: number) => Effect.Effect<void, OverlayError>
    readonly attachElevated: (processId: number) => Effect.Effect<void, OverlayError>
    readonly retryAttach: Effect.Effect<void, OverlayError>
    readonly stop: Effect.Effect<void>
    readonly findProcesses: (
      gameId: string,
    ) => Effect.Effect<ReadonlyArray<GameProcess>, OverlayError>
    readonly selectHook: (hookId: string) => Effect.Effect<void, OverlayError>
    readonly insertHookCode: (code: string) => Effect.Effect<void, OverlayError>
    readonly setVisible: (visible: boolean) => Effect.Effect<void>
    readonly setPaused: (paused: boolean) => Effect.Effect<void>
    readonly saveAppearance: (appearance: OverlayAppearance) => Effect.Effect<OverlayAppearance>
    readonly retryTranslation: Effect.Effect<void, OverlayError>
    readonly overlayGame: (gameId: string) => Effect.Effect<OverlayGame, OverlayError>
    readonly savePipeline: (
      gameId: string,
      pipeline: TextPipeline,
    ) => Effect.Effect<TextPipeline, OverlayError>
    readonly resetPipeline: (gameId: string) => Effect.Effect<TextPipeline>
    readonly resetStory: (gameId: string) => Effect.Effect<void>
    readonly submitText: (text: string) => Effect.Effect<void>
  }
>()('wenbu/core/overlay/TranslationOverlay') {
  static readonly layerWith = (timing: OverlayTiming) =>
    Layer.effect(
      TranslationOverlay,
      Effect.gen(function* () {
        const games = yield* Games
        const launcher = yield* GameLauncher
        const aliases = yield* LaunchAlias
        const host = yield* LunaHookHost
        const plugins = yield* Plugins
        const store = yield* OverlayStore
        const preferences = yield* OverlayPreferences
        const llm = yield* LlmClient
        const crypto = yield* Crypto.Crypto
        const layerScope = yield* Scope.Scope
        const lock = yield* Semaphore.make(1)
        const crashMillis = Duration.toMillis(Duration.fromInputUnsafe(timing.crashWithin))

        const state = yield* SubscriptionRef.make<OverlayState>({
          ...idleState,
          appearance: yield* preferences.appearance,
        })

        const hooks = yield* Ref.make<Hooks>({ version: 0, entries: new Map() })
        const active = yield* Ref.make<Option.Option<Session>>(Option.none())
        const diagnosticCount = yield* Ref.make(0)

        const patch = (f: (current: OverlayState) => OverlayState) =>
          SubscriptionRef.update(state, f)

        const diagnostic = Effect.fnUntraced(function* (
          level: OverlayDiagnostic['level'],
          message: string,
        ) {
          const id = yield* Ref.updateAndGet(diagnosticCount, (count) => count + 1)
          const entry: OverlayDiagnostic = { id: `${id}`, at: yield* now, level, message }

          yield* patch((current) => ({
            ...current,
            diagnostics: [...current.diagnostics, entry].slice(-maxDiagnostics),
          }))

          yield* Effect.logWithLevel(logLevelOf[level])('Overlay diagnostic').pipe(
            Effect.annotateLogs({ feature: 'overlay', detail: message }),
          )
        })

        const updateHooks = (f: (entries: Map<string, HookEntry>) => void) =>
          Ref.update(hooks, (current) => {
            const entries = new Map(current.entries)

            f(entries)

            return { version: current.version + 1, entries }
          })

        const bumpHooks = Ref.update(hooks, (current) => ({
          ...current,
          version: current.version + 1,
        }))

        const isCurrent = (session: Session) =>
          Effect.map(Ref.get(active), (current) =>
            Option.match(current, {
              onNone: () => false,
              onSome: (value) => value.id === session.id,
            }),
          )

        const end = Effect.fnUntraced(function* (
          session: Session,
          finish: (current: OverlayState) => OverlayState,
        ) {
          if (!(yield* isCurrent(session))) {
            return
          }

          yield* Ref.set(active, Option.none())

          yield* patch(({ sessionId: _ended, offer: _offer, ...current }) =>
            finish({ ...current, processIds: [], translating: false, canRetry: false }),
          )

          yield* Effect.forkIn(Scope.close(session.scope, Exit.void), layerScope)
        })

        const stopped = (session: Session, message: string) =>
          end(session, (current) => ({ ...current, status: 'stopped', message }))

        const failed = (session: Session, message: string) =>
          end(session, (current) => ({ ...current, status: 'failed', message }))

        const gameGone = Effect.fnUntraced(function* (session: Session, exit?: GameExit) {
          const launched = yield* Ref.get(session.launch)
          const sawText = yield* Ref.get(session.sawText)
          const time = yield* Clock.currentTimeMillis
          const title = session.game.title

          const crashed =
            launched !== undefined &&
            !sawText &&
            (exit?.found === false || time - launched.at <= crashMillis)

          if (!crashed) {
            return yield* stopped(session, `${title} exited.`)
          }

          const locale = nextLocale(launched.locale)

          yield* end(session, (current) => ({
            ...current,
            status: 'failed',
            message: closedEarly(title, launched.locale),
            ...(locale === undefined ? {} : { offer: { kind: 'locale' as const, locale } }),
          }))
        })

        const offerLine = Effect.fnUntraced(function* (session: Session, text: string) {
          const line = text.trim()

          if (line === '' || (yield* SubscriptionRef.get(state)).paused) {
            return
          }

          if ((yield* Ref.getAndSet(session.lastLine, line)) === line) {
            return
          }

          yield* Queue.offer(session.lines, line)
        })

        const select = Effect.fnUntraced(function* (session: Session, selection: Selection) {
          const entry = (yield* Ref.get(hooks)).entries.get(selection.id)

          if (entry === undefined) {
            return
          }

          yield* Ref.set(session.selection, selection)
          yield* bumpHooks

          yield* patch((current) => ({
            ...current,
            status: current.status === 'waiting-for-text' ? 'attached' : current.status,
            selectedHook: { id: entry.id, code: entry.code, name: entry.name },
          }))

          yield* Ref.set(session.lastLine, '')
          yield* offerLine(session, latestText(entry))
        })

        const addUsage = (completion: {
          readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
          readonly costUsd: number | undefined
        }) =>
          patch((current) => {
            const costUsd = (current.usage.costUsd ?? 0) + (completion.costUsd ?? 0)
            const priced = completion.costUsd !== undefined || current.usage.costUsd !== undefined

            return {
              ...current,
              usage: {
                ...current.usage,
                inputTokens: current.usage.inputTokens + completion.usage.inputTokens,
                outputTokens: current.usage.outputTokens + completion.usage.outputTokens,
                ...(priced ? { costUsd } : {}),
              },
            }
          })

        const budgetOf = (session: Session, prompt: string) =>
          contextBudget(
            session.model ?? {},
            session.settings.context,
            estimateTokens(systemPrompt(session.settings)) + estimateTokens(prompt),
          )

        const refreshStory = Effect.fnUntraced(function* (session: Session) {
          const lines = yield* Ref.getAndSet(session.sinceStory, [])
          const previous = yield* Ref.get(session.story)
          const prompt = summaryPrompt(previous.summary, lines, summaryLimit(budgetOf(session, '')))
          const { settings } = session

          const completion = yield* llm.complete({
            presetId: settings.presetId,
            feature: 'overlay',
            gameId: session.game.id,
            system: prompt.system,
            prompt: prompt.prompt,
            timeout: `${settings.timeoutSeconds} seconds`,
          })

          const story = { summary: completion.text, lineCount: previous.lineCount + lines.length }

          yield* Ref.set(session.story, story)

          yield* store.saveStory(session.game.id, settings.targetLanguage, {
            ...story,
            updatedAt: yield* now,
          })

          yield* addUsage(completion)
        })

        const remember = Effect.fnUntraced(function* (session: Session, pair: ContextPair) {
          yield* Ref.update(session.pairs, (pairs) => [...pairs, pair].slice(-maxPairs))

          const { context } = session.settings

          if (context.mode !== 'summary') {
            return
          }

          const pending = yield* Ref.updateAndGet(session.sinceStory, (pairs) => [...pairs, pair])

          if (pending.length < context.summaryEvery) {
            return
          }

          if (yield* Ref.getAndSet(session.refreshing, true)) {
            return
          }

          yield* refreshStory(session).pipe(
            Effect.catch((error) =>
              diagnostic('warn', `The story summary could not be updated: ${error.message}`),
            ),
            Effect.ensuring(Ref.set(session.refreshing, false)),
            Effect.forkIn(session.scope),
          )
        })

        const showTranslation = (translation: string, cacheHit: boolean) =>
          patch((current) => ({
            ...current,
            status: 'attached',
            translatedText: translation,
            cacheHit,
            translating: false,
            canRetry: true,
          }))

        const translate = Effect.fnUntraced(function* (
          session: Session,
          request: TranslationRequest,
        ) {
          const { settings, game } = session
          const source = request.text

          const key = {
            gameId: game.id,
            targetLanguage: settings.targetLanguage,
            sourceText: source,
          }

          yield* patch(({ translatedText: _previous, ...current }) => ({
            ...current,
            status: 'translating',
            message: '',
            sourceText: source,
            cacheHit: false,
            translating: true,
            canRetry: false,
          }))

          const cached = request.fresh ? Option.none<string>() : yield* store.cached(key)

          if (Option.isSome(cached)) {
            yield* remember(session, { source, translation: cached.value })

            return yield* showTranslation(cached.value, true)
          }

          if (settings.presetId === '') {
            return yield* patch((current) => ({
              ...current,
              status: 'attached',
              translating: false,
              message: 'Choose an LLM preset in Settings → Translation overlay.',
            }))
          }

          const context = contextFor({
            system: systemPrompt(settings),
            pairs: yield* Ref.get(session.pairs),
            summary: (yield* Ref.get(session.story)).summary,
            settings: settings.context,
            budget: budgetOf(session, source),
          })

          const completion = yield* llm
            .complete({
              presetId: settings.presetId,
              feature: 'overlay',
              gameId: game.id,
              system: context.system,
              history: context.history,
              prompt: source,
              timeout: `${settings.timeoutSeconds} seconds`,
            })
            .pipe(
              Effect.retry(Schedule.recurs(Math.max(0, settings.retryRounds - 1))),
              Effect.tapError((error) =>
                Effect.andThen(
                  diagnostic('error', error.message),
                  patch((current) => ({
                    ...current,
                    status: 'attached',
                    translating: false,
                    canRetry: true,
                    message: error.message,
                  })),
                ),
              ),
              Effect.option,
            )

          if (Option.isNone(completion)) {
            return
          }

          const translation = completion.value.text

          yield* store.cache(key, translation)
          yield* addUsage(completion.value)
          yield* remember(session, { source, translation })
          yield* showTranslation(translation, false)
        })

        const attachTo = Effect.fnUntraced(function* (session: Session, processId: number) {
          yield* Ref.update(session.attempted, (pids) => new Set(pids).add(processId))

          yield* session.hook.attach(processId).pipe(
            Effect.catchTag('OverlayError', (error) => {
              if (error.reason !== 'elevated') {
                return Effect.fail(error)
              }

              return patch((current) => ({
                ...current,
                status: 'failed',
                message: `${session.game.title} runs as administrator. Attach as administrator to read its text.`,
                offer: { kind: 'elevated', processId },
              }))
            }),
          )
        })

        const onConnected = Effect.fnUntraced(function* (session: Session, pid: number) {
          const connected = yield* Ref.updateAndGet(session.connected, (pids) =>
            new Set(pids).add(pid),
          )

          const selection = yield* Ref.get(session.selection)

          yield* patch(({ offer: _offer, ...current }) => ({
            ...current,
            status: selection === undefined ? 'waiting-for-text' : 'attached',
            message: `Attached to ${session.game.title}.`,
            processIds: [...connected],
          }))

          yield* diagnostic('info', `LunaHook is running in process ${pid}.`)

          const saved = yield* Ref.get(session.savedHook)

          if (Option.isNone(saved) || !saved.value.inserted) {
            return
          }

          const { code } = saved.value

          yield* Ref.update(session.manualCodes, (codes) => new Set(codes).add(code))

          yield* session.hook
            .insertHook(pid, code)
            .pipe(Effect.catch((error) => diagnostic('warn', error.message)))
        })

        const onDisconnected = Effect.fnUntraced(function* (session: Session, pid: number) {
          const connected = yield* Ref.updateAndGet(session.connected, (pids) => {
            const rest = new Set(pids)

            rest.delete(pid)

            return rest
          })

          yield* patch((current) => ({ ...current, processIds: [...connected] }))

          if (connected.size === 0 && !(yield* Ref.get(session.watching))) {
            yield* gameGone(session)
          }
        })

        const onThread = Effect.fnUntraced(function* (session: Session, thread: ThreadEvent) {
          const manual = (yield* Ref.get(session.manualCodes)).has(thread.code)
          const lastSeenAt = yield* now

          yield* updateHooks((entries) => {
            const previous = entries.get(thread.thread)

            entries.set(thread.thread, {
              id: thread.thread,
              code: thread.code,
              name: thread.name,
              pid: thread.pid,
              ctx: thread.ctx,
              ctx2: thread.ctx2,
              samples: previous?.samples ?? [],
              updateCount: previous?.updateCount ?? 0,
              lastSeenAt,
              manual,
            })
          })

          const saved = yield* Ref.get(session.savedHook)
          const selection = yield* Ref.get(session.selection)

          if (
            Option.isNone(saved) ||
            saved.value.code !== thread.code ||
            selection?.byUser === true
          ) {
            return
          }

          const exact = saved.value.ctx === thread.ctx && saved.value.ctx2 === thread.ctx2

          if (exact && selection?.exact !== true) {
            return yield* select(session, { id: thread.thread, byUser: false, exact })
          }

          if (selection === undefined) {
            yield* select(session, { id: thread.thread, byUser: false, exact })
          }
        })

        const onText = Effect.fnUntraced(function* (session: Session, thread: string, raw: string) {
          const entry = (yield* Ref.get(hooks)).entries.get(thread)

          if (entry === undefined) {
            return
          }

          const text = applyTextPipeline(raw, yield* Ref.get(session.pipeline)).text

          const updated: HookEntry = {
            ...entry,
            samples: [...entry.samples, { raw, text }].slice(-maxSamples),
            updateCount: entry.updateCount + 1,
            lastSeenAt: yield* now,
          }

          yield* updateHooks((entries) => {
            entries.set(thread, updated)
          })

          yield* Ref.set(session.sawText, true)

          const selection = yield* Ref.get(session.selection)

          if (selection !== undefined) {
            return selection.id === thread ? yield* offerLine(session, text) : undefined
          }

          const score = scoreHook(session.settings.sourceLanguage, text, updated.updateCount)

          if (score.confidence === 'High') {
            yield* select(session, { id: thread, byUser: false, exact: false })
          }
        })

        const onRemoved = Effect.fnUntraced(function* (session: Session, thread: string) {
          yield* updateHooks((entries) => {
            entries.delete(thread)
          })

          const selection = yield* Ref.get(session.selection)

          if (selection?.id === thread && !selection.byUser) {
            yield* Ref.set(session.selection, undefined)
          }
        })

        const onEvent = (session: Session) => (event: HostEvent) =>
          HostEvent.$match(event, {
            Connected: ({ pid }) => onConnected(session, pid),
            Disconnected: ({ pid }) => onDisconnected(session, pid),
            Thread: (thread) => onThread(session, thread),
            Removed: ({ thread }) => onRemoved(session, thread),
            Text: ({ thread, text }) => onText(session, thread, text),
            Log: ({ level, message }) => diagnostic(level === 'error' ? 'error' : 'info', message),
            Stopped: () => failed(session, 'LunaHook stopped unexpectedly.'),
          })

        const gameOf = (gameId: string) =>
          games
            .get(gameId)
            .pipe(
              Effect.mapError(
                (error) => new OverlayError({ reason: 'not-found', message: error.message }),
              ),
            )

        const startWorkers = Effect.fnUntraced(function* (session: Session) {
          yield* Stream.runForEach(session.hook.events, onEvent(session)).pipe(
            Effect.forkIn(session.scope),
          )

          yield* Stream.fromQueue(session.lines).pipe(
            Stream.debounce(timing.debounce),
            Stream.runForEach((text) => Queue.offer(session.requests, { text, fresh: false })),
            Effect.forkIn(session.scope),
          )

          const requests = Stream.fromQueue(session.requests)

          const translations =
            session.settings.onNewLine === 'cancel'
              ? Stream.switchMap(requests, (request) =>
                  Stream.fromEffect(translate(session, request)),
                )
              : Stream.mapEffect(requests, (request) => translate(session, request))

          yield* Stream.runDrain(translations).pipe(Effect.forkIn(session.scope))
        })

        const begin = Effect.fnUntraced(function* (gameId: string, launching: boolean) {
          const previous = yield* Ref.get(active)

          if (Option.isSome(previous)) {
            yield* stopped(previous.value, 'Stopped.')
          }

          const game = yield* gameOf(gameId)
          const folder = yield* plugins.installedFolder('luna-hook')

          if (Option.isNone(folder)) {
            const message = 'Install LunaHook in Settings → Plugins to use the Translation Overlay.'

            yield* patch((current) => ({ ...current, status: 'setup-required', message }))

            return yield* notReady(message)
          }

          const settings = yield* preferences.settings
          const appearance = yield* preferences.appearance

          const model =
            settings.presetId === ''
              ? undefined
              : yield* llm.describe(settings.presetId).pipe(Effect.orElseSucceed(() => undefined))

          const scope = yield* Scope.make()

          const hook = yield* host.start(folder.value).pipe(
            Scope.provide(scope),
            Effect.tapError((error) =>
              Scope.close(scope, Exit.void).pipe(
                Effect.andThen(
                  patch((current) => ({ ...current, status: 'failed', message: error.message })),
                ),
              ),
            ),
          )

          const story = yield* store.story(gameId, settings.targetLanguage)

          const session: Session = {
            id: yield* Effect.orDie(crypto.randomUUIDv7()),
            game,
            scope,
            hook,
            settings,
            model,
            pipeline: yield* Ref.make(yield* store.pipeline(gameId)),
            savedHook: yield* Ref.make(yield* store.savedHook(gameId)),
            selection: yield* Ref.make<Selection | undefined>(undefined),
            connected: yield* Ref.make<ReadonlySet<number>>(new Set()),
            attempted: yield* Ref.make<ReadonlySet<number>>(new Set()),
            sawText: yield* Ref.make(false),
            watching: yield* Ref.make(false),
            launch: yield* Ref.make<LaunchMark | undefined>(undefined),
            manualCodes: yield* Ref.make<ReadonlySet<string>>(new Set()),
            lastLine: yield* Ref.make(''),
            lines: yield* Queue.unbounded<string>(),
            requests: yield* Queue.sliding<TranslationRequest>(1),
            pairs: yield* Ref.make<ReadonlyArray<ContextPair>>([]),
            story: yield* Ref.make(
              Option.match(story, {
                onNone: () => ({ summary: '', lineCount: 0 }),
                onSome: (saved) => ({ summary: saved.summary, lineCount: saved.lineCount }),
              }),
            ),
            sinceStory: yield* Ref.make<ReadonlyArray<ContextPair>>([]),
            refreshing: yield* Ref.make(false),
          }

          yield* Ref.set(hooks, { version: 0, entries: new Map() })
          yield* Ref.set(active, Option.some(session))

          yield* SubscriptionRef.set(state, {
            ...idleState,
            sessionId: session.id,
            gameId: game.id,
            gameTitle: game.title,
            status: launching ? 'launching' : 'attached',
            message: launching ? `Starting ${game.title}…` : `Attaching to ${game.title}…`,
            visible: true,
            appearance,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              ...(model === undefined ? {} : { modelName: model.modelName }),
            },
          })

          yield* startWorkers(session)

          return session
        })

        const watchLaunch = Effect.fnUntraced(function* (session: Session, started: Launch) {
          const attachNew = Effect.gen(function* () {
            const processes = yield* host.processes.pipe(Effect.orElseSucceed(() => []))
            const attempted = yield* Ref.get(session.attempted)

            const matches = matchGameProcesses(
              session.game,
              aliases.resolve(session.game, processes),
              process.pid,
            )
              .filter((match) => match.matchReason !== byNameOnly)
              .map((match) => match.processId)

            const candidates = new Set([
              ...matches,
              ...descendantsOf([started.processId], processes),
            ])

            yield* Effect.forEach(
              [...candidates].filter((pid) => !attempted.has(pid)),
              (pid) =>
                attachTo(session, pid).pipe(
                  Effect.catch((error) => diagnostic('warn', error.message)),
                ),
              { discard: true },
            )
          })

          yield* Ref.set(session.watching, true)

          yield* attachNew.pipe(
            Effect.repeat(Schedule.spaced(timing.poll)),
            Effect.timeoutOption(timing.searchFor),
            Effect.ensuring(Ref.set(session.watching, false)),
          )

          if ((yield* Ref.get(session.connected)).size > 0) {
            return
          }

          yield* patch((current) => ({
            ...current,
            message: `LunaHook could not find ${session.game.title}'s process. Pick it from the list.`,
          }))
        })

        const watchExit = Effect.fnUntraced(function* (session: Session, started: Launch) {
          const exit = yield* started.exited
          const connected = yield* Ref.get(session.connected)

          if ([...connected].every((pid) => pid === started.processId)) {
            yield* gameGone(session, exit)
          }
        })

        const launch = Effect.fn('TranslationOverlay.launch')(function* (gameId: string) {
          const session = yield* begin(gameId, true)

          const started = yield* launcher.launch(gameId).pipe(
            Effect.mapError(
              (error) =>
                new OverlayError({
                  reason: error.reason === 'not-ready' ? 'not-ready' : 'failed',
                  message: error.message,
                }),
            ),
            Effect.tapError((error) => failed(session, error.message)),
          )

          yield* Ref.set(session.launch, {
            processId: started.processId,
            locale: started.locale,
            at: yield* Clock.currentTimeMillis,
          })

          if (started.locale === 'system') {
            yield* attachTo(session, started.processId).pipe(
              Effect.catch((error) => diagnostic('warn', error.message)),
            )
          }

          yield* watchLaunch(session, started).pipe(Effect.forkIn(session.scope))
          yield* watchExit(session, started).pipe(Effect.forkIn(session.scope))
        }, lock.withPermits(1))

        const attach = Effect.fn('TranslationOverlay.attach')(function* (
          gameId: string,
          processId: number,
        ) {
          const session = yield* begin(gameId, false)

          yield* attachTo(session, processId).pipe(
            Effect.tapError((error) => failed(session, error.message)),
          )
        }, lock.withPermits(1))

        const current = Effect.flatMap(Ref.get(active), (session) =>
          Option.match(session, {
            onNone: () => Effect.fail(noSession()),
            onSome: (value) => Effect.succeed(value),
          }),
        )

        const attachElevated = Effect.fn('TranslationOverlay.attachElevated')(function* (
          processId: number,
        ) {
          const session = yield* current

          yield* patch(({ offer: _offer, ...state }) => ({
            ...state,
            status: 'attached',
            message: 'Waiting for administrator access…',
          }))

          yield* session.hook
            .elevate(processId)
            .pipe(
              Effect.tapError((error) =>
                patch((state) => ({ ...state, status: 'failed', message: error.message })),
              ),
            )
        })

        const retryAttach = Effect.gen(function* () {
          const session = yield* current
          const attempted = yield* Ref.get(session.attempted)
          const connected = yield* Ref.get(session.connected)

          yield* Effect.forEach(
            [...attempted].filter((pid) => !connected.has(pid)),
            (pid) => attachTo(session, pid),
            { discard: true },
          )
        }).pipe(Effect.withSpan('TranslationOverlay.retryAttach'))

        const stop = Effect.flatMap(Ref.get(active), (session) =>
          Option.match(session, {
            onNone: () => Effect.void,
            onSome: (value) => stopped(value, 'Stopped.'),
          }),
        )

        const findProcesses = Effect.fn('TranslationOverlay.findProcesses')(function* (
          gameId: string,
        ) {
          const game = yield* gameOf(gameId)

          return matchGameProcesses(game, aliases.resolve(game, yield* host.processes), process.pid)
        })

        const selectHook = Effect.fn('TranslationOverlay.selectHook')(function* (hookId: string) {
          const session = yield* current
          const entry = (yield* Ref.get(hooks)).entries.get(hookId)

          if (entry === undefined) {
            return yield* new OverlayError({
              reason: 'not-found',
              message: 'This hook is no longer reporting text.',
            })
          }

          const sample = latestText(entry)

          const saved: SavedHook = {
            code: entry.code,
            name: entry.name,
            ctx: entry.ctx,
            ctx2: entry.ctx2,
            inserted: entry.manual,
            savedAt: yield* now,
            ...(sample === '' ? {} : { sample }),
          }

          yield* store.saveHook(session.game.id, saved)
          yield* Ref.set(session.savedHook, Option.some(saved))
          yield* select(session, { id: hookId, byUser: true, exact: true })
        })

        const insertHookCode = Effect.fn('TranslationOverlay.insertHookCode')(function* (
          code: string,
        ) {
          const session = yield* current
          const trimmed = code.trim()

          if (trimmed === '') {
            return yield* new OverlayError({
              reason: 'invalid',
              message: 'Enter a hook code.',
              field: 'code',
            })
          }

          const connected = yield* Ref.get(session.connected)

          if (connected.size === 0) {
            return yield* new OverlayError({
              reason: 'conflict',
              message: 'Wait until LunaHook is running in the game.',
            })
          }

          yield* Ref.update(session.manualCodes, (codes) => new Set(codes).add(trimmed))

          yield* Effect.forEach(connected, (pid) => session.hook.insertHook(pid, trimmed), {
            discard: true,
          })
        })

        const retryTranslation = Effect.gen(function* () {
          const session = yield* current
          const source = (yield* SubscriptionRef.get(state)).sourceText

          if (source === undefined) {
            return yield* new OverlayError({
              reason: 'conflict',
              message: 'There is no line to retry.',
            })
          }

          yield* Queue.offer(session.requests, { text: source, fresh: true })
        }).pipe(Effect.withSpan('TranslationOverlay.retryTranslation'))

        const reprocess = Effect.fnUntraced(function* (gameId: string, pipeline: TextPipeline) {
          const session = yield* Ref.get(active)

          if (Option.isNone(session) || session.value.game.id !== gameId) {
            return
          }

          yield* Ref.set(session.value.pipeline, pipeline)

          yield* updateHooks((entries) => {
            for (const [id, entry] of entries) {
              entries.set(id, {
                ...entry,
                samples: entry.samples.map((sample) => ({
                  raw: sample.raw,
                  text: applyTextPipeline(sample.raw, pipeline).text,
                })),
              })
            }
          })
        })

        const savePipeline = Effect.fn('TranslationOverlay.savePipeline')(function* (
          gameId: string,
          pipeline: TextPipeline,
        ) {
          yield* gameOf(gameId)
          yield* store.savePipeline(gameId, pipeline)
          yield* reprocess(gameId, pipeline)

          return pipeline
        })

        const resetPipeline = Effect.fn('TranslationOverlay.resetPipeline')(function* (
          gameId: string,
        ) {
          yield* store.resetPipeline(gameId)
          yield* reprocess(gameId, defaultTextPipeline)

          return defaultTextPipeline
        })

        const overlayGame = Effect.fn('TranslationOverlay.overlayGame')(function* (gameId: string) {
          yield* gameOf(gameId)

          const settings = yield* preferences.settings
          const savedHook = yield* store.savedHook(gameId)
          const story = yield* store.story(gameId, settings.targetLanguage)

          return {
            pipeline: yield* store.pipeline(gameId),
            ...(Option.isSome(savedHook) ? { savedHook: savedHook.value } : {}),
            ...(Option.isSome(story) ? { story: story.value } : {}),
          } satisfies OverlayGame
        })

        const resetStory = Effect.fn('TranslationOverlay.resetStory')(function* (gameId: string) {
          yield* store.resetStory(gameId)

          const session = yield* Ref.get(active)

          if (Option.isSome(session) && session.value.game.id === gameId) {
            yield* Ref.set(session.value.story, { summary: '', lineCount: 0 })
            yield* Ref.set(session.value.sinceStory, [])
          }
        })

        const submitText = Effect.fn('TranslationOverlay.submitText')(function* (text: string) {
          const session = yield* Ref.get(active)
          const { visible } = yield* SubscriptionRef.get(state)

          if (Option.isSome(session) && visible) {
            yield* offerLine(session.value, text)
          }
        })

        const hookList = Effect.gen(function* () {
          const session = yield* Ref.get(active)
          const snapshot = yield* Ref.get(hooks)

          if (Option.isNone(session)) {
            return { version: snapshot.version, list: [] }
          }

          const selection = yield* Ref.get(session.value.selection)
          const { sourceLanguage } = session.value.settings

          const list = [...snapshot.entries.values()]
            .map((entry) => toOverlayHook(entry, selection, sourceLanguage))
            .toSorted(
              (left, right) => right.score - left.score || right.updateCount - left.updateCount,
            )

          return { version: snapshot.version, list }
        })

        const window = SubscriptionRef.changes(state).pipe(
          Stream.map((overlay) =>
            OverlayWindow.make({
              open: overlay.sessionId !== undefined,
              visible: overlay.visible,
              locked: overlay.appearance.locked,
            }),
          ),
          Stream.changesWith(sameWindow),
          Stream.mapEffect((message) =>
            message.open
              ? Effect.map(preferences.bounds, (bounds) =>
                  Option.isSome(bounds) ? { ...message, bounds: bounds.value } : message,
                )
              : Effect.succeed(message),
          ),
        )

        return TranslationOverlay.of({
          state: SubscriptionRef.changes(state),
          hooks: Stream.fromEffectSchedule(hookList, Schedule.spaced(timing.hooksEvery)).pipe(
            Stream.changesWith((left, right) => left.version === right.version),
            Stream.map((snapshot) => snapshot.list),
          ),
          window,
          launch,
          attach,
          attachElevated,
          retryAttach,
          stop,
          findProcesses,
          selectHook,
          insertHookCode,
          setVisible: (visible) => patch((overlay) => ({ ...overlay, visible })),
          setPaused: (paused) => patch((overlay) => ({ ...overlay, paused })),
          saveAppearance: (appearance) =>
            Effect.tap(preferences.saveAppearance(appearance), (saved) =>
              patch((overlay) => ({ ...overlay, appearance: saved })),
            ),
          retryTranslation,
          overlayGame,
          savePipeline,
          resetPipeline,
          resetStory,
          submitText,
        })
      }),
    )

  static readonly layer = TranslationOverlay.layerWith({
    debounce: '150 millis',
    poll: '1 second',
    searchFor: '20 seconds',
    crashWithin: '15 seconds',
    hooksEvery: '250 millis',
  })
}

export const TranslationOverlayRpcLive = TranslationOverlayRpc.toLayer(
  Effect.gen(function* () {
    const overlay = yield* TranslationOverlay
    const preferences = yield* OverlayPreferences

    return TranslationOverlayRpc.of({
      getOverlaySettings: () => preferences.settings,
      saveOverlaySettings: (settings) => preferences.saveSettings(settings),
      watchOverlay: () => overlay.state,
      watchOverlayHooks: () => overlay.hooks,
      getOverlayGame: ({ gameId }) => overlay.overlayGame(gameId),
      saveTextPipeline: ({ gameId, pipeline }) => overlay.savePipeline(gameId, pipeline),
      resetTextPipeline: ({ gameId }) => overlay.resetPipeline(gameId),
      previewTextPipeline: ({ text, pipeline }) =>
        Effect.succeed(applyTextPipeline(text, pipeline)),
      resetStory: ({ gameId }) => overlay.resetStory(gameId),
      launchWithOverlay: ({ gameId }) => overlay.launch(gameId),
      findGameProcesses: ({ gameId }) => overlay.findProcesses(gameId),
      attachOverlay: ({ gameId, processId }) => overlay.attach(gameId, processId),
      attachOverlayElevated: ({ processId }) => overlay.attachElevated(processId),
      retryAttach: () => overlay.retryAttach,
      stopOverlay: () => overlay.stop,
      selectHook: ({ hookId }) => overlay.selectHook(hookId),
      insertHookCode: ({ code }) => overlay.insertHookCode(code),
      setOverlayVisible: ({ visible }) => overlay.setVisible(visible),
      setOverlayPaused: ({ paused }) => overlay.setPaused(paused),
      saveOverlayAppearance: (appearance) => overlay.saveAppearance(appearance),
      retryTranslation: () => overlay.retryTranslation,
    })
  }),
)
