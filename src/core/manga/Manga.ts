import {
  Cause,
  Clock,
  Config,
  Crypto,
  DateTime,
  Effect,
  FiberHandle,
  FileSystem,
  Option,
  type Path,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  defaultMangaSettings,
  languageName,
  MangaError,
  MangaRpc,
  MangaRun,
  type MangaRuntimeState,
  MangaSettings,
  type PageStage,
  type RecentPage,
} from '#contract/Manga'
import { NotEnoughSpace, type SpaceShortfall } from '#contract/Storage'
import { type Completion, LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import { DiskSpace, nextFileBytes } from '../platform/DiskSpace'
import * as SettingsStore from '../platform/SettingsStore'
import { Plugins } from '../plugins/Plugins'
import {
  cleanSource,
  isTranslatable,
  linesPrompt,
  parseLines,
  sampleExchange,
  systemPrompt,
} from './MangaPrompt'
import { isValidFolderName, listPages, type MangaPage } from './MangaPages'
import { MangaRuntime, RunEvent, type RunHandle } from './MangaRuntime'
import { workerOptions } from './MangaOptions'

const RunRow = Schema.Struct({ run: Schema.fromJsonString(MangaRun) })

const encodeRun = Schema.encodeEffect(Schema.fromJsonString(MangaRun))

export const mangaSettingsKey = 'manga-translation'

const historyLimit = 50

const problemLimit = 50

const splitDepth = 3

const stageLabels: Record<PageStage, string> = {
  detecting: 'finding text',
  reading: 'reading text',
  translating: 'translating',
  cleaning: 'cleaning',
  lettering: 'lettering',
}

const invalid = (field: string, message: string) =>
  new MangaError({ reason: 'invalid', field, message })

const isHexColor = (value: string) => /^#[\da-f]{6}$/i.test(value)

const between = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max

const sanitize = (settings: MangaSettings) =>
  Effect.gen(function* () {
    const outputFolderName = settings.outputFolderName.trim()
    const font = settings.font.trim()

    if (!isValidFolderName(outputFolderName)) {
      return yield* invalid(
        'outputFolderName',
        'Enter a folder name without slashes or special characters.',
      )
    }

    if (font === '') {
      return yield* invalid('font', 'Choose a font.')
    }

    if (
      !between(settings.minFontSize, 6, 200) ||
      !between(settings.maxFontSize, settings.minFontSize, 300)
    ) {
      return yield* invalid(
        'maxFontSize',
        'The largest size must be at least the smallest, and both between 6 and 300.',
      )
    }

    if (settings.textColor !== 'auto' && !isHexColor(settings.textColor)) {
      return yield* invalid('textColor', 'Choose a text colour.')
    }

    if (!isHexColor(settings.borderColor)) {
      return yield* invalid('borderColor', 'Choose an outline colour.')
    }

    if (!between(settings.timeoutSeconds, 5, 900)) {
      return yield* invalid('timeoutSeconds', 'Use a timeout between 5 and 900 seconds.')
    }

    if (!between(settings.retryAttempts, 1, 10)) {
      return yield* invalid('retryAttempts', 'Use between 1 and 10 attempts.')
    }

    if (!between(settings.parallelRequests, 1, 16)) {
      return yield* invalid('parallelRequests', 'Use between 1 and 16 requests at once.')
    }

    if (!between(settings.pagesAhead, 1, 8)) {
      return yield* invalid('pagesAhead', 'Use between 1 and 8 pages ahead.')
    }

    if (!between(settings.outputQuality, 1, 100)) {
      return yield* invalid('outputQuality', 'Use a quality between 1 and 100.')
    }

    return { ...settings, presetId: settings.presetId.trim(), outputFolderName, font }
  })

export const readableError = (message: string) => message.replace(/^\w+\.\w+: /, '')

interface TrackedPage {
  readonly status: 'running' | 'done' | 'failed'
  readonly startedAt: number
  readonly stage?: PageStage
  readonly regions?: number
  readonly seconds?: number
  readonly message?: string
}

const finishedShown = 3

export const recentPages = (
  pages: ReadonlyArray<MangaPage>,
  tracked: ReadonlyMap<number, TrackedPage>,
  finishedOrder: ReadonlyArray<number>,
): ReadonlyArray<RecentPage> => {
  const nameOf = (page: number) => pages[page]?.name ?? `page ${page + 1}`

  const finished = finishedOrder.slice(-finishedShown).map((page): RecentPage => {
    const { status, regions, seconds, message } = tracked.get(page) ?? { status: 'done' }

    return {
      name: nameOf(page),
      status: status === 'failed' ? 'failed' : 'done',
      ...(regions === undefined ? {} : { regions }),
      ...(seconds === undefined ? {} : { seconds }),
      ...(message === undefined ? {} : { message }),
    }
  })

  const running = [...tracked]
    .filter(([, page]) => page.status === 'running')
    .toSorted(([left], [right]) => left - right)
    .map(([page, { stage }]): RecentPage => ({
      name: nameOf(page),
      status: 'running',
      ...(stage === undefined ? {} : { stage }),
    }))

  const next = pages.findIndex((_, page) => !tracked.has(page))

  return [
    ...finished,
    ...running,
    ...(next === -1 ? [] : [{ name: nameOf(next), status: 'pending' as const }]),
  ]
}

type Outcome =
  | { readonly cancelled: boolean; readonly seconds: number | undefined }
  | { readonly error: string }

interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: number | undefined
}

