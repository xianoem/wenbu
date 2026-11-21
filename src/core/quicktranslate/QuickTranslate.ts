import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import { LanguageModel, type Prompt } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import {
  defaultQuickTranslateSettings,
  QuickDelta,
  QuickDone,
  type QuickEvent,
  QuickLanguage,
  type QuickMessage,
  quickTextLimit,
  QuickTranslateError,
  QuickTranslateRpc,
  QuickTranslateSettings,
} from '#contract/QuickTranslate'
import { LlmClient, type PresetModel } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as SettingsStore from '../platform/SettingsStore'

const settingsKey = 'quick-translate'

const translateSystem = [
  'You translate text that someone copied on their computer into natural English: a forum post, a chat message, a menu, a line from a game. The text can be in any language.',
  'Reply in exactly this form:',
  'LANGUAGE: <the language of the text, named in English, like Japanese>',
  '<the English translation>',
  'After the first line write only the translation: no notes, quotes or explanations. Keep the line breaks, lists, names, numbers, links and code as they are, and keep the tone: casual stays casual, polite stays polite.',
  'If the text is already in English, write it back unchanged.',
].join('\n')

const askSystem = (text: string, translation: string) =>
  [
    'Someone copied the text below and read its English translation. Answer their questions about it: what it means, its tone, words and grammar, culture, or help writing a reply in its language.',
    'Answer in English, briefly and directly. Write plain text: short paragraphs, and lines starting with "- " for lists. No headings, tables or bold.',
    'When you write something for them to copy, such as a reply in the text’s language, put it alone between two lines of three backticks, and give its English meaning after the block.',
    '',
    'The text:',
    text,
    '',
    'Its translation:',
    translation,
  ].join('\n')

const quickError = (reason: QuickTranslateError['reason'], message: string) =>
  new QuickTranslateError({ reason, message })

const languageLine = /^LANGUAGE:\s*(.+?)\s*$/i

const longestLanguageLine = 80

interface ReplyReader {
  readonly push: (delta: string) => ReadonlyArray<QuickEvent>
  readonly end: () => ReadonlyArray<QuickEvent>
}

const textReader = (): ReplyReader => {
  let started = false

  const push = (delta: string): ReadonlyArray<QuickEvent> => {
    const text = started ? delta : delta.replace(/^\s+/, '')

    if (text === '') {
      return []
    }

    started = true

    return [QuickDelta.make({ text })]
  }

  return { push, end: () => [] }
}

export const translationReader = (): ReplyReader => {
  const text = textReader()
  let head: string | undefined = ''

  const settle = (buffered: string, end: number): ReadonlyArray<QuickEvent> => {
    const line = end === -1 ? buffered : buffered.slice(0, end)
    const language = languageLine.exec(line)?.[1]

    if (language === undefined) {
      return text.push(buffered)
    }

    const rest = end === -1 ? '' : buffered.slice(end + 1)

    return [QuickLanguage.make({ name: language }), ...text.push(rest)]
  }

  const push = (delta: string): ReadonlyArray<QuickEvent> => {
    if (head === undefined) {
      return text.push(delta)
    }

    const buffered = (head + delta).replace(/^\s+/, '')
    const end = buffered.indexOf('\n')

    if (end === -1 && buffered.length <= longestLanguageLine) {
      head = buffered

      return []
    }

    head = undefined

    return settle(buffered, end)
  }

  const end = (): ReadonlyArray<QuickEvent> => {
    if (head === undefined || head === '') {
      return []
    }

    const buffered = head

    head = undefined

    return settle(buffered, -1)
  }

  return { push, end }
}

const replyStream = (model: PresetModel, prompt: Prompt.RawInput, reader: ReplyReader) =>
  LanguageModel.streamText({ prompt }).pipe(
    Stream.provide(model.layer),
    Stream.mapError((error) => quickError('failed', error.message)),
    Stream.mapEffect((part): Effect.Effect<ReadonlyArray<QuickEvent>> => {
      if (part.type === 'text-delta') {
        return Effect.succeed(reader.push(part.delta))
      }

      if (part.type === 'finish') {
        const usage = {
          inputTokens: part.usage.inputTokens.total ?? 0,
          outputTokens: part.usage.outputTokens.total ?? 0,
        }

        return Effect.map(model.spend(usage, part.usage.inputTokens.cacheRead ?? 0), (cost) => [
          ...reader.end(),
          QuickDone.make({
            modelName: model.modelName,
            ...(cost === undefined ? {} : { costUsd: cost }),
          }),
        ])
      }

      return Effect.succeed([])
    }),
    Stream.flatMap((events) => Stream.fromIterable(events)),
    Stream.timeoutOrElse({
      duration: '2 minutes',
      orElse: () =>
        Stream.fail(quickError('failed', `${model.modelName} stopped answering. Try again.`)),
    }),
  )

