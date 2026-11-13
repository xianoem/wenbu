import { Effect, Predicate, Schema } from 'effect'
import type { TranslationSettings } from '#contract/GameTranslation'
import type { TranslationItem } from '../rpgmaker/TextEntries'

export const estimateTokens = (text: string) => {
  const cjk = text.match(/[぀-ヿ一-鿿가-힯]/g)?.length ?? 0

  return Math.ceil(cjk / 2 + (text.length - cjk) / 4)
}

export const batchesOf = (items: ReadonlyArray<TranslationItem>, tokenBudget: number) => {
  const batches: Array<Array<TranslationItem>> = []
  let current: Array<TranslationItem> = []
  let tokens = 0

  for (const item of items) {
    const cost = estimateTokens(item.src) + estimateTokens(item.context)

    if (tokens + cost > Math.max(1, tokenBudget) && current.length > 0) {
      batches.push(current)
      current = []
      tokens = 0
    }

    current.push(item)
    tokens += cost
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

export const systemPrompt = 'You are a careful RPG Maker localization assistant.'

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

export const batchPrompt = Effect.fnUntraced(function* (
  settings: TranslationSettings,
  batch: ReadonlyArray<TranslationItem>,
) {
  const items = Object.fromEntries(
    batch.map((item, index) => [String(index + 1), { text: item.src, context: item.context }]),
  )

  return [
    `Detect the language of the game text, then translate it into ${settings.targetLanguage}.`,
    'Return only a JSON object whose keys are the given numbers and whose values are the translated strings.',
    'Keep RPG Maker control codes (like \\C[2] or \\N[1]), placeholders (like %1) and line breaks.',
    yield* Effect.orDie(encodeJson(items)),
  ].join('\n\n')
})

const decodeReply = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

const hasCjk = (text: string) => /[぀-ヿ一-鿿]/.test(text)

export const parseReply = Effect.fnUntraced(function* (
  reply: string,
  batch: ReadonlyArray<TranslationItem>,
  settings: TranslationSettings,
) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1] ?? reply
  const values = yield* decodeReply(fenced.trim())
  const translations = new Map<string, string>()

  for (const [index, item] of batch.entries()) {
    const value = values[String(index + 1)]

    if (!Predicate.isString(value) || value.trim() === '') {
      continue
    }

    const untranslated =
      value === item.src &&
      hasCjk(item.src) &&
      !/japanese|chinese|korean/i.test(settings.targetLanguage)

    if (!untranslated) {
      translations.set(item.id, value)
    }
  }

  return translations
})
