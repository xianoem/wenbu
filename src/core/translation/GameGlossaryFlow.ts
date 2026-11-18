import { Effect, Option, Schema } from 'effect'
import { SqlSchema } from 'effect/sql'
import {
  type GameGlossary,
  type GameGlossaryEntry,
  GlossaryEntryKind,
  type GlossaryEntryInput,
  type GlossaryEstimate,
} from '#contract/GameGlossary'
import { TranslationError, type TranslationSettings } from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import type { ModelPrice } from '#contract/Llm'
import type { TextEntry, TranslationItem } from '../rpgmaker/TextEntries'
import { estimateTokens } from './Batches'
import { costOf, estimateCost } from './CostEstimate'
import {
  collectMaterial,
  type GlossaryMaterial,
  isMaterialFile,
  lineCounts,
  provisionalGlossary,
  speakerIndex,
  splitBySpeaker,
} from './GlossaryMaterial'
import {
  glossaryBatchPrompt,
  makeGlossaryRequests,
  parsePreparation,
  preparationKeys,
  preparationPrompt,
  preparationSystem,
} from './GlossaryPrompts'
import { encodeJson, failed, readableError, type TranslationShared } from './TranslationShared'

const SettingsRow = Schema.Struct({
  enabled: Schema.Int,
  prepared_at: Schema.NullOr(Schema.String),
  cost_usd: Schema.NullOr(Schema.Number),
})

const EntryRow = Schema.Struct({
  id: Schema.String,
  kind: GlossaryEntryKind,
  original: Schema.String,
  translation: Schema.String,
  note: Schema.String,
  speakers: Schema.fromJsonString(Schema.Array(Schema.String)),
  lines: Schema.Int,
})

const encodeSpeakers = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)))

const preparationTimeout = 600

export interface GlossaryRun {
  readonly items: ReadonlyArray<TranslationItem>
  readonly promptOf: (batch: ReadonlyArray<TranslationItem>) => Effect.Effect<string>
}

export interface PreparationUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number | undefined
}

