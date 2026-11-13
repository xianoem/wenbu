import { Clock, Effect, Option, Queue, Ref, Schema, Stream, SubscriptionRef } from 'effect'
import { Chat } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import {
  type AskEvent,
  defaultGuideSettings,
  type GameFact,
  GameGuideError,
  GameGuideRpc,
  type GuideAnswer,
  type GuideIndexState,
  GuideSettings,
} from '#contract/GameGuide'
import { defaultTranslationSettings, TranslationSettings } from '#contract/GameTranslation'
import { type Game, isTranslatable } from '#contract/Library'
import type { LiveControlsError } from '#contract/LiveControls'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as SettingsStore from '../platform/SettingsStore'
import { GameData } from '../rpgmaker/GameData'
import { isTextFile } from '../rpgmaker/TextLocations'
import type { RpgData } from '../rpgmaker/RpgData'
import { TranslationLines } from '../translation/TranslationLines'
import { type GuideBook, makeGuideBook } from './GuideBook'
import { GuideIndexStore } from './GuideIndexStore'
import { GuideState } from './GuideState'
import { GuideToolkit, guideHandlers, toolLabels } from './GuideTools'
import { type KnowledgeIndex, makeIndexBuilder } from './KnowledgeIndex'

const MAX_STEPS = 8

const HISTORY_TURNS = 6

const noIndex: GuideIndexState = {
  status: 'none',
  message: 'Connect to an RPG Maker game to read its data.',
  maps: 0,
  events: 0,
  facts: 0,
  lines: 0,
}

const readyState = (index: KnowledgeIndex): GuideIndexState => ({
  status: 'ready',
  message: `Read ${index.maps.length} maps and ${index.events.length} events.`,
  maps: index.maps.length,
  events: index.events.length,
  facts: index.facts.length,
  lines: index.lines.length,
})

const guideError = (reason: GameGuideError['reason'], message: string) =>
  new GameGuideError({ reason, message })

const liveReasons: Partial<Record<LiveControlsError['reason'], GameGuideError['reason']>> = {
  'not-connected': 'not-connected',
  'not-ready': 'not-ready',
}

const fromLive = (error: LiveControlsError) =>
  guideError(liveReasons[error.reason] ?? 'failed', error.message)

const decodeState = Schema.decodeUnknownEffect(GuideState)

const systemPrompt = (book: GuideBook, language: string) => {
  const { state, index } = book

  const party = state.party.map(
    (id) => index.actors.find((actor) => actor.id === id)?.name ?? `Actor ${id}`,
  )

  const recent = book
    .recentDialogue()
    .slice(-3)
    .map((line) => `- ${line.summary}: ${line.text ?? ''}`)

  return [
    `You talk with a player of the RPG Maker game "${index.title}" about the game: where things are, what to do, who the characters are, what happens and what the game contains. Answer in ${language}, directly and completely, like a friend who has read all of the game's files. Spoilers are fine when they answer the question.`,
    "Everything you say about the game must come from the tools, which read the game's own data. Never guess, and never use what you may remember about the game. If the tools don't show something, say plainly that the game's data doesn't show it.",
    "The game's text is usually in Japanese or Chinese. Search with words in that language as well as in the player's: for \"brainwashing\" also try 洗脳 and 催眠. Try several words before concluding something isn't there.",
    'After a sentence that relies on facts from the tools, add their ids in square brackets, like [f12] or [l40, e3.7]. Wenbu turns these into the sources under your answer.',
    'Write plain text: short paragraphs, and lines starting with "- " for lists. No headings, tables or bold. Use names as the tools give them.',
    '',
    `The player is on "${book.mapName(state.mapId)}" at ${state.x},${state.y}${state.inBattle ? ', in a battle' : ''}.`,
    `Party: ${party.join(', ') || 'none'}. Gold: ${state.gold}.`,
    ...(recent.length > 0 ? ['Last dialogue seen:', ...recent] : []),
  ].join('\n')
}

