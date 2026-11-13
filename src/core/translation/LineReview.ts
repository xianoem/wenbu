import { Effect } from 'effect'
import {
  type LineFilter,
  TranslationError,
  type TranslationLine,
  type TranslationSettings,
} from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { characterBudget, type Fit, fitOf } from '#contract/TextFit'
import type { TranslationItem } from '../rpgmaker/TextEntries'
import { batchPrompt, parseReply, systemPrompt } from './Batches'
import { encodeJson, failed, readableError, type TranslationShared } from './TranslationShared'

const everyLine = 1_000_000_000

const isTooLong = (game: Game, line: TranslationLine) =>
  line.translatedText !== undefined &&
  fitOf(game.engine, line.context, line.translatedText)?.status === 'too-long'

const shortenLimits = (fit: Fit | undefined) => {
  if (fit === undefined) {
    return 'noticeably shorter'
  }

  const lineLimit = fit.maxLines === undefined ? '' : ` and at most ${fit.maxLines} lines`

  return `at most about ${characterBudget(fit)} characters a line${lineLimit}`
}

const shortenPrompt = Effect.fnUntraced(function* (
  targetLanguage: string,
  fit: Fit | undefined,
  batch: ReadonlyArray<TranslationItem>,
) {
  const limits = shortenLimits(fit)

  const items = Object.fromEntries(
    batch.map((item, index) => [String(index + 1), { text: item.src, context: item.context }]),
  )

  return [
    `Shorten this ${targetLanguage} game text to ${limits}, so it fits its window in the game. Keep its meaning, its RPG Maker control codes (like \\C[2] or \\N[1]) and placeholders (like %1).`,
    'Return only a JSON object whose keys are the given numbers and whose values are the shortened strings.',
    yield* Effect.orDie(encodeJson(items)),
  ].join('\n\n')
})

const unlocked = (line: TranslationLine, action: string) =>
  line.locked
    ? Effect.fail(
        new TranslationError({ reason: 'invalid', message: `Unlock the line to ${action}.` }),
      )
    : Effect.void

export const makeLineReview = (shared: TranslationShared) => {
  const { lines, llm, gameOf, getSettings, describePreset, ensureLines, lineOf } = shared

  const listLines = Effect.fn('GameTranslation.listLines')(function* (request: {
    readonly gameId: string
    readonly filter: LineFilter
    readonly query: string
    readonly limit: number
  }) {
    const game = yield* gameOf(request.gameId)

    yield* ensureLines(game)

    const tooLong = new Set(
      (yield* lines.lines(request.gameId))
        .filter((line) => isTooLong(game, line))
        .map((line) => line.entryId),
    )

    const counts = { ...(yield* lines.counts(request.gameId)), tooLong: tooLong.size }

    if (request.filter !== 'too-long') {
      const page = yield* lines.list(request.gameId, request.filter, request.query, request.limit)

      return { ...page, counts }
    }

    const matching = (yield* lines.list(
      request.gameId,
      'all',
      request.query,
      everyLine,
    )).lines.filter((line) => tooLong.has(line.entryId))

    return { lines: matching.slice(0, request.limit), total: matching.length, counts }
  })

  const askForLine = Effect.fnUntraced(function* (
    gameId: string,
    item: TranslationItem,
    prompt: (settings: TranslationSettings) => Effect.Effect<string>,
    noAnswer: string,
  ) {
    const settings = yield* getSettings

    yield* describePreset(settings)

    const completion = yield* llm
      .complete({
        presetId: settings.presetId,
        feature: 'line-review',
        gameId,
        system: systemPrompt,
        prompt: yield* prompt(settings),
        timeout: `${settings.timeoutSeconds} seconds`,
      })
      .pipe(Effect.mapError((error) => failed(readableError(error.message))))

    const found = yield* parseReply(completion.text, [item], settings).pipe(
      Effect.mapError(() => failed('The reply was not the JSON Wenbu asked for.')),
    )

    const text = found.get(item.id)

    if (text === undefined) {
      return yield* failed(noAnswer)
    }

    yield* lines.saveModelTranslation(gameId, item.id, text)

    return yield* lineOf(gameId, item.id)
  })

  const shortenLine = Effect.fn('GameTranslation.shortenLine')(function* (
    gameId: string,
    entryId: string,
  ) {
    const game = yield* gameOf(gameId)
    const line = yield* lineOf(gameId, entryId)

    yield* unlocked(line, 'shorten it')

    const translated = line.translatedText

    if (translated === undefined) {
      return yield* new TranslationError({
        reason: 'invalid',
        message: 'Translate the line first.',
      })
    }

    const fit = fitOf(game.engine, line.context, translated)
    const item = { id: entryId, src: translated, context: line.context, entryIds: [entryId] }

    return yield* askForLine(
      gameId,
      item,
      (settings) => shortenPrompt(settings.targetLanguage, fit, [item]),
      'The model gave no shorter translation. Try again.',
    )
  })

  const getLine = Effect.fn('GameTranslation.getLine')(function* (gameId: string, entryId: string) {
    const line = yield* lineOf(gameId, entryId)
    const before = yield* lines.before(gameId, entryId)

    return {
      line,
      ...(before === undefined ? {} : { before }),
      sameSource: yield* lines.sameSource(gameId, entryId),
    }
  })

  const saveLine = Effect.fn('GameTranslation.saveLine')(function* (
    gameId: string,
    entryId: string,
    text: string,
  ) {
    yield* lineOf(gameId, entryId)

    if (text.trim() === '') {
      return yield* new TranslationError({
        reason: 'invalid',
        field: 'text',
        message: 'Type a translation, or translate the line again.',
      })
    }

    yield* lines.edit(gameId, entryId, text)

    return yield* lineOf(gameId, entryId)
  })

  const setLineLocked = Effect.fn('GameTranslation.setLineLocked')(function* (
    gameId: string,
    entryId: string,
    locked: boolean,
  ) {
    yield* lineOf(gameId, entryId)
    yield* lines.setLocked(gameId, entryId, locked)

    return yield* lineOf(gameId, entryId)
  })

  const retranslateLine = Effect.fn('GameTranslation.retranslateLine')(function* (
    gameId: string,
    entryId: string,
  ) {
    const line = yield* lineOf(gameId, entryId)

    yield* unlocked(line, 'translate it again')

    const item = { id: entryId, src: line.sourceText, context: line.context, entryIds: [entryId] }

    return yield* askForLine(
      gameId,
      item,
      (settings) => batchPrompt(settings, [item]),
      'The model gave no translation for this line. Try again.',
    )
  })

  return { listLines, getLine, saveLine, setLineLocked, retranslateLine, shortenLine }
}
