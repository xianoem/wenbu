import { Cause, Effect, Exit, FiberMap, Option, Schema, Stream, SubscriptionRef } from 'effect'
import { SqlSchema } from 'effect/sql'
import {
  modeValues,
  type RunStatus,
  type SpendLimit,
  type StepId,
  stepIds,
  TranslationError,
  TranslationRun,
  type TranslationScope,
  type TranslationSettings,
  type TranslationStep,
} from '#contract/GameTranslation'
import { type Game, isTranslatable } from '#contract/Library'
import type { ModelPrice } from '#contract/Llm'
import type { ApplySkipReason } from '../rpgmaker/ApplyTranslations'
import {
  prepareEntries,
  type SkipReason,
  type TextEntry,
  type TranslationItem,
} from '../rpgmaker/TextEntries'
import { batchesOf, batchPrompt, parseReply, systemPrompt } from './Batches'
import { batchTokens, costOf, estimateCost } from './CostEstimate'
import { diffSources, pendingOf } from './SourceDiff'
import { makeLedger, type Spend, type SpendLedger } from './SpendLimit'
import { appliedTranslations } from './TranslationLines'
import {
  asTranslationError,
  count,
  failed,
  readableError,
  type TranslationShared,
} from './TranslationShared'

const RunRow = Schema.Struct({ run: Schema.fromJsonString(TranslationRun) })

const encodeRun = Schema.encodeEffect(Schema.fromJsonString(TranslationRun))

const noteLimit = 20

const errorNotes = (errors: ReadonlyMap<string, number>) =>
  [...errors].map(([message, times]) =>
    times === 1 ? message : `${message} (${times.toLocaleString('en-US')} batches)`,
  )

const skipLabels: Record<SkipReason, string> = {
  'coverage-disabled': 'turned off in settings',
  'non-string': 'not text',
  empty: 'empty',
  'plugin-tag': 'plugin tags',
  filename: 'file names',
  number: 'numbers',
  punctuation: 'punctuation only',
  'code-like': 'code values',
  'latin-text': 'already Latin text',
  'used-by-code': 'names the game’s code uses',
  'asset-name': 'names of game files',
  'control-codes': 'control codes only',
}

const applySkipLabels: Record<ApplySkipReason, string> = {
  'source-mismatch': 'changed since extraction',
  'broken-formatting': 'lost control codes or line breaks',
  'missing-location': 'no longer in the file',
}

const spendOf = (
  price: ModelPrice | undefined,
  inputTokens: number,
  outputTokens: number,
): Spend => ({
  usd: price === undefined ? 0 : costOf(price, inputTokens, outputTokens),
  tokens: inputTokens + outputTokens,
})

const limitLabel = (limit: SpendLimit | undefined) =>
  limit?.usd === undefined
    ? `${(limit?.tokens ?? 0).toLocaleString('en-US')}-token`
    : `$${limit.usd.toFixed(2)}`

const translateSummary = (translated: number, total: number, shortfall: string) =>
  translated < total
    ? `${count(translated, 'line')} of ${total.toLocaleString('en-US')} · ${shortfall}`
    : `All ${count(total, 'line')}`

const sanitize = (settings: TranslationSettings) => {
  const targetLanguage = settings.targetLanguage.trim()

  if (targetLanguage === '') {
    return Effect.fail(
      new TranslationError({
        reason: 'invalid',
        field: 'targetLanguage',
        message: 'Enter the language to translate into.',
      }),
    )
  }

  return Effect.succeed({
    ...settings,
    targetLanguage,
    presetId: settings.presetId.trim(),
    ...(settings.mode === 'custom' ? {} : modeValues[settings.mode]),
  })
}

const withStep = (run: TranslationRun, id: StepId, patch: Partial<TranslationStep>) =>
  TranslationRun.make({
    ...run,
    steps: run.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
  })

