import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import { Effect, Schema, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { InGameTextFilter } from '#contract/InGameText'
import { Core } from '#lib/rpc'

export const inGameTextKeys = ['in-game-texts']

export const settingsKeys = (gameId: string) => [`in-game-text-settings:${gameId}`]

export const inGameTextSettingsAtom = Atom.family((gameId: string) =>
  Core.query('getInGameTextSettings', { gameId }, { reactivityKeys: settingsKeys(gameId) }),
)

export const saveInGameTextSettingsAtom = Core.mutation('saveInGameTextSettings')

export const inGameTextSummaryAtom = Atom.family((gameId: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('watchInGameTextSummary', { gameId })
      }),
    ),
  ),
)

const isFilter = Schema.is(InGameTextFilter)

const SEPARATOR = '\u0000'

export const listKey = (gameId: string, filter: InGameTextFilter, search: string) =>
  [gameId, filter, search].join(SEPARATOR)

export const inGameTextsAtom = Atom.family((key: string) => {
  const [gameId = '', filter = 'all', ...search] = key.split(SEPARATOR)

  return Core.query(
    'listInGameTexts',
    { gameId, filter: isFilter(filter) ? filter : 'all', search: search.join(SEPARATOR) },
    { reactivityKeys: inGameTextKeys },
  )
})

export const saveInGameTextAtom = Core.mutation('saveInGameText')

export const setInGameTextLockedAtom = Core.mutation('setInGameTextLocked')

export const shortenInGameTextAtom = Core.mutation('shortenInGameText')

export const scanGameImagesAtom = Core.mutation('scanGameImages')

export const cancelImageScanAtom = Core.mutation('cancelImageScan')

const localStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const answeredHintsAtom = Atom.kvs({
  runtime: localStorageRuntime,
  key: 'in-game-text-hints',
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
})
