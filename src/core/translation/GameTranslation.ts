import { Effect } from 'effect'
import { GameTranslationRpc } from '#contract/GameTranslation'
import { makeExportTranslation } from './ExportTranslation'
import { makeGameUpdateFlow } from './GameUpdateFlow'
import { makeLineReview } from './LineReview'
import { makeTranslationRuns } from './TranslationRuns'
import { makeTranslationShared } from './TranslationShared'

export const GameTranslationLive = GameTranslationRpc.toLayer(
  Effect.gen(function* () {
    const shared = yield* makeTranslationShared
    const runs = yield* makeTranslationRuns(shared)
    const review = makeLineReview(shared)
    const updates = yield* makeGameUpdateFlow(shared)
    const exportTranslation = makeExportTranslation(shared)

    return GameTranslationRpc.of({
      getTranslationSettings: () => shared.getSettings,
      saveTranslationSettings: (settings) => runs.saveSettings(settings),
      startTranslation: ({ gameId, scope, spendLimit }) =>
        runs.start(gameId, scope ?? 'missing', spendLimit),
      estimateTranslation: ({ gameId, scope }) => runs.estimate(gameId, scope ?? 'missing'),
      setRunSpendLimit: ({ gameId, limit }) => runs.setRunSpendLimit(gameId, limit),
      listTranslationLines: (request) => review.listLines(request),
      getTranslationLine: ({ gameId, entryId }) => review.getLine(gameId, entryId),
      saveTranslationLine: ({ gameId, entryId, text }) => review.saveLine(gameId, entryId, text),
      setTranslationLineLocked: ({ gameId, entryId, locked }) =>
        review.setLineLocked(gameId, entryId, locked),
      retranslateLine: ({ gameId, entryId }) => review.retranslateLine(gameId, entryId),
      shortenTranslationLine: ({ gameId, entryId }) => review.shortenLine(gameId, entryId),
      applyTranslationEdits: ({ gameId }) => shared.applyEdits(gameId, false),
      restoreTranslatedFiles: ({ gameId }) => shared.applyEdits(gameId, true),
      getGameUpdate: ({ gameId }) => updates.getGameUpdate(gameId),
      inspectGameUpdate: ({ gameId, archive }) =>
        Effect.map(updates.inspectUpdate(gameId, archive), (inspected) => inspected.inspection),
      installGameUpdate: ({ gameId, archive, acceptWarnings }) =>
        updates.installUpdate(gameId, archive, acceptWarnings),
      undoGameUpdate: ({ gameId }) => updates.undoUpdate(gameId),
      watchGameUpdateInstall: ({ gameId }) => updates.watchInstall(gameId),
      exportTranslation: ({ gameId, format, target, readme }) =>
        exportTranslation(gameId, format, target, readme),
      listSourceChanges: ({ gameId }) => updates.listSourceChanges(gameId),
      setSourceChangeAction: ({ gameId, entryId, action }) =>
        updates.setSourceChangeAction(gameId, entryId, action),
      cancelTranslation: ({ gameId }) => runs.cancel(gameId),
      removeTranslation: ({ gameId }) => runs.remove(gameId),
      listTranslationRuns: ({ gameId }) => runs.listRuns(gameId),
      watchTranslation: ({ gameId }) => runs.watch(gameId),
    })
  }),
)