export const makeTranslationRuns = Effect.fnUntraced(function* (shared: TranslationShared) {
  const {
    sql,
    games,
    gameData,
    disk,
    llm,
    crypto,
    lines,
    fileHashes,
    settingsStore,
    fibers,
    now,
    gameOf,
    getSettings,
    describePreset,
    ensureUnchanged,
    recordOriginals,
    writeToGame,
    storeLines,
  } = shared

  const ledgers = new Map<string, SpendLedger>()

  const latest = yield* SubscriptionRef.make<ReadonlyMap<string, TranslationRun | undefined>>(
    new Map(),
  )

  const runsOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: RunRow,
    execute: (gameId) =>
      sql`SELECT run FROM translation_runs WHERE game_id = ${gameId} ORDER BY started_at DESC`,
  })

  const unfinishedRuns = SqlSchema.findAll({
    Request: Schema.Void,
    Result: RunRow,
    execute: () => sql`SELECT run FROM translation_runs WHERE status = 'running'`,
  })

  const save = Effect.fnUntraced(function* (run: TranslationRun) {
    const json = yield* encodeRun(run)

    yield* sql`INSERT INTO translation_runs ${sql.insert({
      id: run.id,
      game_id: run.gameId,
      started_at: run.startedAt,
      status: run.status,
      run: json,
    })} ON CONFLICT(id) DO UPDATE SET status = excluded.status, run = excluded.run`
  }, Effect.orDie)

  const publish = (gameId: string, run: TranslationRun | undefined) =>
    SubscriptionRef.update(latest, (runs) => new Map(runs).set(gameId, run))

  const update = (gameId: string, change: (run: TranslationRun) => TranslationRun) =>
    SubscriptionRef.update(latest, (runs) => {
      const run = runs.get(gameId)

      return run === undefined ? runs : new Map(runs).set(gameId, change(run))
    })

  const current = (gameId: string) =>
    Effect.map(SubscriptionRef.get(latest), (runs) => runs.get(gameId))

  for (const { run } of yield* Effect.orDie(unfinishedRuns())) {
    yield* save(
      TranslationRun.make({
        ...run,
        status: 'failed',
        error: 'Wenbu closed before this run finished. The game files were not changed.',
        steps: run.steps.map((step) =>
          step.status === 'running' ? { ...step, status: 'cancelled' as const } : step,
        ),
      }),
    )
  }

  const translate = Effect.fnUntraced(function* (
    gameId: string,
    settings: TranslationSettings,
    entries: ReadonlyArray<TextEntry>,
    items: ReturnType<typeof prepareEntries>['items'],
    keptLines: number,
    ledger: SpendLedger,
    price: ModelPrice | undefined,
  ) {
    const translations = new Map<string, string>()
    const errors = new Map<string, number>()
    let translatedLines = keptLines

    const entryIdsOf = new Map(items.map((item) => [item.id, item.entryIds]))

    for (let round = 1; round <= settings.retryRounds; round++) {
      const pending = items.filter((item) => !translations.has(item.id))

      if (pending.length === 0) {
        break
      }

      const batches = batchesOf(pending, settings.chunkTokens / 2 ** (round - 1))

      yield* update(gameId, (run) =>
        withStep(run, 'translate', {
          summary: `${count(translatedLines, 'line')} of ${entries.length.toLocaleString('en-US')} · ${round === 1 ? count(batches.length, 'batch') : `round ${round}, ${count(batches.length, 'batch')} left`}`,
        }),
      )

      const send = (batch: ReadonlyArray<TranslationItem>, settled: { actual: Spend }) =>
        Effect.gen(function* () {
          const completion = yield* llm.complete({
            presetId: settings.presetId,
            feature: 'rpg-translation',
            gameId,
            system: systemPrompt,
            prompt: yield* batchPrompt(settings, batch),
            timeout: `${settings.timeoutSeconds} seconds`,
          })

          const found = yield* parseReply(completion.text, batch, settings).pipe(
            Effect.mapError(() => failed('The reply was not the JSON Wenbu asked for.')),
          )

          settled.actual = {
            usd:
              completion.costUsd ??
              spendOf(price, completion.usage.inputTokens, completion.usage.outputTokens).usd,
            tokens: completion.usage.inputTokens + completion.usage.outputTokens,
          }

          for (const [id, text] of found) {
            translations.set(id, text)
            translatedLines += entryIdsOf.get(id)?.length ?? 0
          }

          yield* lines.saveTranslations(
            gameId,
            [...found].flatMap(([id, text]) =>
              (entryIdsOf.get(id) ?? []).map((entryId) => ({ entryId, text })),
            ),
          )

          yield* Effect.logDebug('Batch translated').pipe(
            Effect.annotateLogs({
              round,
              items: batch.length,
              found: found.size,
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
            }),
          )

          yield* update(gameId, (run) =>
            withStep(
              TranslationRun.make({
                ...run,
                lines: { ...run.lines, translated: translatedLines },
                usage: {
                  inputTokens: run.usage.inputTokens + completion.usage.inputTokens,
                  outputTokens: run.usage.outputTokens + completion.usage.outputTokens,
                  ...(completion.costUsd === undefined && run.usage.costUsd === undefined
                    ? {}
                    : { costUsd: (run.usage.costUsd ?? 0) + (completion.costUsd ?? 0) }),
                },
              }),
              'translate',
              {
                summary: `${count(translatedLines, 'line')} of ${entries.length.toLocaleString('en-US')}${round > 1 ? ` · round ${round}` : ''}`,
              },
            ),
          )
        }).pipe(
          Effect.catch((error) => {
            const message = readableError(error.message)

            const logged = Effect.logWarning('Translation batch failed').pipe(
              Effect.annotateLogs({ round, items: batch.length, error: message }),
            )

            if (!errors.has(message) && errors.size >= noteLimit) {
              return logged
            }

            errors.set(message, (errors.get(message) ?? 0) + 1)

            return Effect.andThen(
              logged,
              update(gameId, (run) => withStep(run, 'translate', { notes: errorNotes(errors) })),
            )
          }),
        )

      yield* Effect.forEach(
        batches,
        (batch) =>
          Effect.gen(function* () {
            const tokens = yield* batchTokens(settings, batch)
            const estimate = spendOf(price, tokens.input, tokens.output)

            if (!(yield* ledger.reserve(estimate))) {
              return
            }

            const settled = { actual: { usd: 0, tokens: 0 } }

            yield* send(batch, settled).pipe(
              Effect.ensuring(Effect.suspend(() => ledger.settle(estimate, settled.actual))),
            )
          }),
        { concurrency: settings.workers, discard: true },
      )

      if (yield* ledger.stopped) {
        break
      }
    }

    return { notes: errorNotes(errors), translatedLines, stopped: yield* ledger.stopped }
  })

  const runWorkflow = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    scope: TranslationScope,
    ledger: SpendLedger,
    price: ModelPrice | undefined,
  ) {
    const step = (id: StepId, patch: Partial<TranslationStep>) =>
      update(game.id, (run) => withStep(run, id, patch))

    yield* step('prepare', { status: 'running' })

    const saved = yield* gameData.saveOriginals(game)

    yield* recordOriginals(game, saved)

    yield* step('prepare', {
      status: 'done',
      summary: {
        saved: 'Saved a copy of the original files',
        unpacked: 'Unpacked Game.rgss3a and kept it as the original',
        kept: 'Using the saved original files',
      }[saved],
    })

    yield* step('extract', { status: 'running' })

    const locations = yield* gameData.originalLocations(game)
    const prepared = prepareEntries(locations, settings, yield* gameData.protectedText(game))
    const files = new Set(prepared.entries.map((entry) => entry.file)).size

    const skipNotes = [...prepared.skipped]
      .toSorted(([, left], [, right]) => right - left)
      .map(
        ([reason, skippedCount]) =>
          `Skipped ${count(skippedCount, 'value')}: ${skipLabels[reason]}`,
      )

    const changes =
      prepared.entries.length === 0 ? undefined : yield* storeLines(game, prepared.entries)

    yield* update(game.id, (run) =>
      withStep(
        TranslationRun.make({ ...run, lines: { ...run.lines, total: prepared.entries.length } }),
        'extract',
        {
          status: prepared.entries.length === 0 ? 'failed' : 'done',
          summary: `${count(prepared.entries.length, 'line')} in ${count(files, 'file')}`,
          notes: changes === undefined ? skipNotes : [changes, ...skipNotes],
        },
      ),
    )

    if (prepared.entries.length === 0) {
      return yield* failed('No text to translate was found with the current settings.')
    }

    const pending = yield* lines.pending(game.id, scope)
    const translatedBefore = yield* lines.translations(game.id)

    const items = prepared.items.flatMap((item) => {
      const entryIds = item.entryIds.filter((entryId) => pending.has(entryId))

      return entryIds.length === 0 ? [] : [{ ...item, entryIds }]
    })

    const keptLines = prepared.entries.filter((entry) => translatedBefore.has(entry.id)).length

    yield* step('translate', { status: 'running' })

    const translated = yield* translate(
      game.id,
      settings,
      prepared.entries,
      items,
      keptLines,
      ledger,
      price,
    )

    const untranslated = prepared.entries.length - translated.translatedLines
    const limit = yield* ledger.limit

    if (translated.translatedLines === 0) {
      yield* step('translate', { status: 'failed', notes: translated.notes })

      return yield* failed(
        translated.stopped
          ? 'The spending limit was reached before any line was translated.'
          : 'The model translated no lines. Check the preset, then try again.',
      )
    }

    if (translated.stopped) {
      yield* update(game.id, (run) =>
        TranslationRun.make({ ...run, stopped: { reason: 'spend-limit', limit: limit ?? {} } }),
      )
    }

    yield* step('translate', {
      status: untranslated > 0 || translated.stopped ? 'warning' : 'done',
      summary: translateSummary(
        translated.translatedLines,
        prepared.entries.length,
        translated.stopped
          ? `stopped at the ${limitLabel(limit)} limit`
          : `${count(untranslated, 'line')} left after ${count(settings.retryRounds, 'round')}`,
      ),
      notes: translated.notes,
    })

    const stored = yield* lines.translations(game.id)

    const entries = prepared.entries.map((entry) => ({
      ...entry,
      dst: stored.get(entry.id) ?? '',
    }))

    yield* step('apply', { status: 'running' })

    const written = yield* writeToGame(game, settings, entries)

    const keptOriginal = [...written.skipped].map(
      ([reason, keptCount]) =>
        `Kept the original text of ${count(keptCount, 'line')}: ${applySkipLabels[reason]}`,
    )

    yield* update(game.id, (run) =>
      withStep(
        TranslationRun.make({ ...run, lines: { ...run.lines, written: written.written } }),
        'apply',
        {
          status: keptOriginal.length > 0 ? 'warning' : 'done',
          summary:
            written.unchanged === 0
              ? `${count(written.written, 'line')} written`
              : `${count(written.written, 'line')} written · ${written.unchanged.toLocaleString('en-US')} already the same`,
          notes: keptOriginal,
        },
      ),
    )

    const state = untranslated > 0 || keptOriginal.length > 0 ? 'partial' : 'translated'

    yield* games.setTranslation(game.id, state)

    return state satisfies RunStatus
  })

  const finish = (
    gameId: string,
    exit: Exit.Exit<RunStatus, TranslationError | { readonly message: string }>,
  ) =>
    Effect.gen(function* () {
      const finishedAt = yield* now
      const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

      const error = Exit.isFailure(exit)
        ? Option.match(Cause.findErrorOption(exit.cause), {
            onNone: () => (interrupted ? undefined : 'Something went wrong. Try again.'),
            onSome: (failure) => failure.message,
          })
        : undefined

      const status: RunStatus = Exit.isSuccess(exit)
        ? exit.value
        : interrupted
          ? 'cancelled'
          : 'failed'

      yield* update(gameId, (run) =>
        TranslationRun.make({
          ...run,
          status,
          finishedAt,
          ...(error === undefined ? {} : { error }),
          steps: run.steps.map((step) =>
            step.status === 'running'
              ? { ...step, status: interrupted ? 'cancelled' : 'failed' }
              : step,
          ),
        }),
      )

      const run = yield* current(gameId)

      if (run !== undefined) {
        yield* save(run)
      }

      const outcome = {
        game: gameId,
        status,
        translated: run?.lines.translated ?? 0,
        total: run?.lines.total ?? 0,
        inputTokens: run?.usage.inputTokens ?? 0,
        outputTokens: run?.usage.outputTokens ?? 0,
      }

      if (Exit.isFailure(exit) && !interrupted && Cause.hasDies(exit.cause)) {
        return yield* Effect.logError('Game translation failed unexpectedly', exit.cause).pipe(
          Effect.annotateLogs(outcome),
        )
      }

      yield* (status === 'failed' ? Effect.logWarning : Effect.logInfo)(
        'Game translation finished',
      ).pipe(Effect.annotateLogs(error === undefined ? outcome : { ...outcome, error }))
    })

  const setRunSpendLimit = Effect.fn('GameTranslation.setRunSpendLimit')(function* (
    gameId: string,
    limit: SpendLimit,
  ) {
    const ledger = ledgers.get(gameId)

    if (ledger === undefined) {
      return
    }

    yield* ledger.setLimit(limit)
    yield* update(gameId, (run) => TranslationRun.make({ ...run, spendLimit: limit }))
  })

  const estimate = Effect.fn('GameTranslation.estimate')(function* (
    gameId: string,
    scope: TranslationScope,
  ) {
    const game = yield* gameOf(gameId)

    const settings = yield* getSettings
    const preset = yield* describePreset(settings)

    const prepared = prepareEntries(
      yield* gameData
        .originalLocations(game)
        .pipe(Effect.mapError((error) => failed(error.message))),
      settings,
      yield* gameData.protectedText(game),
    )

    const stored = yield* lines.lines(gameId)

    const inFiles =
      stored.length === 0 && game.translation !== 'original'
        ? appliedTranslations(
            prepared.entries,
            yield* gameData.locations(game).pipe(Effect.mapError((error) => failed(error.message))),
          )
        : []

    const translatedInFiles = new Set(inFiles.map((found) => found.entryId))

    const pending =
      stored.length === 0
        ? new Set(
            prepared.entries
              .map((entry) => entry.id)
              .filter((entryId) => !translatedInFiles.has(entryId)),
          )
        : pendingOf(diffSources(stored, prepared.entries), scope)

    const items = prepared.items.flatMap((item) => {
      const entryIds = item.entryIds.filter((entryId) => pending.has(entryId))

      return entryIds.length === 0 ? [] : [{ ...item, entryIds }]
    })

    const cost = yield* estimateCost(settings, items, preset.price)

    return {
      scope,
      ...cost,
      ...(preset.price === undefined ? {} : { price: preset.price }),
    }
  })

  const ensureSameLanguage = Effect.fnUntraced(function* (gameId: string, targetLanguage: string) {
    if (!(yield* lines.hasLines(gameId))) {
      return
    }

    const last = (yield* Effect.orDie(runsOf(gameId)))
      .map((row) => row.run)
      .find((run) => run.status === 'translated' || run.status === 'partial')

    if (last !== undefined && last.targetLanguage !== targetLanguage) {
      return yield* new TranslationError({
        reason: 'invalid',
        field: 'targetLanguage',
        message: `This game is translated into ${last.targetLanguage}. Remove its translation to translate it into ${targetLanguage}.`,
      })
    }
  })

  const start = Effect.fn('GameTranslation.start')(function* (
    gameId: string,
    scope: TranslationScope,
    spendLimit: SpendLimit | undefined,
  ) {
    if (yield* FiberMap.has(fibers, gameId)) {
      return yield* new TranslationError({
        reason: 'conflict',
        message: 'This game is already being translated.',
      })
    }

    const game = yield* gameOf(gameId)

    if (!isTranslatable(game.engine)) {
      return yield* new TranslationError({
        reason: 'invalid',
        message: 'Wenbu can translate RPG Maker games only.',
      })
    }

    const settings = yield* getSettings
    const preset = yield* describePreset(settings)

    yield* ensureSameLanguage(gameId, settings.targetLanguage)
    yield* ensureUnchanged(game)

    const limit = spendLimit ?? settings.spendLimit
    const ledger = yield* makeLedger(limit, preset.price !== undefined)

    const needed = yield* gameData
      .spaceToTranslate(game)
      .pipe(Effect.mapError((error) => failed(error.message)))

    yield* disk.ensure(game.folderPath, needed)

    const run = TranslationRun.make({
      id: yield* Effect.orDie(crypto.randomUUIDv7()),
      gameId,
      status: 'running',
      startedAt: yield* now,
      presetName: `${preset.presetName} · ${preset.modelName}`,
      targetLanguage: settings.targetLanguage,
      scope,
      ...(limit === undefined ? {} : { spendLimit: limit }),
      lines: { total: 0, translated: 0, written: 0 },
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: stepIds.map((id) => ({ id, status: 'pending' as const, notes: [] })),
    })

    yield* save(run)
    yield* publish(gameId, run)

    yield* Effect.logInfo('Game translation started').pipe(
      Effect.annotateLogs({
        game: gameId,
        engine: game.engine,
        target: settings.targetLanguage,
        workers: settings.workers,
        rounds: settings.retryRounds,
      }),
    )

    const workflow = runWorkflow(game, settings, scope, ledger, preset.price).pipe(
      Effect.ensuring(Effect.sync(() => ledgers.delete(gameId))),
      Effect.mapError((error) => asTranslationError(error)),
      Effect.onExit((exit) => finish(gameId, exit)),
    )

    ledgers.set(gameId, ledger)

    yield* FiberMap.run(fibers, gameId, workflow)
  })

  const remove = Effect.fn('GameTranslation.remove')(function* (gameId: string) {
    if (yield* FiberMap.has(fibers, gameId)) {
      return yield* new TranslationError({
        reason: 'conflict',
        message: 'Cancel the running translation first.',
      })
    }

    const game = yield* gameOf(gameId)

    yield* gameData.restoreOriginals(game).pipe(
      Effect.andThen(gameData.discardOriginals(game)),
      Effect.mapError((error) => failed(error.message)),
    )

    yield* fileHashes.remove(gameId)
    yield* lines.remove(gameId)

    yield* games.setTranslation(gameId, 'original')
    yield* publish(gameId, undefined)
  })

  const watch = (gameId: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runs = yield* SubscriptionRef.get(latest)

        if (!runs.has(gameId)) {
          const [last] = yield* Effect.orDie(runsOf(gameId))

          yield* SubscriptionRef.update(latest, (seen) =>
            seen.has(gameId) ? seen : new Map(seen).set(gameId, last?.run),
          )
        }

        return SubscriptionRef.changes(latest).pipe(
          Stream.map((seen) => seen.get(gameId)),
          Stream.changesWith((left, right) => left === right),
          Stream.map(Option.fromNullishOr),
        )
      }),
    )

  const saveSettings = Effect.fn('GameTranslation.saveSettings')(function* (
    settings: TranslationSettings,
  ) {
    const clean = yield* sanitize(settings)

    yield* Effect.orDie(settingsStore.set('game-translation', clean))

    return clean
  })

  const listRuns = (gameId: string) =>
    Effect.map(Effect.orDie(runsOf(gameId)), (rows) => rows.map((row) => row.run))

  return {
    saveSettings,
    start,
    estimate,
    setRunSpendLimit,
    cancel: (gameId: string) => FiberMap.remove(fibers, gameId),
    remove,
    listRuns,
    watch,
  }
})
