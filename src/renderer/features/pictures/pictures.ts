import { Effect, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import { Core } from '#lib/rpc'

export const picturesKeys = (gameId: string) => [`pictures:${gameId}`]

export const styleKeys = (gameId: string) => [`picture-style:${gameId}`]

export const picturesSummaryAtom = Atom.family((gameId: string) =>
  Core.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Core

        return client('watchPictures', { gameId })
      }),
    ),
  ),
)

export const picturesAtom = Atom.family((gameId: string) =>
  Core.query('listPictures', { gameId }, { reactivityKeys: picturesKeys(gameId) }),
)

export const pictureStyleAtom = Atom.family((gameId: string) =>
  Core.query('getPictureStyle', { gameId }, { reactivityKeys: styleKeys(gameId) }),
)

export const findPictureTextAtom = Core.mutation('findPictureText')

export const cancelPictureScanAtom = Core.mutation('cancelPictureScan')

export const translatePicturesAtom = Core.mutation('translatePictures')

export const savePictureStyleAtom = Core.mutation('savePictureStyle')
