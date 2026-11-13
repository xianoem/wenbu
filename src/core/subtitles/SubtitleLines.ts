import type { Sensitivity } from '#contract/Subtitles'
import type { ContextPair } from '../overlay/TranslationContext'
import { estimateTokens } from '../translation/Batches'

const sentenceEnd = /[。！？!?.…♪」』）)"”]\s*$/u

const cjk = /[぀-ヿ一-鿿가-힯]/u

// Hangul is left out: Korean spaces its words.
const spacedCjkGap = /(?<=[　-ヿ㐀-鿿＀-￯])\s+(?=[　-ヿ㐀-鿿＀-￯])/gu

export const closeCjkGaps = (text: string) => text.replace(spacedCjkGap, '')

export const endsSentence = (text: string) => sentenceEnd.test(text.trim())

export const joinUtterances = (first: string, second: string) => {
  const left = first.trim()
  const right = second.trim()
  const glue = cjk.test(left.at(-1) ?? '') || cjk.test(right.at(0) ?? '') ? '' : ' '

  return `${left}${glue}${right}`
}

export const vadThreshold: Record<Sensitivity, number> = { low: 0.6, normal: 0.5, high: 0.35 }

const slowLineMs = 700

export const recognitionSlow = (recentMs: ReadonlyArray<number>) =>
  recentMs.slice(-3).filter((ms) => ms >= slowLineMs).length >= 2

export const systemPrompt = (targetLanguage: string) =>
  `You translate speech into ${targetLanguage} for live subtitles. Each message is one line someone said, recognised from audio in a game, an anime, a stream or a drama CD, so it may hold small recognition mistakes. Reply with the translated line only: natural, short enough to read at a glance, keeping names and the speaker's tone.`

export const recentPairs = (pairs: ReadonlyArray<ContextPair>, lines: number, budget: number) => {
  const kept: Array<ContextPair> = []
  let tokens = 0

  if (lines < 1) {
    return kept
  }

  for (const pair of pairs.slice(-lines).toReversed()) {
    tokens += estimateTokens(pair.source) + estimateTokens(pair.translation)

    if (tokens > budget) {
      break
    }

    kept.unshift(pair)
  }

  return kept
}
