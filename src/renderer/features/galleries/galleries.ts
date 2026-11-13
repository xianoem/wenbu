import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { DateTime, Effect, Stream } from 'effect'
import { type Atom, Reactivity } from 'effect/reactivity'
import { useEffect } from 'react'
import type { GalleryTile, ListEntries } from '#contract/Galleries'
import { Core } from '#lib/rpc'

export const galleriesKeys = ['galleries']

export const listingAtom = (request: ListEntries) =>
  Core.query('listGalleryEntries', request, { reactivityKeys: galleriesKeys })

export const continueReadingAtom = Core.query('continueReadingGalleries', undefined, {
  reactivityKeys: galleriesKeys,
})

export const galleryAtom = (folder: string) =>
  Core.query('openGallery', { folder }, { reactivityKeys: galleriesKeys })

export const rootsAtom = Core.query('galleryRoots', undefined, { reactivityKeys: galleriesKeys })

export const addRootAtom = Core.mutation('addGalleryRoot')

export const removeRootAtom = Core.mutation('removeGalleryRoot')

export const saveReadingAtom = Core.mutation('saveGalleryReading')

export const indexChangesAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchGalleryIndex', undefined).pipe(
        Stream.tap(() => Reactivity.invalidate(galleriesKeys)),
      )
    }),
  ),
)

export function useFreshAtom<A>(atom: Atom.Atom<A>) {
  const value = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)

  useEffect(() => refresh(), [refresh])

  return value
}

export const nameOf = (folder: string) =>
  folder.slice(Math.max(folder.lastIndexOf('\\'), folder.lastIndexOf('/')) + 1)

export const shownPages = (gallery: Pick<GalleryTile, 'originalPages' | 'translatedPages'>) =>
  gallery.translatedPages > 0 ? gallery.translatedPages : gallery.originalPages

export const versionBadge = (gallery: Pick<GalleryTile, 'originalPages' | 'translatedPages'>) => {
  if (gallery.translatedPages === 0) {
    return undefined
  }

  return gallery.originalPages > 0 ? 'JP · EN' : 'EN'
}

export const progressOf = (gallery: GalleryTile) => {
  if (gallery.reading === null) {
    return 0
  }

  const pages =
    gallery.reading.version === 'translated' ? gallery.translatedPages : gallery.originalPages

  return pages === 0 ? 0 : Math.min(1, (gallery.reading.page + 1) / pages)
}

const thisYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

const otherYear = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export const monthDay = (iso: string) => thisYear.format(DateTime.toDate(DateTime.makeUnsafe(iso)))

export const shortDate = (iso: string) => {
  const date = DateTime.makeUnsafe(iso)

  const sameYear =
    DateTime.getPartUtc(date, 'year') === DateTime.getPartUtc(DateTime.nowUnsafe(), 'year')

  return (sameYear ? thisYear : otherYear).format(DateTime.toDate(date))
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`
