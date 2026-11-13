import { Crypto, DateTime, Effect, FiberMap, FileSystem, Option, Path, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  defaultTranslationSettings,
  RemovedLine,
  TranslationError,
  type TranslationLine,
  TranslationSettings,
} from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { Games } from '../library/Games'
import { LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import { DiskSpace } from '../platform/DiskSpace'
import * as SettingsStore from '../platform/SettingsStore'
import { type ApplySkipReason, applyTranslations } from '../rpgmaker/ApplyTranslations'
import { GameData } from '../rpgmaker/GameData'
import { prepareEntries, type TextEntry } from '../rpgmaker/TextEntries'
import { changedFiles, GameFileHashes } from './GameFileHashes'
import type { DiffCounts } from './SourceDiff'
import { appliedTranslations, TranslationLines } from './TranslationLines'

const UpdateReport = Schema.Struct({
  changed: Schema.Int,
  added: Schema.Int,
  removed: Schema.Int,
  moved: Schema.Int,
  unchanged: Schema.Int,
  removedLines: Schema.Array(RemovedLine),
  install: Schema.optional(
    Schema.Struct({
      archive: Schema.String,
      version: Schema.optional(Schema.String),
      backup: Schema.String,
      installedAt: Schema.String,
      undoneAt: Schema.optional(Schema.String),
    }),
  ),
})

export const UpdateRow = Schema.Struct({
  id: Schema.String,
  detected_at: Schema.String,
  report: Schema.fromJsonString(UpdateReport),
})

export const encodeReport = Schema.encodeEffect(Schema.fromJsonString(UpdateReport))

export const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

export type UpdateInstall = NonNullable<(typeof UpdateReport.Type)['install']>

const removedLimit = 500

export const readableError = (message: string) => message.replace(/^\w+\.\w+: /, '')

export const count = (value: number, noun: string) =>
  `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`

const changeNote = (counts: DiffCounts) => {
  const parts = (
    [
      [counts.added, 'new'],
      [counts.changed, 'changed'],
      [counts.moved, 'moved'],
      [counts.removed, 'removed'],
    ] as const
  )
    .filter(([found]) => found !== 0)
    .map(([found, label]) => `${found.toLocaleString('en-US')} ${label}`)

  return parts.length === 0 ? undefined : `Since the last run: ${parts.join(', ')}`
}

export const failed = (message: string) => new TranslationError({ reason: 'failed', message })

const isTranslationError = Schema.is(TranslationError)

export const asTranslationError = (error: TranslationError | { readonly message: string }) =>
  isTranslationError(error) ? error : failed(readableError(error.message))

export const makeTranslationShared = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const games = yield* Games
  const gameData = yield* GameData
  const disk = yield* DiskSpace
  const llm = yield* LlmClient
  const crypto = yield* Crypto.Crypto
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const lines = yield* TranslationLines
  const fileHashes = yield* GameFileHashes

  const settingsStore = SettingsStore.make(
    yield* KeyValueStore.KeyValueStore,
    TranslationSettings,
    defaultTranslationSettings,
  )

  const fibers = yield* FiberMap.make<string>()

  const now = Effect.map(DateTime.now, DateTime.formatIso)

  const findLatestInstall = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: UpdateRow,
    execute: (gameId) => sql`
      SELECT id, detected_at, report FROM game_updates
      WHERE game_id = ${gameId} AND json_extract(report, '$.install') IS NOT NULL
      ORDER BY detected_at DESC LIMIT 1
    `,
  })

  const gameOf = (gameId: string) =>
    games
      .get(gameId)
      .pipe(
        Effect.mapError(
          (error) => new TranslationError({ reason: 'not-found', message: error.message }),
        ),
      )

  const ensureIdle = Effect.fnUntraced(function* (gameId: string) {
    if (yield* FiberMap.has(fibers, gameId)) {
      return yield* new TranslationError({
        reason: 'conflict',
        message: 'Wait for the running translation to finish.',
      })
    }
  })

  const getSettings = Effect.orDie(settingsStore.get('game-translation'))

  yield* (yield* PresetReferences).register({
    area: 'Game translation',
    uses: (presetIds) => Effect.map(getSettings, (settings) => presetIds.has(settings.presetId)),
    clear: (presetIds) =>
      Effect.flatMap(getSettings, (settings) =>
        presetIds.has(settings.presetId)
          ? Effect.orDie(settingsStore.set('game-translation', { ...settings, presetId: '' }))
          : Effect.void,
      ),
  })

  const describePreset = Effect.fnUntraced(function* (settings: TranslationSettings) {
    if (settings.presetId === '') {
      return yield* new TranslationError({
        reason: 'invalid',
        field: 'presetId',
        message: 'Choose a preset.',
      })
    }

    return yield* llm.describe(settings.presetId).pipe(
      Effect.mapError(
        () =>
          new TranslationError({
            reason: 'invalid',
            field: 'presetId',
            message: 'The chosen preset no longer exists. Choose another.',
          }),
      ),
    )
  })

  const apply = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    entries: ReadonlyArray<TextEntry>,
  ) {
    yield* gameData.restoreOriginals(game)
    yield* gameData.saveOriginals(game)

    const dataPath = gameData.dataPathOf(game)
    const byFile = Map.groupBy(entries, (entry) => entry.file)
    const skipped = new Map<ApplySkipReason, number>()
    const skippedIds = new Map<string, ApplySkipReason>()
    let written = 0
    let unchanged = 0

    for (const [file, fileEntries] of byFile) {
      const filePath = path.join(dataPath, file)
      const data = yield* gameData.readData(filePath)
      const result = applyTranslations(data, fileEntries, settings)

      written += result.written
      unchanged += result.unchanged

      for (const skip of result.skipped) {
        skipped.set(skip.reason, (skipped.get(skip.reason) ?? 0) + 1)
        skippedIds.set(skip.entryId, skip.reason)
      }

      if (result.written > 0) {
        yield* gameData.writeData(filePath, data)
      }
    }

    const writtenIds = entries
      .filter((entry) => entry.dst !== '' && !skippedIds.has(entry.id))
      .map((entry) => entry.id)

    return { written, unchanged, skipped, writtenIds, skippedIds }
  })

  const outsideChanges = Effect.fnUntraced(function* (game: Game) {
    if (yield* gameData.hasNewArchive(game)) {
      return ['Game.rgss3a']
    }

    const stored = yield* fileHashes.get(game.id)

    if (stored.size === 0 || (yield* gameData.hasArchivedOriginals(game))) {
      return []
    }

    return changedFiles(stored, yield* gameData.dataHashes(game))
  })

  const ensureUnchanged = Effect.fnUntraced(function* (game: Game) {
    const changed = yield* outsideChanges(game).pipe(
      Effect.mapError((error) => failed(error.message)),
    )

    if (changed.length === 0) {
      return
    }

    const names = changed.length > 3 ? `${changed.slice(0, 3).join(', ')}…` : changed.join(', ')

    yield* Effect.logWarning('Game files changed outside Wenbu').pipe(
      Effect.annotateLogs({ game: game.id, files: changed.length }),
    )

    return yield* new TranslationError({
      reason: 'conflict',
      field: 'gameFiles',
      message: `The game's files changed outside Wenbu (${names}). Install the update with Update the game, or put Wenbu's files back.`,
    })
  })

  const recordOriginals = Effect.fnUntraced(function* (
    game: Game,
    saved: 'saved' | 'unpacked' | 'kept',
  ) {
    if (saved === 'kept' && (yield* fileHashes.get(game.id)).size > 0) {
      return
    }

    const originals = yield* gameData.originalHashes(game)

    const written =
      saved === 'kept' && game.translation !== 'original'
        ? new Map(
            [...(yield* gameData.dataHashes(game))].filter(
              ([file, hash]) => originals.get(file) !== hash,
            ),
          )
        : new Map<string, string>()

    yield* fileHashes.record(game.id, originals, written)
  })

  const recordWritten = Effect.fnUntraced(function* (game: Game) {
    const stored = yield* fileHashes.get(game.id)
    const current = yield* gameData.dataHashes(game)

    yield* fileHashes.saveWritten(
      game.id,
      new Map([...current].filter(([file, hash]) => stored.get(file)?.original !== hash)),
    )
  })

  const writeToGame = Effect.fnUntraced(function* (
    game: Game,
    settings: TranslationSettings,
    entries: ReadonlyArray<TextEntry>,
  ) {
    const written = yield* apply(game, settings, entries).pipe(
      Effect.uninterruptible,
      Effect.tapError(() =>
        gameData
          .restoreOriginals(game)
          .pipe(Effect.andThen(games.setTranslation(game.id, 'original')), Effect.ignore),
      ),
    )

    yield* lines.markApplied(game.id, written.writtenIds)
    yield* lines.markSkipped(game.id, written.skippedIds)
    yield* recordWritten(game)

    return written
  })

  const recordUpdate = Effect.fnUntraced(function* (
    gameId: string,
    counts: DiffCounts & { readonly removedLines: ReadonlyArray<TranslationLine> },
    install: UpdateInstall | undefined,
  ) {
    const report = yield* encodeReport({
      ...(install === undefined ? {} : { install }),
      changed: counts.changed,
      added: counts.added,
      removed: counts.removed,
      moved: counts.moved,
      unchanged: counts.unchanged,
      removedLines: counts.removedLines.slice(0, removedLimit).map((line) => ({
        file: line.file,
        context: line.context,
        sourceText: line.sourceText,
        ...(line.translatedText === undefined ? {} : { translatedText: line.translatedText }),
      })),
    })

    yield* sql`INSERT INTO game_updates ${sql.insert({
      id: yield* crypto.randomUUIDv7(),
      game_id: gameId,
      detected_at: yield* now,
      report,
    })}`

    yield* Effect.logInfo('Game update reconciled').pipe(
      Effect.annotateLogs({
        game: gameId,
        changed: counts.changed,
        added: counts.added,
        removed: counts.removed,
      }),
    )
  }, Effect.orDie)

  const latestInstall = (gameId: string) =>
    findLatestInstall(gameId).pipe(Effect.map(Option.getOrUndefined), Effect.orDie)

  const storeLines = Effect.fnUntraced(function* (
    game: Game,
    entries: ReadonlyArray<TextEntry>,
    install?: UpdateInstall,
  ) {
    const first = !(yield* lines.hasLines(game.id))
    const counts = yield* lines.reconcile(game.id, entries)

    if (
      install !== undefined ||
      (!first && (counts.changed > 0 || counts.added > 0 || counts.removed > 0))
    ) {
      yield* recordUpdate(game.id, counts, install)
    }

    if (first && game.translation !== 'original') {
      const found = appliedTranslations(entries, yield* gameData.locations(game))

      yield* lines.saveTranslations(game.id, found)

      yield* lines.markApplied(
        game.id,
        found.map((translation) => translation.entryId),
      )
    }

    return first ? undefined : changeNote(counts)
  })

  const extractOriginals = Effect.fnUntraced(function* (game: Game, settings: TranslationSettings) {
    return prepareEntries(
      yield* gameData
        .originalLocations(game)
        .pipe(Effect.mapError((error) => failed(error.message))),
      settings,
      yield* gameData.protectedText(game),
    )
  })

  const ensureLines = Effect.fnUntraced(function* (game: Game) {
    if (game.translation === 'original' || (yield* lines.hasLines(game.id))) {
      return
    }

    const prepared = yield* extractOriginals(game, yield* getSettings)

    yield* storeLines(game, prepared.entries).pipe(
      Effect.mapError((error) => failed(error.message)),
    )
  })

  const lineOf = Effect.fnUntraced(function* (gameId: string, entryId: string) {
    const line = yield* lines.line(gameId, entryId)

    if (line === undefined) {
      return yield* new TranslationError({
        reason: 'not-found',
        message: 'This line is no longer in the game.',
      })
    }

    return line
  })

  const applyEdits = Effect.fn('GameTranslation.applyEdits')(function* (
    gameId: string,
    overOutsideChanges: boolean,
  ) {
    yield* ensureIdle(gameId)

    const game = yield* gameOf(gameId)
    const settings = yield* getSettings

    if (!overOutsideChanges) {
      yield* ensureUnchanged(game)
    }

    const written = yield* Effect.gen(function* () {
      yield* recordOriginals(game, yield* gameData.saveOriginals(game))

      const prepared = yield* extractOriginals(game, settings)

      yield* storeLines(game, prepared.entries)

      const stored = yield* lines.translations(gameId)

      const entries = prepared.entries.map((entry) => ({
        ...entry,
        dst: stored.get(entry.id) ?? '',
      }))

      const result = yield* writeToGame(game, settings, entries)
      const untranslated = entries.some((entry) => entry.dst === '')

      yield* games.setTranslation(
        gameId,
        untranslated || result.skipped.size > 0 ? 'partial' : 'translated',
      )

      return result
    }).pipe(Effect.mapError((error) => asTranslationError(error)))

    yield* Effect.logInfo('Translation edits applied').pipe(
      Effect.annotateLogs({ game: gameId, written: written.written }),
    )
  })

  return {
    sql,
    games,
    gameData,
    disk,
    llm,
    crypto,
    path,
    fs,
    lines,
    fileHashes,
    settingsStore,
    fibers,
    now,
    gameOf,
    ensureIdle,
    getSettings,
    describePreset,
    ensureUnchanged,
    recordOriginals,
    writeToGame,
    latestInstall,
    storeLines,
    extractOriginals,
    ensureLines,
    lineOf,
    applyEdits,
  }
})

export type TranslationShared = Effect.Success<typeof makeTranslationShared>
