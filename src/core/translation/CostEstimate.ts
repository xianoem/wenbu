import { Effect } from 'effect'
import type { TranslationSettings } from '#contract/GameTranslation'
import type { ModelPrice } from '#contract/Llm'
import type { TranslationItem } from '../rpgmaker/TextEntries'
import { batchesOf, batchPrompt, estimateTokens, systemPrompt } from './Batches'

const outputRatio = 1.3

const outputSpread = 1.5

const retryShare = 0.1

export const costOf = (price: ModelPrice, inputTokens: number, outputTokens: number) =>
  (inputTokens * price.input + outputTokens * price.output) / 1_000_000

export const batchTokens = Effect.fnUntraced(function* (
  settings: TranslationSettings,
  batch: ReadonlyArray<TranslationItem>,
) {
  const text = batch.reduce((total, item) => total + estimateTokens(item.src), 0)

  return {
    input: estimateTokens(systemPrompt) + estimateTokens(yield* batchPrompt(settings, batch)),
    output: Math.ceil(text * outputRatio),
  }
})

export const estimateCost = Effect.fnUntraced(function* (
  settings: TranslationSettings,
  items: ReadonlyArray<TranslationItem>,
  price: ModelPrice | undefined,
) {
  const batches = batchesOf(items, settings.chunkTokens)
  let inputTokens = 0
  let textTokens = 0

  for (const batch of batches) {
    const tokens = yield* batchTokens(settings, batch)

    inputTokens += tokens.input
    textTokens += batch.reduce((total, item) => total + estimateTokens(item.src), 0)
  }

  const outputTokens = Math.ceil(textTokens * outputRatio)

  return {
    lines: items.reduce((total, item) => total + item.entryIds.length, 0),
    batches: batches.length,
    inputTokens,
    outputTokens,
    ...(price === undefined
      ? {}
      : {
          costUsd: {
            low: costOf(price, inputTokens, outputTokens),
            high:
              (1 + retryShare) * costOf(price, inputTokens, Math.ceil(outputTokens * outputSpread)),
          },
        }),
  }
})
