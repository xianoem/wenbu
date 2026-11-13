import { DateTime, Effect } from 'effect'
import { zipSync } from 'fflate'
import { type ExportFormat, TranslationError } from '#contract/GameTranslation'
import { csvOf, jsonOf, mtoolOf, readmeOf, translatedCount } from './TranslationExport'
import { asTranslationError, encodeJson, type TranslationShared } from './TranslationShared'
import { titleInGame } from './UpdateInstaller'

export const makeExportTranslation = (shared: TranslationShared) => {
  const {
    gameData,
    path,
    fs,
    lines,
    gameOf,
    getSettings,
    ensureUnchanged,
    ensureLines,
    latestInstall,
  } = shared

  return Effect.fn('GameTranslation.export')(function* (
    gameId: string,
    format: ExportFormat,
    target: string,
    readme: boolean,
  ) {
    const game = yield* gameOf(gameId)

    yield* ensureLines(game)

    const stored = yield* lines.lines(gameId)
    const settings = yield* getSettings

    const exported = {
      title:
        (yield* titleInGame(game.folderPath, game.engine).pipe(
          Effect.orElseSucceed(() => undefined),
        )) ?? game.title,
      engine: game.engine,
      targetLanguage: settings.targetLanguage,
      version: (yield* latestInstall(gameId))?.report.install?.version,
    }

    return yield* Effect.gen(function* () {
      if (format === 'csv') {
        yield* fs.writeFileString(target, csvOf(stored))

        return { path: target, lines: translatedCount(stored), files: 1 }
      }

      if (format === 'json') {
        yield* fs.writeFileString(target, `${yield* encodeJson(jsonOf(exported, stored))}\n`)

        return { path: target, lines: translatedCount(stored), files: 1 }
      }

      if (format === 'mtool') {
        yield* fs.writeFileString(target, `${yield* encodeJson(mtoolOf(stored))}\n`)

        return { path: target, lines: translatedCount(stored), files: 1 }
      }

      yield* ensureUnchanged(game)

      const originals = yield* gameData.originalHashes(game)
      const current = yield* gameData.dataHashes(game)
      const dataPath = gameData.dataPathOf(game)
      const dataFolder = path.relative(game.folderPath, dataPath).split(path.sep).join('/')

      const written = [...current]
        .filter(([file, hash]) => originals.get(file) !== hash)
        .map(([file]) => file)

      if (written.length === 0) {
        return yield* new TranslationError({
          reason: 'invalid',
          message: 'The game has no translated files yet. Translate it first.',
        })
      }

      const files: Record<string, Uint8Array> = {}

      for (const file of written) {
        files[`${dataFolder}/${file}`] = yield* fs.readFile(path.join(dataPath, file))
      }

      if (readme) {
        const madeOn = DateTime.formatIsoDate(yield* DateTime.now)

        files['README.txt'] = new TextEncoder().encode(
          readmeOf(exported, dataFolder, written.length, madeOn),
        )
      }

      yield* fs.writeFile(target, zipSync(files))

      return {
        path: target,
        lines: translatedCount(stored.filter((line) => written.includes(line.file))),
        files: written.length,
      }
    }).pipe(Effect.mapError((error) => asTranslationError(error)))
  })
}