const CITATION = /\s*\[([feldnm]\d+(?:\.\d+)?(?:\s*,\s*[feldnm]\d+(?:\.\d+)?)*)\]/g

export const citationsOf = (text: string) => ({
  ids: [...text.matchAll(CITATION)].flatMap((match) =>
    (match[1] ?? '').split(',').map((id) => id.trim()),
  ),
  text: text.replace(CITATION, '').trim(),
})

interface Turn {
  readonly question: string
  readonly answer: GuideAnswer
}

export const GameGuideRpcLive = GameGuideRpc.toLayer(
  Effect.gen(function* () {
    const live = yield* LiveControls
    const gameData = yield* GameData
    const store = yield* GuideIndexStore
    const translationLines = yield* TranslationLines
    const llm = yield* LlmClient
    const kv = yield* KeyValueStore.KeyValueStore
    const settingsStore = SettingsStore.make(kv, GuideSettings, defaultGuideSettings)
    const translationStore = SettingsStore.make(kv, TranslationSettings, defaultTranslationSettings)
    const indexState = yield* SubscriptionRef.make<GuideIndexState>(noIndex)

    const loaded = yield* Ref.make(
      Option.none<{ readonly gameId: string; readonly index: KnowledgeIndex }>(),
    )

    const conversations = yield* Ref.make(new Map<string, ReadonlyArray<Turn>>())
    const building = yield* Ref.make(Option.none<string>())

    const setIndex = (next: GuideIndexState) => SubscriptionRef.set(indexState, next)

    const settings = Effect.orElseSucceed(
      settingsStore.get('game-guide'),
      () => defaultGuideSettings,
    )

    const translation = Effect.orElseSucceed(
      translationStore.get('game-translation'),
      () => defaultTranslationSettings,
    )

    const buildIndex = Effect.fnUntraced(function* (game: Game) {
      let tilesets: RpgData | undefined

      yield* gameData.forEachOriginal(
        game,
        (name) => /^Tilesets\./i.test(name),
        (_, data) =>
          Effect.sync(() => {
            tilesets = data
          }),
      )

      const builder = makeIndexBuilder(tilesets)

      yield* gameData.forEachOriginal(game, isTextFile, (name, data) =>
        Effect.sync(() => builder.add(name, data)),
      )

      return builder.finish()
    })

    const ensureIndex = Effect.fn('GameGuide.ensureIndex')(function* (game: Game) {
      if (!isTranslatable(game.engine)) {
        yield* setIndex({
          ...noIndex,
          status: 'failed',
          message: 'The Game Guide reads RPG Maker MV, MZ and VX Ace games for now.',
        })

        return
      }

      const stamp = yield* gameData.originalStamp(game)
      const stored = yield* store.get(game.id)

      if (stored !== undefined && stored.stamp === stamp) {
        yield* Ref.set(loaded, Option.some({ gameId: game.id, index: stored.index }))
        yield* setIndex(readyState(stored.index))

        return
      }

      yield* setIndex({ ...noIndex, status: 'building', message: "Reading the game's data…" })

      const started = yield* Clock.currentTimeMillis
      const index = yield* buildIndex(game)

      yield* store.save(game.id, { stamp, index })
      yield* Ref.set(loaded, Option.some({ gameId: game.id, index }))
      yield* setIndex(readyState(index))

      yield* Effect.logInfo('Game Guide index built').pipe(
        Effect.annotateLogs({
          feature: 'gameguide',
          game: game.id,
          ms: (yield* Clock.currentTimeMillis) - started,
          maps: index.maps.length,
          facts: index.facts.length,
          lines: index.lines.length,
        }),
      )
    })

    const prepare = (game: Game) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(building)

        if (Option.isSome(current) && current.value === game.id) {
          return
        }

        yield* Ref.set(building, Option.some(game.id))

        yield* ensureIndex(game).pipe(
          Effect.catch((error) =>
            setIndex({ ...noIndex, status: 'failed', message: error.message }),
          ),
          Effect.ensuring(Ref.set(building, Option.none())),
        )
      })

    yield* live.sessions.pipe(
      Stream.runForEach((session) =>
        Option.match(session, {
          onNone: () => Effect.void,
          onSome: (connected) => prepare(connected.game),
        }),
      ),
      Effect.forkScoped,
    )

    const connected = Effect.flatMap(live.session, (session) =>
      Option.match(session, {
        onNone: () => Effect.fail(guideError('not-connected', 'Connect to a game first.')),
        onSome: Effect.succeed,
      }),
    )

    const currentBook = Effect.gen(function* () {
      const session = yield* connected

      const index = Option.filter(
        yield* Ref.get(loaded),
        (entry) => entry.gameId === session.game.id,
      )

      if (Option.isNone(index)) {
        return yield* guideError('no-index', "Wenbu is still reading the game's data.")
      }

      const raw = yield* session.runtime.call('guideState').pipe(Effect.mapError(fromLive))

      const state = yield* decodeState(raw).pipe(
        Effect.mapError(() =>
          guideError('failed', 'The game answered with data Wenbu could not read.'),
        ),
      )

      const translations = yield* translationLines.translations(session.game.id)

      return { game: session.game, book: makeGuideBook(index.value.index, state, translations) }
    })

    const cite = (book: GuideBook, ids: ReadonlyArray<string>, seen: ReadonlySet<string>) =>
      [...new Set(ids)].flatMap((id): ReadonlyArray<GameFact> => {
        const fact = seen.has(id) ? book.resolve(id) : undefined

        return fact === undefined ? [] : [fact]
      })

    const historyOf = (turns: ReadonlyArray<Turn>) =>
      turns.slice(-HISTORY_TURNS).flatMap((turn) => [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: turn.answer.text },
      ])

    const ask = (question: string) =>
      Stream.callback<AskEvent, GameGuideError>((queue) =>
        Effect.gen(function* () {
          const started = yield* Clock.currentTimeMillis
          const { game, book } = yield* currentBook
          const guide = yield* settings
          const translated = yield* translation
          const presetId = guide.presetId === '' ? translated.presetId : guide.presetId

          if (presetId === '') {
            return yield* guideError('no-preset', 'Choose an LLM preset for the Game Guide first.')
          }

          const model = yield* llm
            .model(presetId, { feature: 'game-guide', gameId: game.id })
            .pipe(Effect.mapError((error) => guideError('no-preset', error.message)))

          const seen = new Set<string>()
          const toolkit = yield* GuideToolkit.pipe(Effect.provide(guideHandlers(book, seen)))
          const turns = (yield* Ref.get(conversations)).get(game.id) ?? []

          const chat = yield* Chat.fromPrompt([
            { role: 'system', content: systemPrompt(book, translated.targetLanguage) },
            ...historyOf(turns),
          ])

          let inputTokens = 0
          let outputTokens = 0
          let cachedTokens = 0
          let reply = ''

          for (let step = 0; step < MAX_STEPS && reply === ''; step++) {
            const last = step === MAX_STEPS - 1

            const response = yield* chat
              .generateText({
                prompt: step === 0 ? question : [],
                toolkit,
                ...(last ? { toolChoice: 'none' as const } : {}),
              })
              .pipe(
                Effect.provide(model.layer),
                Effect.mapError((error) => guideError('failed', error.message)),
                Effect.timeoutOrElse({
                  duration: '90 seconds',
                  orElse: () =>
                    Effect.fail(guideError('failed', `${model.modelName} didn't answer in time.`)),
                }),
              )

            inputTokens += response.usage.inputTokens.total ?? 0
            outputTokens += response.usage.outputTokens.total ?? 0
            cachedTokens += response.usage.inputTokens.cacheRead ?? 0

            for (const call of response.toolCalls) {
              yield* Queue.offer(queue, {
                type: 'step',
                label: toolLabels[call.name] ?? 'Looking things up',
              })
            }

            yield* Effect.logDebug('Game Guide step').pipe(
              Effect.annotateLogs({
                feature: 'gameguide',
                step,
                tools: response.toolCalls.map((call) => call.name).join(','),
                text: response.text.length,
              }),
            )

            if (response.toolCalls.length === 0) {
              reply = response.text.trim()
            }
          }

          const cited = citationsOf(reply)
          const facts = cite(book, cited.ids, seen)

          const target = facts.find(
            (fact) => fact.kind !== 'dialogue' && fact.place?.x !== undefined,
          )?.place

          const finished = yield* Clock.currentTimeMillis
          const costUsd = yield* model.spend({ inputTokens, outputTokens }, cachedTokens)

          const answer: GuideAnswer = {
            id: `${finished}`,
            question,
            text:
              cited.text === ''
                ? "The guide looked through the game's data but didn't write an answer. Try asking again in other words."
                : cited.text,
            facts,
            ...(target === undefined
              ? {}
              : {
                  sketch: book.sketch(
                    target.mapId,
                    target.x === undefined || target.y === undefined
                      ? undefined
                      : { x: target.x, y: target.y },
                  ),
                }),
            modelName: model.modelName,
            seconds: (finished - started) / 1000,
            ...(costUsd === undefined ? {} : { costUsd }),
          }

          yield* Ref.update(conversations, (all) =>
            new Map(all).set(game.id, [...turns, { question, answer }]),
          )

          yield* Queue.offer(queue, { type: 'answer', answer })

          yield* Effect.logInfo('Game Guide answered').pipe(
            Effect.annotateLogs({
              feature: 'gameguide',
              inputTokens,
              outputTokens,
              cachedTokens,
              facts: facts.length,
            }),
          )
        }).pipe(
          Effect.matchEffect({
            onFailure: (error) => Queue.fail(queue, error),
            onSuccess: () => Queue.end(queue),
          }),
        ),
      )

    const connectedGameId = Effect.map(
      live.session,
      Option.map((session) => session.game.id),
    )

    return GameGuideRpc.of({
      watchGuideIndex: () => SubscriptionRef.changes(indexState),
      rebuildGuideIndex: () =>
        Effect.gen(function* () {
          const session = yield* connected

          yield* ensureIndex(session.game).pipe(
            Effect.mapError((error) => guideError('failed', error.message)),
          )
        }),
      guideHere: () =>
        Effect.map(currentBook, ({ book }) => ({
          mapId: book.state.mapId,
          mapName: book.mapName(book.state.mapId),
          x: book.state.x,
          y: book.state.y,
          inBattle: book.state.inBattle,
          around: book.around(book.state.mapId),
          next: book.nextSteps(3),
          enemies: book.enemies(),
        })),
      findInGame: ({ query }) => Effect.map(currentBook, ({ book }) => book.find(query)),
      mapSketch: ({ mapId, target }) =>
        Effect.map(currentBook, ({ book }) => book.sketch(mapId, target)),
      askGuide: ({ question }) => ask(question),
      guideConversation: () =>
        Effect.gen(function* () {
          const gameId = yield* connectedGameId
          const all = yield* Ref.get(conversations)

          return Option.match(gameId, {
            onNone: () => [],
            onSome: (id) => (all.get(id) ?? []).map((turn) => turn.answer),
          })
        }),
      clearGuideConversation: () =>
        Effect.gen(function* () {
          const gameId = yield* connectedGameId

          if (Option.isSome(gameId)) {
            yield* Ref.update(conversations, (all) => {
              const next = new Map(all)

              next.delete(gameId.value)

              return next
            })
          }
        }),
      getGuideSettings: () => settings,
      saveGuideSettings: ({ settings: next }) =>
        settingsStore.set('game-guide', next).pipe(Effect.orDie),
    })
  }),
)