export const makeGameGlossary = Effect.fnUntraced(function* (shared: TranslationShared) {
  const {
    sql,
    crypto,
    gameData,
    llm,
    now,
    gameOf,
    ensureIdle,
    getSettings,
    describePreset,
    extractOriginals,
  } = shared

  const preparing = new Set<string>()

  const settingsOf = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: SettingsRow,
    execute: (gameId) =>
      sql`SELECT enabled, prepared_at, cost_usd FROM game_glossaries WHERE game_id = ${gameId}`,
  })

  const entriesOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: EntryRow,
    execute: (gameId) => sql`
      SELECT id, kind, original, translation, note, speakers, lines FROM game_glossary_entries
      WHERE game_id = ${gameId} ORDER BY position
    `,
  })

  const nextPosition = SqlSchema.findOne({
    Request: Schema.String,
    Result: Schema.Struct({ next: Schema.Int }),
    execute: (gameId) => sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next FROM game_glossary_entries
      WHERE game_id = ${gameId}
    `,
  })

  const read = Effect.fnUntraced(function* (gameId: string) {
    const settings = Option.getOrUndefined(yield* settingsOf(gameId))
    const entries = yield* entriesOf(gameId)

    return {
      gameId,
      enabled: settings?.enabled === 1,
      ...(settings?.prepared_at === undefined || settings.prepared_at === null
        ? {}
        : { preparedAt: settings.prepared_at }),
      ...(settings?.cost_usd === undefined || settings.cost_usd === null
        ? {}
        : { costUsd: settings.cost_usd }),
      entries,
    } satisfies GameGlossary
  }, Effect.orDie)

  const isEnabled = (gameId: string) => Effect.map(read(gameId), (glossary) => glossary.enabled)

  const ensureRow = (gameId: string) =>
    Effect.orDie(
      sql`INSERT INTO game_glossaries (game_id) VALUES (${gameId}) ON CONFLICT DO NOTHING`,
    )

  const get = Effect.fn('GameGlossary.get')(function* (gameId: string) {
    yield* gameOf(gameId)

    return yield* read(gameId)
  })

  const setEnabled = Effect.fn('GameGlossary.setEnabled')(function* (
    gameId: string,
    enabled: boolean,
  ) {
    yield* gameOf(gameId)
    yield* ensureRow(gameId)

    yield* Effect.orDie(
      sql`UPDATE game_glossaries SET enabled = ${enabled ? 1 : 0} WHERE game_id = ${gameId}`,
    )

    return yield* read(gameId)
  })

  const materialOf = Effect.fnUntraced(function* (game: Game) {
    const collector = collectMaterial()

    yield* gameData
      .forEachOriginal(game, isMaterialFile, (file, data) =>
        Effect.sync(() => collector.add(file, data)),
      )
      .pipe(Effect.mapError((error) => failed(error.message)))

    return collector.material()
  })

  const countLines = (
    glossary: ReadonlyArray<GameGlossaryEntry>,
    material: GlossaryMaterial,
    entries: ReadonlyArray<TextEntry>,
  ) => {
    const counts = lineCounts(glossary, entries, speakerIndex(material, glossary))

    return glossary.map((entry) => ({ ...entry, lines: counts.get(entry.id) ?? 0 }))
  }

  const store = Effect.fnUntraced(function* (
    gameId: string,
    glossary: ReadonlyArray<GameGlossaryEntry>,
    costUsd: number | undefined,
  ) {
    const rows: Array<Record<string, string | number>> = []

    for (const [position, entry] of glossary.entries()) {
      rows.push({
        id: entry.id,
        game_id: gameId,
        position,
        kind: entry.kind,
        original: entry.original,
        translation: entry.translation,
        note: entry.note,
        speakers: yield* encodeSpeakers(entry.speakers),
        lines: entry.lines,
      })
    }

    const preparedAt = yield* now

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO game_glossaries (game_id) VALUES (${gameId}) ON CONFLICT DO NOTHING`
        yield* sql`DELETE FROM game_glossary_entries WHERE game_id = ${gameId}`

        if (rows.length > 0) {
          yield* sql`INSERT INTO game_glossary_entries ${sql.insert(rows)}`
        }

        yield* sql`UPDATE game_glossaries SET ${sql.update({
          prepared_at: preparedAt,
          cost_usd: costUsd ?? null,
        })} WHERE game_id = ${gameId}`
      }),
    )
  }, Effect.orDie)

  const prepareWith = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    material: GlossaryMaterial,
    entries: ReadonlyArray<TextEntry>,
    price: ModelPrice | undefined,
  ) {
    const completion = yield* llm
      .complete({
        presetId: settings.presetId,
        feature: 'rpg-translation',
        gameId: game.id,
        system: preparationSystem,
        prompt: yield* preparationPrompt(settings.targetLanguage, material, entries),
        timeout: `${Math.max(settings.timeoutSeconds, preparationTimeout)} seconds`,
      })
      .pipe(Effect.mapError((error) => failed(readableError(error.message))))

    const prepared = yield* parsePreparation(
      completion.text,
      preparationKeys(material, entries),
    ).pipe(Effect.mapError(() => failed('The reply was not the glossary Wenbu asked for.')))

    if (prepared.length === 0) {
      return yield* failed('The model returned an empty glossary. Try again.')
    }

    const glossary: Array<GameGlossaryEntry> = []

    for (const entry of prepared) {
      glossary.push({ ...entry, id: yield* Effect.orDie(crypto.randomUUIDv7()), lines: 0 })
    }

    const costUsd =
      completion.costUsd ??
      (price === undefined
        ? undefined
        : costOf(price, completion.usage.inputTokens, completion.usage.outputTokens))

    const counted = countLines(glossary, material, entries)

    yield* store(game.id, counted, costUsd)

    yield* Effect.logInfo('Game glossary prepared').pipe(
      Effect.annotateLogs({
        game: game.id,
        entries: counted.length,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
      }),
    )

    return {
      glossary: counted,
      usage: { ...completion.usage, costUsd: completion.costUsd },
      spent: { ...completion.usage, costUsd },
    }
  })

  const exclusively = <A, E, R>(gameId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (preparing.has(gameId)) {
        return yield* new TranslationError({
          reason: 'conflict',
          message: 'The glossary is already being prepared.',
        })
      }

      preparing.add(gameId)

      return yield* effect.pipe(Effect.ensuring(Effect.sync(() => preparing.delete(gameId))))
    })

  const prepare = Effect.fn('GameGlossary.prepare')(function* (gameId: string) {
    yield* ensureIdle(gameId)

    const game = yield* gameOf(gameId)
    const settings = yield* getSettings
    const preset = yield* describePreset(settings)

    yield* exclusively(
      gameId,
      Effect.gen(function* () {
        const extracted = yield* extractOriginals(game, settings)
        const material = yield* materialOf(game)

        yield* prepareWith(game, settings, material, extracted.entries, preset.price)
      }),
    )

    return yield* read(gameId)
  })

  const cleanInput = (input: GlossaryEntryInput) => {
    const original = input.original.trim()
    const translation = input.translation.trim()

    if (original === '') {
      return Effect.fail(
        new TranslationError({
          reason: 'invalid',
          field: 'original',
          message: 'Enter the original.',
        }),
      )
    }

    if (translation === '') {
      return Effect.fail(
        new TranslationError({
          reason: 'invalid',
          field: 'translation',
          message: 'Enter the translation.',
        }),
      )
    }

    return Effect.succeed({ ...input, original, translation, note: input.note.trim() })
  }

  const recount = Effect.fnUntraced(function* (game: Game, entry: GameGlossaryEntry) {
    const settings = yield* getSettings
    const extracted = yield* extractOriginals(game, settings)
    const material = yield* materialOf(game)
    const others = (yield* read(game.id)).entries.filter((other) => other.id !== entry.id)
    const [counted] = countLines([entry, ...others], material, extracted.entries)

    return counted?.lines ?? 0
  })

  const saveEntry = Effect.fn('GameGlossary.saveEntry')(function* (
    gameId: string,
    id: string | undefined,
    input: GlossaryEntryInput,
  ) {
    const game = yield* gameOf(gameId)
    const clean = yield* cleanInput(input)
    const stored = (yield* read(gameId)).entries
    const existing = stored.find((entry) => entry.id === id)

    if (id !== undefined && existing === undefined) {
      return yield* new TranslationError({
        reason: 'not-found',
        message: 'This entry is no longer in the glossary.',
      })
    }

    if (stored.some((other) => other.id !== id && other.original === clean.original)) {
      return yield* new TranslationError({
        reason: 'invalid',
        field: 'original',
        message: `${clean.original} is already in the glossary.`,
      })
    }

    const entry: GameGlossaryEntry = {
      id: existing?.id ?? (yield* Effect.orDie(crypto.randomUUIDv7())),
      speakers: existing?.speakers ?? [],
      lines: existing?.lines ?? 0,
      ...clean,
    }

    const lines =
      existing?.original === entry.original && existing.kind === entry.kind
        ? entry.lines
        : yield* recount(game, entry)

    yield* ensureRow(gameId)

    if (existing === undefined) {
      yield* Effect.orDie(
        sql`INSERT INTO game_glossary_entries ${sql.insert({
          id: entry.id,
          game_id: gameId,
          position: (yield* Effect.orDie(nextPosition(gameId))).next,
          kind: entry.kind,
          original: entry.original,
          translation: entry.translation,
          note: entry.note,
          speakers: yield* Effect.orDie(encodeSpeakers(entry.speakers)),
          lines,
        })}`,
      )
    } else {
      yield* Effect.orDie(
        sql`UPDATE game_glossary_entries SET ${sql.update({
          kind: entry.kind,
          original: entry.original,
          translation: entry.translation,
          note: entry.note,
          lines,
        })} WHERE id = ${entry.id} AND game_id = ${gameId}`,
      )
    }

    return yield* read(gameId)
  })

  const removeEntry = Effect.fn('GameGlossary.removeEntry')(function* (gameId: string, id: string) {
    yield* gameOf(gameId)

    yield* Effect.orDie(
      sql`DELETE FROM game_glossary_entries WHERE id = ${id} AND game_id = ${gameId}`,
    )

    return yield* read(gameId)
  })

  const runWith = (
    settings: TranslationSettings,
    material: GlossaryMaterial,
    glossary: ReadonlyArray<GameGlossaryEntry>,
    items: ReadonlyArray<TranslationItem>,
  ): GlossaryRun => {
    const index = speakerIndex(material, glossary)
    const requests = makeGlossaryRequests(glossary, index)

    return {
      items: splitBySpeaker(items, (entryId) => index.resolve(entryId)?.label),
      promptOf: (batch) => glossaryBatchPrompt(settings, batch, requests),
    }
  }

  const preparationCost = Effect.fnUntraced(function* (
    settings: TranslationSettings,
    material: GlossaryMaterial,
    entries: ReadonlyArray<TextEntry>,
    price: ModelPrice | undefined,
  ) {
    const prompt = yield* preparationPrompt(settings.targetLanguage, material, entries)
    const standIn = provisionalGlossary(material, entries)

    const reply = yield* Effect.orDie(
      encodeJson({
        characters: standIn
          .filter((entry) => entry.kind === 'character')
          .map((entry) => ({
            original: entry.original,
            english: entry.translation,
            voice: entry.note,
            speakers: entry.speakers,
          })),
        terms: standIn
          .filter((entry) => entry.kind !== 'character')
          .map((entry) => ({
            original: entry.original,
            english: entry.translation,
            kind: entry.kind,
          })),
      }),
    )

    const inputTokens = estimateTokens(preparationSystem) + estimateTokens(prompt)
    const outputTokens = estimateTokens(reply)

    return {
      inputTokens,
      outputTokens,
      costUsd: price === undefined ? undefined : costOf(price, inputTokens, outputTokens),
    } satisfies PreparationUsage
  })

  /** Prepares the glossary if it is missing, then gives the items and requests a run sends. */
  const forRun = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    entries: ReadonlyArray<TextEntry>,
    items: ReadonlyArray<TranslationItem>,
    price: ModelPrice | undefined,
    beforePreparing: (estimate: PreparationUsage) => Effect.Effect<boolean>,
    afterPreparing: (estimate: PreparationUsage, actual: PreparationUsage) => Effect.Effect<void>,
  ) {
    const material = yield* materialOf(game)
    const stored = yield* read(game.id)

    if (stored.preparedAt !== undefined) {
      return {
        run: runWith(settings, material, stored.entries, items),
        glossary: stored.entries,
        prepared: undefined,
      }
    }

    const cost = yield* preparationCost(settings, material, entries, price)

    if (!(yield* beforePreparing(cost))) {
      return yield* failed('The spending limit is lower than what preparing the glossary costs.')
    }

    const prepared = yield* exclusively(
      game.id,
      prepareWith(game, settings, material, entries, price).pipe(
        Effect.tap((done) => afterPreparing(cost, done.spent)),
        Effect.tapError(() =>
          afterPreparing(cost, { inputTokens: 0, outputTokens: 0, costUsd: 0 }),
        ),
      ),
    )

    return {
      run: runWith(settings, material, prepared.glossary, items),
      glossary: prepared.glossary,
      prepared: prepared.usage,
    }
  })

  const estimate = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    entries: ReadonlyArray<TextEntry>,
    items: ReadonlyArray<TranslationItem>,
    price: ModelPrice | undefined,
    base: Effect.Success<ReturnType<typeof estimateCost>>,
  ) {
    const stored = yield* read(game.id)
    const material = yield* materialOf(game)
    const prepared = stored.preparedAt !== undefined

    const glossary = prepared ? stored.entries : provisionalGlossary(material, entries)
    const run = runWith(settings, material, glossary, items)
    const withGlossary = yield* estimateCost(settings, run.items, price, run.promptOf)

    const prepare = prepared
      ? { inputTokens: 0, outputTokens: 0, ...(price === undefined ? {} : { costUsd: 0 }) }
      : yield* preparationCost(settings, material, entries, price)

    const extraInputTokens = Math.max(0, withGlossary.inputTokens - base.inputTokens)

    const summary: GlossaryEstimate = {
      enabled: stored.enabled,
      prepared,
      prepare: {
        inputTokens: prepare.inputTokens,
        outputTokens: prepare.outputTokens,
        ...(prepare.costUsd === undefined ? {} : { costUsd: prepare.costUsd }),
      },
      extraInputTokens,
      ...(price === undefined
        ? {}
        : {
            extraCostUsd: Math.max(0, (withGlossary.costUsd?.low ?? 0) - (base.costUsd?.low ?? 0)),
            baseCostUsd: base.costUsd?.low ?? 0,
          }),
    }

    return { summary, withGlossary }
  })

  /** The request for one line, with the glossary when it is on and prepared. */
  const linePrompt = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    item: TranslationItem,
  ) {
    const stored = yield* read(game.id)

    if (!stored.enabled || stored.preparedAt === undefined) {
      return undefined
    }

    const material = yield* materialOf(game)

    return yield* runWith(settings, material, stored.entries, [item]).promptOf([item])
  })

  return {
    get,
    setEnabled,
    isEnabled,
    isPreparing: (gameId: string) => Effect.sync(() => preparing.has(gameId)),
    prepare,
    saveEntry,
    removeEntry,
    forRun,
    estimate,
    linePrompt,
  }
})

export type GameGlossaryFlow = Effect.Success<ReturnType<typeof makeGameGlossary>>
