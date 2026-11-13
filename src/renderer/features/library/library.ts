import { Effect, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import type { SpendLimit, TranslationScope } from '#contract/GameTranslation'
import type { Game, TextProfile } from '#contract/Library'
import { Core } from '#lib/rpc'

export { formatBytes, formatDay, formatMoment } from '#lib/format'

export const libraryKeys = ['library']

export const translationKeys = ['translation']

export const gamesAtom = Core.query('listGames', undefined, { reactivityKeys: libraryKeys })

export const inspectFolderAtom = Core.mutation('inspectFolder')

export const addGameAtom = Core.mutation('addGame')

export const updateGameAtom = Core.mutation('updateGame')

export const removeGameAtom = Core.mutation('removeGame')

export const launchGameAtom = Core.mutation('launchGame')

export const setLaunchLocaleAtom = Core.mutation('setLaunchLocale')

export const createCgPackAtom = Core.mutation('createCgPack')

export const imageFoldersAtom = Atom.family((id: string) => Core.query('listImageFolders', { id }))

export const translationSettingsAtom = Core.query('getTranslationSettings', undefined, {
  reactivityKeys: ['translation-settings'],
})

export const saveTranslationSettingsAtom = Core.mutation('saveTranslationSettings')

export const startTranslationAtom = Core.mutation('startTranslation')

export const cancelTranslationAtom = Core.mutation('cancelTranslation')

export const removeTranslationAtom = Core.mutation('removeTranslation')

export const translationRunsAtom = Atom.family((gameId: string) =>
  Core.query('listTranslationRuns', { gameId }, { reactivityKeys: translationKeys }),
)

export const setRunSpendLimitAtom = Core.mutation('setRunSpendLimit')

export const estimateKey = (
  gameId: string,
  scope: TranslationScope,
): `${TranslationScope}:${string}` => `${scope}:${gameId}`

export const translationEstimateAtom = Atom.family((key: `${TranslationScope}:${string}`) => {
  const [scope, gameId = ''] = key.split(/:(.*)/s)

  return Core.query(
    'estimateTranslation',
    { gameId, scope: scope === 'changed' ? 'changed' : 'missing' },
    { reactivityKeys: [...translationKeys, 'translation-settings'] },
  )
})

export const latestRunAtom = Atom.family((gameId: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('watchTranslation', { gameId })
      }),
    ),
  ),
)

const tints = ['violet', 'teal', 'amber', 'slate'] as const

export const tintOf = (game: Pick<Game, 'id'>) =>
  tints[[...game.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tints.length] ?? 'slate'

export const initialOf = (title: string) => [...title.trim()][0]?.toUpperCase() ?? '?'

export const formatDuration = (seconds: number) => {
  const minutes = Math.round(seconds / 60)

  if (minutes < 1) {
    return seconds > 0 ? 'Under a minute' : 'Not played yet'
  }

  if (minutes < 60) {
    return `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export const lengthOf = (text: TextProfile | undefined) => {
  if (text === undefined) {
    return undefined
  }

  const hours = text.readingMinutes / 60
  const size = hours < 2 ? 'Short' : hours < 8 ? 'Medium' : hours < 25 ? 'Long' : 'Very long'
  const reading = text.readingMinutes < 90 ? `${text.readingMinutes} min` : `${Math.round(hours)} h`

  return { size, reading }
}

export const formatUsd = (amount: number) =>
  amount < 0.01 ? '<$0.01' : `$${amount < 10 ? amount.toFixed(2) : Math.round(amount)}`

export const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000
      ? `${Math.round(tokens / 1_000)}K`
      : String(tokens)

export const limitValue = (limit: SpendLimit | undefined, priced: boolean) =>
  priced ? limit?.usd : limit?.tokens

export const formatLimit = (limit: SpendLimit | undefined, priced: boolean) => {
  const value = limitValue(limit, priced)

  if (value === undefined) {
    return undefined
  }

  return priced ? `$${value.toFixed(2)}` : `${formatTokens(value)} tokens`
}

export const withLimit = (
  limit: SpendLimit | undefined,
  priced: boolean,
  value: number | undefined,
): SpendLimit => {
  const { usd, tokens } = limit ?? {}

  const next = priced ? { usd: value, tokens } : { usd, tokens: value }

  return {
    ...(next.usd === undefined ? {} : { usd: next.usd }),
    ...(next.tokens === undefined ? {} : { tokens: next.tokens }),
  }
}