const checkText = (text: string) => {
  const trimmed = text.trim()

  if (trimmed === '') {
    return Effect.fail(quickError('invalid', 'There is no text to translate.'))
  }

  if (trimmed.length > quickTextLimit) {
    return Effect.fail(
      quickError(
        'invalid',
        `The selection is ${trimmed.length.toLocaleString('en')} characters long. Quick Translate takes up to ${quickTextLimit.toLocaleString('en')}.`,
      ),
    )
  }

  return Effect.succeed(trimmed)
}

export class QuickTranslate extends Context.Service<
  QuickTranslate,
  {
    readonly settings: Effect.Effect<QuickTranslateSettings>
    readonly settingsChanges: Stream.Stream<QuickTranslateSettings>
    readonly saveSettings: (
      settings: QuickTranslateSettings,
    ) => Effect.Effect<QuickTranslateSettings>
    readonly translate: (text: string) => Stream.Stream<QuickEvent, QuickTranslateError>
    readonly ask: (request: {
      readonly text: string
      readonly translation: string
      readonly history: ReadonlyArray<QuickMessage>
      readonly question: string
    }) => Stream.Stream<QuickEvent, QuickTranslateError>
  }
>()('wenbu/core/quicktranslate/QuickTranslate') {
  static readonly layer = Layer.effect(
    QuickTranslate,
    Effect.gen(function* () {
      const llm = yield* LlmClient
      const kv = yield* KeyValueStore.KeyValueStore
      const store = SettingsStore.make(kv, QuickTranslateSettings, defaultQuickTranslateSettings)

      const saved = yield* Effect.orElseSucceed(
        store.get(settingsKey),
        () => defaultQuickTranslateSettings,
      )

      const settingsRef = yield* SubscriptionRef.make(saved)

      const saveSettings = Effect.fn('QuickTranslate.saveSettings')(function* (
        settings: QuickTranslateSettings,
      ) {
        const next = { ...settings, presetId: settings.presetId.trim() }

        yield* store.set(settingsKey, next).pipe(Effect.orDie)
        yield* SubscriptionRef.set(settingsRef, next)

        return next
      })

      const presetModel = Effect.gen(function* () {
        const { presetId } = yield* SubscriptionRef.get(settingsRef)

        if (presetId === '') {
          return yield* quickError(
            'no-preset',
            'Choose a model for Quick Translate in Settings, under General.',
          )
        }

        return yield* llm
          .model(presetId, { feature: 'quick-translate' })
          .pipe(Effect.mapError((error) => quickError('no-preset', error.message)))
      })

      const translate = (text: string) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const checked = yield* checkText(text)
            const model = yield* presetModel

            return replyStream(
              model,
              [
                { role: 'system', content: translateSystem },
                { role: 'user', content: checked },
              ],
              translationReader(),
            )
          }),
        )

      const ask = (request: {
        readonly text: string
        readonly translation: string
        readonly history: ReadonlyArray<QuickMessage>
        readonly question: string
      }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const text = yield* checkText(request.text)
            const question = request.question.trim()

            if (question === '') {
              return yield* quickError('invalid', 'Ask a question first.')
            }

            const model = yield* presetModel

            return replyStream(
              model,
              [
                { role: 'system', content: askSystem(text, request.translation.trim()) },
                ...request.history.map((message) => ({
                  role: message.role,
                  content: message.text,
                })),
                { role: 'user', content: question },
              ],
              textReader(),
            )
          }),
        )

      yield* (yield* PresetReferences).register({
        area: 'Quick Translate',
        uses: (presetIds) =>
          Effect.map(SubscriptionRef.get(settingsRef), (settings) =>
            presetIds.has(settings.presetId),
          ),
        clear: (presetIds) =>
          Effect.flatMap(SubscriptionRef.get(settingsRef), (settings) =>
            presetIds.has(settings.presetId)
              ? Effect.asVoid(saveSettings({ ...settings, presetId: '' }))
              : Effect.void,
          ),
      })

      return QuickTranslate.of({
        settings: SubscriptionRef.get(settingsRef),
        settingsChanges: SubscriptionRef.changes(settingsRef),
        saveSettings,
        translate,
        ask,
      })
    }),
  )
}

export const QuickTranslateRpcLive = QuickTranslateRpc.toLayer(
  Effect.gen(function* () {
    const quick = yield* QuickTranslate

    return QuickTranslateRpc.of({
      quickTranslate: ({ text }) => quick.translate(text),
      quickAsk: (request) => quick.ask(request),
      getQuickTranslateSettings: () => quick.settings,
      saveQuickTranslateSettings: (settings) => quick.saveSettings(settings),
    })
  }),
)
