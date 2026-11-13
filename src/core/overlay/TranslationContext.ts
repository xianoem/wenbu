import type { OverlayContext } from '#contract/TranslationOverlay'
import { estimateTokens } from '../translation/Batches'

export interface ContextPair {
  readonly source: string
  readonly translation: string
}

export interface HistoryTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export const systemPrompt = (languages: {
  readonly sourceLanguage: string
  readonly targetLanguage: string
}) =>
  `You translate ${languages.sourceLanguage} game text into ${languages.targetLanguage} for a live overlay. Each message is one line from the game. Reply with the translated line only. Preserve names, punctuation intent and line breaks.`

export const summaryLimit = (budget: number) => Math.floor(budget / 4)

const pairTokens = (pair: ContextPair) =>
  estimateTokens(pair.source) + estimateTokens(pair.translation)

const recentPairs = (pairs: ReadonlyArray<ContextPair>, lines: number, budget: number) => {
  const kept: Array<ContextPair> = []
  let tokens = 0

  if (lines < 1) {
    return kept
  }

  for (const pair of pairs.slice(-lines).toReversed()) {
    tokens += pairTokens(pair)

    if (tokens > budget) {
      break
    }

    kept.unshift(pair)
  }

  return kept
}

const toTurns = (pairs: ReadonlyArray<ContextPair>): ReadonlyArray<HistoryTurn> =>
  pairs.flatMap((pair) => [
    { role: 'user' as const, text: pair.source },
    { role: 'assistant' as const, text: pair.translation },
  ])

const withSummary = (system: string, summary: string) =>
  `${system}\n\nStory so far, for context only:\n${summary}`

// Instructions, summary, then history oldest first: a stable prefix that providers' prompt caches can reuse.
export const contextFor = (input: {
  readonly system: string
  readonly pairs: ReadonlyArray<ContextPair>
  readonly summary?: string
  readonly settings: OverlayContext
  readonly budget: number
}): { readonly system: string; readonly history: ReadonlyArray<HistoryTurn> } => {
  const { settings, budget } = input

  if (settings.mode === 'off') {
    return { system: input.system, history: [] }
  }

  const summary = settings.mode === 'summary' ? (input.summary?.trim() ?? '') : ''

  if (summary === '') {
    return {
      system: input.system,
      history: toTurns(recentPairs(input.pairs, settings.lines, budget)),
    }
  }

  return {
    system: withSummary(input.system, summary),
    history: toTurns(recentPairs(input.pairs, settings.lines, budget - estimateTokens(summary))),
  }
}

export const summaryPrompt = (
  previous: string,
  pairs: ReadonlyArray<ContextPair>,
  limit: number,
) => {
  const lines = pairs.map((pair) => `${pair.source}\n→ ${pair.translation}`).join('\n\n')
  const earlier = previous.trim() === '' ? '(none yet)' : previous.trim()

  return {
    system: `You keep a short story summary that helps translate a game line by line. Keep it under ${limit} tokens. List the characters with their gender and pronouns, how they address each other, and the agreed spellings of names and terms. Then describe the current scene in a few sentences. Reply with the summary only.`,
    prompt: `Previous summary:\n${earlier}\n\nNew lines with their translations:\n${lines}\n\nWrite the updated summary.`,
  }
}
