import { Effect, Schema, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { LineFilter, type TranslationLine } from '#contract/GameTranslation'
import { Core } from '#lib/rpc'

export const lineKeys = ['translation-lines']

const isFilter = Schema.is(LineFilter)

const SEPARATOR = '\u0000'

export const linesKey = (gameId: string, filter: LineFilter, query: string, limit: number) =>
  [gameId, filter, String(limit), query].join(SEPARATOR)

export const translationLinesAtom = Atom.family((key: string) => {
  const [gameId = '', filter = 'all', limit = '300', ...query] = key.split(SEPARATOR)

  return Core.query(
    'listTranslationLines',
    {
      gameId,
      filter: isFilter(filter) ? filter : 'all',
      query: query.join(SEPARATOR),
      limit: Number(limit),
    },
    { reactivityKeys: lineKeys },
  )
})

export const translationLineAtom = Atom.family((key: string) => {
  const [gameId = '', entryId = ''] = key.split(SEPARATOR)

  return Core.query('getTranslationLine', { gameId, entryId }, { reactivityKeys: lineKeys })
})

export const lineKey = (gameId: string, entryId: string) => [gameId, entryId].join(SEPARATOR)

export const saveTranslationLineAtom = Core.mutation('saveTranslationLine')

export const setTranslationLineLockedAtom = Core.mutation('setTranslationLineLocked')

export const retranslateLineAtom = Core.mutation('retranslateLine')

export const shortenTranslationLineAtom = Core.mutation('shortenTranslationLine')

export const applyTranslationEditsAtom = Core.mutation('applyTranslationEdits')

export const restoreTranslatedFilesAtom = Core.mutation('restoreTranslatedFiles')

export type LineState = 'model' | 'edited' | 'locked' | 'missing'

export const stateOf = (line: TranslationLine): LineState => {
  if (line.translatedText === undefined) {
    return 'missing'
  }

  if (line.locked) {
    return 'locked'
  }

  return line.origin === 'model' ? 'model' : 'edited'
}

export const placeOf = (line: Pick<TranslationLine, 'context'>) =>
  line.context.split(' -> ').join(' · ')

export const gameUpdateAtom = Atom.family((gameId: string) =>
  Core.query('getGameUpdate', { gameId }, { reactivityKeys: [...lineKeys, 'translation'] }),
)

export const sourceChangeListAtom = Atom.family((gameId: string) =>
  Core.query('listSourceChanges', { gameId }, { reactivityKeys: lineKeys }),
)

export const setSourceChangeActionAtom = Core.mutation('setSourceChangeAction')

export const inspectGameUpdateAtom = Core.mutation('inspectGameUpdate')

export const installGameUpdateAtom = Core.mutation('installGameUpdate')

export const undoGameUpdateAtom = Core.mutation('undoGameUpdate')

export const exportTranslationAtom = Core.mutation('exportTranslation')

export const installProgressAtom = Atom.family((gameId: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('watchGameUpdateInstall', { gameId })
      }),
    ),
  ),
)
