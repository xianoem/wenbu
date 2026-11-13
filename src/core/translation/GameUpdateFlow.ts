import { Effect, Exit, Option, Schema, Stream, SubscriptionRef } from 'effect'
import { SqlSchema } from 'effect/sql'
import {
  type InstallProgress,
  type SourceChangeAction,
  TranslationError,
} from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { readZipIndex } from '../platform/ZipIndex'
import { planUpdate } from './GameUpdate'
import {
  asTranslationError,
  encodeReport,
  type TranslationShared,
  type UpdateInstall,
  UpdateRow,
} from './TranslationShared'
import {
  gameFiles,
  installFiles,
  restoreBackup,
  titleInGame,
  titleInZip,
  updatesFolder,
} from './UpdateInstaller'

const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`

export const makeGameUpdateFlow = Effect.fnUntraced(function* (shared: TranslationShared) {
  const {
    sql,
    games,
    gameData,
    disk,
    path,
    fs,
    lines,
    fileHashes,
    now,
    gameOf,
    ensureIdle,
    getSettings,
    recordOriginals,
    writeToGame,
    latestInstall,
    storeLines,
    extractOriginals,
    ensureLines,
    lineOf,
    applyEdits,
  } = shared

  const installs = yield* SubscriptionRef.make<ReadonlyMap<string, InstallProgress>>(new Map())

  const setInstall = (gameId: string, progress: InstallProgress) =>
    SubscriptionRef.update(installs, (current) => new Map(current).set(gameId, progress))

  const watchInstall = (gameId: string) =>
    SubscriptionRef.changes(installs).pipe(
      Stream.map((current) => current.get(gameId)),
      Stream.changesWith((left, right) => left === right),
      Stream.map(Option.fromNullishOr),
    )

  const findLatestUpdate = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: UpdateRow,
    execute: (gameId) => sql`
      SELECT id, detected_at, report FROM game_updates
      WHERE game_id = ${gameId} ORDER BY detected_at DESC LIMIT 1
    `,
  })

  const latestUpdate = (gameId: string) =>
    findLatestUpdate(gameId).pipe(Effect.map(Option.getOrUndefined), Effect.orDie)

  const installedVersion = (gameId: string) =>
    Effect.map(latestInstall(gameId), (found) => found?.report.install?.version)

  const inspectUpdate = Effect.fn('GameTranslation.inspectUpdate')(function* (
    gameId: string,
    archive: string,
  ) {
    const game = yield* gameOf(gameId)

    const result = yield* Effect.gen(function* () {
      const entries = yield* readZipIndex(archive)
      const existing = yield* gameFiles(game.folderPath)
      const gameTitle = yield* titleInGame(game.folderPath, game.engine)

      const base = {
        archiveName: path.basename(archive),
        engine: game.engine,
        entries,
        existing,
        gameTitle,
        installedVersion: yield* installedVersion(gameId),
      }

      const located = planUpdate({ ...base, zipTitle: undefined })
      const zipTitle = yield* titleInZip(archive, entries, located.root, game.engine)
      const plan = planUpdate({ ...base, zipTitle })

      const replacedBytes = yield* Effect.forEach(plan.files, (file) =>
        fs.stat(path.join(game.folderPath, ...file.path.split('/'))).pipe(
          Effect.map((info) => Number(info.size)),
          Effect.orElseSucceed(() => 0),
        ),
      )

      const needed = plan.bytes + replacedBytes.reduce((total, bytes) => total + bytes, 0)
      const space = yield* Effect.exit(disk.ensure(game.folderPath, needed))

      const archiveBytes = Number((yield* fs.stat(archive)).size)

      const spaceCheck = {
        id: 'space' as const,
        status: Exit.isSuccess(space) ? ('ok' as const) : ('blocked' as const),
        title: Exit.isSuccess(space) ? 'Enough space' : 'Not enough space',
        detail: Exit.isSuccess(space)
          ? `Needs ${formatSize(needed)}`
          : `Needs ${formatSize(needed)} free on the game’s drive`,
      }

      const checks = [...plan.checks, spaceCheck]

      return {
        plan,
        inspection: {
          archive: path.basename(archive),
          archiveBytes,
          ...(plan.version === undefined ? {} : { version: plan.version }),
          checks,
          replaced: plan.replaced,
          added: plan.added,
          saves: plan.saves,
          bytes: plan.bytes,
          blocked: checks.some((check) => check.status === 'blocked'),
        },
      }
    }).pipe(Effect.mapError((error) => asTranslationError(error)))

    return result
  })

  const settleAfterSwap = Effect.fnUntraced(function* (
    game: Game,
    translated: boolean,
    install: UpdateInstall | undefined,
  ) {
    yield* gameData.discardOriginals(game)
    yield* fileHashes.remove(game.id)
    yield* recordOriginals(game, yield* gameData.saveOriginals(game))

    const settings = yield* getSettings
    const prepared = yield* extractOriginals(game, settings)

    yield* storeLines(game, prepared.entries, install)

    if (!translated) {
      return
    }

    const stored = yield* lines.translations(game.id)

    const entries = prepared.entries.map((entry) => ({
      ...entry,
      dst: stored.get(entry.id) ?? '',
    }))

    const written = yield* writeToGame(game, settings, entries)
    const untranslated = entries.some((entry) => entry.dst === '')

    yield* games.setTranslation(
      game.id,
      untranslated || written.skipped.size > 0 ? 'partial' : 'translated',
    )
  })

  const installUpdate = Effect.fn('GameTranslation.installUpdate')(function* (
    gameId: string,
    archive: string,
    acceptWarnings: boolean,
  ) {
    yield* ensureIdle(gameId)

    const { plan, inspection } = yield* inspectUpdate(gameId, archive)
    const blocked = inspection.checks.find((check) => check.status === 'blocked')

    if (blocked !== undefined) {
      return yield* new TranslationError({ reason: 'invalid', message: blocked.detail })
    }

    if (!acceptWarnings && inspection.checks.some((check) => check.status === 'warning')) {
      return yield* new TranslationError({
        reason: 'invalid',
        message: 'Check the warnings, then install anyway.',
      })
    }

    const game = yield* gameOf(gameId)
    const translated = game.translation !== 'original'
    const installedAt = yield* now
    const stamp = installedAt.replace(/[:.]/g, '-')

    yield* Effect.gen(function* () {
      yield* ensureLines(game)

      yield* setInstall(gameId, { step: 'restore', done: 0, total: 0 })

      if (yield* gameData.hasOriginals(game)) {
        yield* gameData.restoreOriginals(game)
      }

      const files = yield* installFiles(
        game.folderPath,
        archive,
        plan.files,
        stamp,
        (step, done, total) => setInstall(gameId, { step, done, total }),
      ).pipe(
        Effect.tapError(() =>
          fs
            .remove(path.join(game.folderPath, updatesFolder, stamp), {
              recursive: true,
              force: true,
            })
            .pipe(Effect.ignore),
        ),
        Effect.tapError(() =>
          translated ? applyEdits(gameId, true).pipe(Effect.ignore) : Effect.void,
        ),
      )

      yield* setInstall(gameId, { step: 'settle', done: 0, total: 0 })

      yield* settleAfterSwap(game, translated, {
        archive: path.basename(archive),
        ...(plan.version === undefined ? {} : { version: plan.version }),
        backup: files.backup,
        installedAt,
      })

      yield* setInstall(gameId, { step: 'done', done: 0, total: 0 })

      yield* Effect.logInfo('Game update installed').pipe(
        Effect.annotateLogs({ game: gameId, replaced: files.replaced, added: files.added }),
      )
    }).pipe(
      Effect.uninterruptible,
      Effect.mapError((error) => asTranslationError(error)),
    )
  })

  const undoUpdate = Effect.fn('GameTranslation.undoUpdate')(function* (gameId: string) {
    yield* ensureIdle(gameId)

    const game = yield* gameOf(gameId)
    const last = yield* latestInstall(gameId)
    const install = last?.report.install

    if (last === undefined || install === undefined || install.undoneAt !== undefined) {
      return yield* new TranslationError({
        reason: 'invalid',
        message: 'There is no installed update to undo.',
      })
    }

    const translated = game.translation !== 'original'

    yield* Effect.gen(function* () {
      if (yield* gameData.hasOriginals(game)) {
        yield* gameData.restoreOriginals(game)
      }

      yield* restoreBackup(game.folderPath, install.backup)
      yield* settleAfterSwap(game, translated, undefined)
      yield* lines.clearChanges(gameId)

      yield* sql`
        UPDATE game_updates SET report = ${yield* encodeReport({
          ...last.report,
          install: { ...install, undoneAt: yield* now },
        })}
        WHERE id = ${last.id}
      `

      yield* Effect.logInfo('Game update undone').pipe(Effect.annotateLogs({ game: gameId }))
    }).pipe(
      Effect.uninterruptible,
      Effect.mapError((error) => asTranslationError(error)),
    )
  })

  const getGameUpdate = Effect.fn('GameTranslation.getGameUpdate')(function* (gameId: string) {
    const game = yield* gameOf(gameId)

    if (game.translation === 'original' || !(yield* lines.hasLines(gameId))) {
      return Option.none()
    }

    const update = yield* latestUpdate(gameId)
    const counts = yield* lines.counts(gameId)

    const active = counts.pending > 0 || counts.review > 0

    const undoable =
      update?.report.install !== undefined && update.report.install.undoneAt === undefined

    if (update === undefined || (!active && !undoable)) {
      return Option.none()
    }

    const { removedLines: _removed, install, ...report } = update.report

    return Option.some({
      ...report,
      ...(install === undefined
        ? {}
        : {
            install: {
              archive: install.archive,
              ...(install.version === undefined ? {} : { version: install.version }),
              installedAt: install.installedAt,
              canUndo: install.undoneAt === undefined,
            },
          }),
      detectedAt: update.detected_at,
      pending: counts.pending,
      review: counts.review,
      active,
    })
  })

  const listSourceChanges = Effect.fn('GameTranslation.listSourceChanges')(function* (
    gameId: string,
  ) {
    yield* gameOf(gameId)

    const update = yield* latestUpdate(gameId)

    return {
      lines: yield* lines.changedLines(gameId),
      removed: update?.report.removedLines ?? [],
    }
  })

  const setSourceChangeAction = Effect.fn('GameTranslation.setSourceChangeAction')(function* (
    gameId: string,
    entryId: string,
    action: SourceChangeAction,
  ) {
    yield* lineOf(gameId, entryId)
    yield* lines.setChangeAction(gameId, entryId, action)

    return yield* lineOf(gameId, entryId)
  })

  return {
    inspectUpdate,
    installUpdate,
    undoUpdate,
    watchInstall,
    getGameUpdate,
    listSourceChanges,
    setSourceChangeAction,
  }
})