export const MangaRpcLive = MangaRpc.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const llm = yield* LlmClient
    const plugins = yield* Plugins
    const runtime = yield* MangaRuntime
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const disk = yield* DiskSpace
    const resources = yield* Config.String('WENBU_RESOURCES_DIR')
    const dataDir = yield* Config.String('WENBU_DATA_DIR')
    const files = yield* Effect.context<Path.Path | FileSystem.FileSystem>()

    const store = SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      MangaSettings,
      defaultMangaSettings,
    )

    const active = yield* FiberHandle.make()
    const handle = yield* SubscriptionRef.make<Option.Option<RunHandle>>(Option.none())

    const now = Effect.map(DateTime.now, DateTime.formatIso)

    const recentRuns = SqlSchema.findAll({
      Request: Schema.Number,
      Result: RunRow,
      execute: (limit) => sql`SELECT run FROM manga_runs ORDER BY started_at DESC LIMIT ${limit}`,
    })

    const save = Effect.fnUntraced(function* (run: MangaRun) {
      const json = yield* encodeRun(run)

      yield* sql`INSERT INTO manga_runs ${sql.insert({
        id: run.id,
        started_at: run.startedAt,
        status: run.status,
        run: json,
      })} ON CONFLICT(id) DO UPDATE SET status = excluded.status, run = excluded.run`
    }, Effect.orDie)

    for (const { run } of yield* Effect.orDie(recentRuns(historyLimit))) {
      if (run.status === 'running') {
        const { activity: _activity, ...rest } = run

        yield* save(
          MangaRun.make({
            ...rest,
            status: 'failed',
            error: 'Wenbu closed before this run finished. Start it again to translate the rest.',
          }),
        )
      }
    }

    const runs = yield* SubscriptionRef.make<ReadonlyArray<MangaRun>>(
      (yield* Effect.orDie(recentRuns(historyLimit))).map((row) => row.run),
    )

    const update = (id: string, change: (run: MangaRun) => MangaRun) =>
      SubscriptionRef.update(runs, (all) => all.map((run) => (run.id === id ? change(run) : run)))

    const getSettings = Effect.orDie(store.get(mangaSettingsKey))

    yield* (yield* PresetReferences).register({
      area: 'Manga translation',
      uses: (presetIds) => Effect.map(getSettings, (settings) => presetIds.has(settings.presetId)),
      clear: (presetIds) =>
        Effect.flatMap(getSettings, (settings) =>
          presetIds.has(settings.presetId)
            ? Effect.orDie(store.set(mangaSettingsKey, { ...settings, presetId: '' }))
            : Effect.void,
        ),
    })

    const pluginFolder = Effect.flatMap(
      plugins.installedFolder('manga-image-translator'),
      (folder) =>
        Option.match(folder, {
          onNone: () =>
            Effect.fail(
              new MangaError({
                reason: 'plugin-missing',
                message: 'Install manga-image-translator on the Plugins page first.',
              }),
            ),
          onSome: Effect.succeed,
        }),
    )

    const pagesOf = (folder: string, settings: MangaSettings) =>
      listPages(folder.trim(), settings).pipe(Effect.provideContext(files))

    const translateLines = (
      settings: MangaSettings,
      lines: ReadonlyArray<string>,
      usage: Usage,
      depth: number,
    ): Effect.Effect<ReadonlyArray<string>, MangaError> =>
      Effect.gen(function* () {
        const language = languageName(settings.targetLanguage)
        let lastError = 'The reply did not have every numbered line.'

        for (let attempt = 0; attempt < settings.retryAttempts; attempt++) {
          const completion: Option.Option<Completion> = yield* llm
            .complete({
              presetId: settings.presetId,
              feature: 'manga',
              system: systemPrompt(language),
              history: sampleExchange(language),
              prompt: linesPrompt(lines),
              timeout: `${settings.timeoutSeconds} seconds`,
            })
            .pipe(
              Effect.map(Option.some),
              Effect.catch((error) => {
                lastError = readableError(error.message)

                return Effect.succeedNone
              }),
            )

          if (Option.isNone(completion)) {
            continue
          }

          usage.inputTokens += completion.value.usage.inputTokens
          usage.outputTokens += completion.value.usage.outputTokens

          if (completion.value.costUsd !== undefined) {
            usage.costUsd = (usage.costUsd ?? 0) + completion.value.costUsd
          }

          const parsed = parseLines(completion.value.text, lines.length)

          if (Option.isSome(parsed)) {
            return parsed.value
          }

          lastError = 'The reply did not have every numbered line.'
        }

        if (lines.length > 1 && depth < splitDepth) {
          const middle = Math.ceil(lines.length / 2)
          const left = yield* translateLines(settings, lines.slice(0, middle), usage, depth + 1)
          const right = yield* translateLines(settings, lines.slice(middle), usage, depth + 1)

          return [...left, ...right]
        }

        return yield* new MangaError({ reason: 'failed', message: lastError })
      })

    const translatePage = Effect.fnUntraced(function* (
      settings: MangaSettings,
      texts: ReadonlyArray<string>,
      usage: Usage,
    ) {
      const cleaned = texts.map(cleanSource)
      const wanted = cleaned.flatMap((text, index) => (isTranslatable(text) ? [index] : []))

      if (wanted.length === 0) {
        return texts
      }

      const translated = yield* translateLines(
        settings,
        wanted.map((index) => cleaned[index] ?? ''),
        usage,
        0,
      )

      const byIndex = new Map(wanted.map((index, at) => [index, translated[at] ?? '']))

      return texts.map((text, index) => byIndex.get(index) ?? text)
    })

    const runOptions = (settings: MangaSettings, folder: string) =>
      workerOptions(settings, folder, { resources, dataDir }).pipe(Effect.provideContext(files))

    const execute = Effect.fnUntraced(function* (
      runId: string,
      settings: MangaSettings,
      plugin: string,
      pages: ReadonlyArray<MangaPage>,
    ) {
      const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: undefined }
      const problems: Array<{ page: string; message: string }> = []
      const nameOf = (page: number) => pages[page]?.name ?? `page ${page + 1}`
      const tracked = new Map<number, TrackedPage>()
      const finishedOrder: Array<number> = []
      let done = 0
      let failed = 0
      let space: SpaceShortfall | undefined

      const publishUsage = update(runId, (run) =>
        MangaRun.make({
          ...run,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
          },
        }),
      )

      const progress = (activity?: string) =>
        update(runId, (run) => {
          const { activity: _previous, ...rest } = run

          return MangaRun.make({
            ...rest,
            pages: { ...run.pages, done, failed },
            problems: [...problems],
            recentPages: recentPages(pages, tracked, finishedOrder),
            ...(activity === undefined ? {} : { activity }),
          })
        })

      const track = (page: number, change: (current: TrackedPage) => TrackedPage) =>
        Effect.map(Clock.currentTimeMillis, (millis) => {
          tracked.set(page, change(tracked.get(page) ?? { status: 'running', startedAt: millis }))
        })

      const finishPage = (page: number, patch: Partial<TrackedPage>) =>
        Effect.flatMap(Clock.currentTimeMillis, (millis) => {
          const current = tracked.get(page) ?? { status: 'running' as const, startedAt: millis }

          tracked.set(page, { ...current, ...patch, seconds: (millis - current.startedAt) / 1000 })
          finishedOrder.push(page)

          return progress()
        })

      const noteProblem = (page: number, message: string) => {
        if (problems.length < problemLimit) {
          problems.push({ page: nameOf(page), message })
        }
      }

      const run = yield* runtime.run(plugin, {
        options: yield* runOptions(settings, plugin),
        pages: pages.map((page) => ({ source: page.source, output: page.output })),
      })

      yield* SubscriptionRef.set(handle, Option.some(run))

      const outcome: { value: Outcome } = { value: { error: 'The run stopped.' } }

      yield* run.events.pipe(
        Stream.runForEach((event) =>
          RunEvent.$match(event, {
            LoadingModels: () => progress('Loading the models'),
            ModelsLoaded: () => progress('Starting'),
            PageStarted: ({ page }) =>
              disk.ensure(pages[page]?.output ?? plugin, nextFileBytes).pipe(
                Effect.catchTag('NotEnoughSpace', (error) => {
                  space = error.shortfall

                  return run.cancel
                }),
                Effect.andThen(track(page, (current) => ({ ...current, stage: 'detecting' }))),
                Effect.andThen(
                  progress(`Page ${page + 1} of ${pages.length}: ${stageLabels.detecting}`),
                ),
              ),
            Stage: ({ page, stage }) =>
              track(page, (current) => ({ ...current, stage })).pipe(
                Effect.andThen(
                  progress(`Page ${page + 1} of ${pages.length}: ${stageLabels[stage]}`),
                ),
              ),
            Translate: ({ id, texts }) =>
              translatePage(settings, texts, usage).pipe(
                Effect.matchEffect({
                  onSuccess: (translations) => run.answer(id, { translations }),
                  onFailure: (error) => run.answer(id, { error: error.message }),
                }),
                Effect.andThen(publishUsage),
                Effect.forkScoped,
                Effect.asVoid,
              ),
            PageDone: ({ page, regions }) =>
              Effect.suspend(() => {
                done += 1

                return Effect.andThen(
                  Effect.logDebug('Manga page done').pipe(Effect.annotateLogs({ page, regions })),
                  finishPage(page, { status: 'done', regions }),
                )
              }),
            PageFailed: ({ page, message }) =>
              Effect.suspend(() => {
                failed += 1
                noteProblem(page, message)

                return Effect.andThen(
                  Effect.logWarning('Manga page failed').pipe(
                    Effect.annotateLogs({ page, error: message }),
                  ),
                  finishPage(page, { status: 'failed', message }),
                )
              }),
            Done: ({ cancelled, seconds }) =>
              Effect.sync(() => (outcome.value = { cancelled, seconds })),
            Failed: ({ message }) => Effect.sync(() => (outcome.value = { error: message })),
          }),
        ),
        Effect.onInterrupt(() => run.cancel),
        Effect.scoped,
        Effect.ensuring(SubscriptionRef.set(handle, Option.none())),
      )

      return { outcome: outcome.value, done, failed, space }
    })

    const finish = Effect.fnUntraced(function* (
      runId: string,
      result: {
        status: MangaRun['status']
        seconds?: number | undefined
        error?: string | undefined
        space?: SpaceShortfall | undefined
      },
    ) {
      const finishedAt = yield* now

      yield* update(runId, (run) => {
        const {
          activity: _activity,
          error: _error,
          seconds: _seconds,
          recentPages: _recentPages,
          ...rest
        } = run

        return MangaRun.make({
          ...rest,
          status: result.status,
          finishedAt,
          ...(result.seconds === undefined ? {} : { seconds: result.seconds }),
          ...(result.error === undefined ? {} : { error: result.error }),
          ...(result.space === undefined ? {} : { space: result.space }),
        })
      })

      const run = (yield* SubscriptionRef.get(runs)).find((candidate) => candidate.id === runId)

      if (run !== undefined) {
        yield* save(run)
      }

      yield* (result.status === 'failed' ? Effect.logWarning : Effect.logInfo)(
        'Manga run finished',
      ).pipe(
        Effect.annotateLogs({
          run: runId,
          status: result.status,
          done: run?.pages.done,
          failed: run?.pages.failed,
          seconds: result.seconds,
          error: result.error,
        }),
      )
    })

    const start = Effect.fn('Manga.start')(function* (folder: string) {
      if (Option.isSome(yield* FiberHandle.get(active))) {
        return yield* new MangaError({
          reason: 'conflict',
          message: 'A manga folder is already being translated.',
        })
      }

      const settings = yield* getSettings

      if (settings.presetId === '') {
        return yield* invalid('presetId', 'Choose a preset in Settings › Translation › Manga.')
      }

      const preset = yield* llm
        .describe(settings.presetId)
        .pipe(
          Effect.mapError(() =>
            invalid('presetId', 'The chosen preset no longer exists. Choose another.'),
          ),
        )

      const plugin = yield* pluginFolder
      const { outputFolder, pages } = yield* pagesOf(folder, settings)

      if (pages.length === 0) {
        return yield* new MangaError({
          reason: 'invalid',
          message: 'The folder has no manga pages.',
        })
      }

      const todo =
        settings.existingPages === 'skip' ? pages.filter((page) => !page.translated) : pages

      const skipped = pages.length - todo.length

      const sourceBytes = yield* Effect.forEach(todo, (page) =>
        fs.stat(page.source).pipe(
          Effect.map((info) => Number(info.size)),
          Effect.orElseSucceed(() => 0),
        ),
      )

      yield* disk.ensure(outputFolder, 2 * sourceBytes.reduce((sum, size) => sum + size, 0))

      const run = MangaRun.make({
        id: yield* Effect.orDie(crypto.randomUUIDv7()),
        folder: folder.trim(),
        outputFolder,
        status: 'running',
        startedAt: yield* now,
        presetName: `${preset.presetName} · ${preset.modelName}`,
        targetLanguage: settings.targetLanguage,
        pages: { total: pages.length, done: 0, failed: 0, skipped },
        activity: 'Starting the manga worker',
        usage: { inputTokens: 0, outputTokens: 0 },
        problems: [],
      })

      yield* save(run)
      yield* SubscriptionRef.update(runs, (all) => [run, ...all].slice(0, historyLimit))

      yield* Effect.logInfo('Manga run started').pipe(
        Effect.annotateLogs({
          run: run.id,
          pages: pages.length,
          todo: todo.length,
          skipped,
          target: settings.targetLanguage,
        }),
      )

      if (todo.length === 0) {
        yield* finish(run.id, { status: 'translated' })

        return run.id
      }

      const workflow = execute(run.id, settings, plugin, todo).pipe(
        Effect.matchCauseEffect({
          onSuccess: ({ outcome, done, failed, space }) => {
            if (space !== undefined) {
              return finish(run.id, {
                status: done > 0 ? 'partial' : 'failed',
                error: new NotEnoughSpace(space).message,
                space,
              })
            }

            if ('error' in outcome) {
              return finish(run.id, {
                status: done > 0 ? 'partial' : 'failed',
                error: outcome.error,
              })
            }

            if (outcome.cancelled) {
              return finish(run.id, { status: 'cancelled', seconds: outcome.seconds })
            }

            return finish(run.id, {
              status: failed > 0 ? (done > 0 ? 'partial' : 'failed') : 'translated',
              seconds: outcome.seconds,
              ...(failed > 0 && done === 0 ? { error: 'No page could be translated.' } : {}),
            })
          },
          onFailure: (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? finish(run.id, { status: 'cancelled' })
              : Effect.andThen(
                  Cause.hasDies(cause)
                    ? Effect.logError('Manga run failed unexpectedly', cause)
                    : Effect.void,
                  finish(run.id, {
                    status: 'failed',
                    error: Option.match(Cause.findErrorOption(cause), {
                      onNone: () => 'Something went wrong. Try again.',
                      onSome: (error) => error.message,
                    }),
                  }),
                ),
        }),
      )

      yield* FiberHandle.run(active, workflow)

      return run.id
    })

    const cancel = Effect.fn('Manga.cancel')(function* (runId: string) {
      const current = (yield* SubscriptionRef.get(runs)).find((run) => run.id === runId)
      const run = yield* SubscriptionRef.get(handle)

      if (current?.status === 'running' && Option.isSome(run)) {
        yield* run.value.cancel
      }
    })

    const remove = Effect.fn('Manga.remove')(function* (runId: string) {
      const current = (yield* SubscriptionRef.get(runs)).find((run) => run.id === runId)

      if (current?.status === 'running') {
        return yield* new MangaError({ reason: 'conflict', message: 'Cancel the run first.' })
      }

      yield* Effect.orDie(sql`DELETE FROM manga_runs WHERE id = ${runId}`)
      yield* SubscriptionRef.update(runs, (all) => all.filter((run) => run.id !== runId))
    })

    const runtimeState = Stream.zipLatest(plugins.state, runtime.state).pipe(
      Stream.map(([pluginState, state]): MangaRuntimeState => {
        const plugin = pluginState.plugins.find(
          (candidate) => candidate.id === 'manga-image-translator',
        )

        return plugin?.installed?.test.passed === true ? state : { status: 'not-installed' }
      }),
      Stream.changesWith(
        (left, right) =>
          left.status === right.status &&
          left.device === right.device &&
          left.message === right.message,
      ),
    )

    return MangaRpc.of({
      getMangaSettings: () => getSettings,
      saveMangaSettings: Effect.fn('Manga.saveSettings')(function* (settings) {
        const clean = yield* sanitize(settings)

        yield* Effect.orDie(store.set(mangaSettingsKey, clean))

        return clean
      }),
      checkMangaFolder: Effect.fn('Manga.checkFolder')(function* ({ folder }) {
        const settings = yield* getSettings
        const { outputFolder, pages } = yield* pagesOf(folder, settings)

        return {
          folder: folder.trim(),
          outputFolder,
          pages: pages.length,
          translatedPages: pages.filter((page) => page.translated).length,
        }
      }),
      startMangaRun: ({ folder }) => start(folder),
      cancelMangaRun: ({ runId }) => cancel(runId),
      removeMangaRun: ({ runId }) => remove(runId),
      watchMangaRuns: () => SubscriptionRef.changes(runs),
      watchMangaRuntime: () => runtimeState,
    })
  }),
)
