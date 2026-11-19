import type { GalleryTile, GalleryVersion } from '#contract/Galleries'
import type { Game } from '#contract/Library'
import type { NovelSummary } from '#contract/Novels'
import { plural, shownPages } from '../galleries/galleries'

type PlayedGame = Pick<Game, 'id' | 'title' | 'lastPlayedAt'>

export type JumpCard =
  | { readonly kind: 'game'; readonly id: string; readonly note: string; readonly game: PlayedGame }
  | {
      readonly kind: 'novel'
      readonly id: string
      readonly note: string
      readonly novel: NovelSummary
      readonly chapter: number
    }
  | {
      readonly kind: 'gallery'
      readonly id: string
      readonly note: string
      readonly gallery: GalleryTile
      readonly page: number
      readonly version: GalleryVersion
    }

const latest = <A>(items: ReadonlyArray<A>, at: (item: A) => string | undefined) =>
  items
    .filter((item) => at(item) !== undefined)
    .toSorted((left, right) => (at(right) ?? '').localeCompare(at(left) ?? ''))[0]

const gameCard = (game: PlayedGame): JumpCard => ({ kind: 'game', id: game.id, note: 'Game', game })

const novelCard = (novel: NovelSummary): JumpCard => {
  const chapter = novel.reading?.chapter ?? 1

  return {
    kind: 'novel',
    id: novel.id,
    note:
      novel.newChapters > 0
        ? plural(novel.newChapters, 'new chapter', 'new chapters')
        : `Chapter ${chapter}`,
    novel,
    chapter,
  }
}

const galleryCard = (gallery: GalleryTile): JumpCard => {
  const page = gallery.reading?.page ?? 0

  return {
    kind: 'gallery',
    id: gallery.folder,
    note: `Page ${page + 1} of ${shownPages(gallery)}`,
    gallery,
    page,
    version: gallery.reading?.version ?? 'original',
  }
}

export const jumpBackIn = (
  games: ReadonlyArray<PlayedGame>,
  novels: ReadonlyArray<NovelSummary>,
  galleries: ReadonlyArray<GalleryTile>,
): ReadonlyArray<JumpCard> => {
  const game = latest(games, (candidate) => candidate.lastPlayedAt)
  const novel = latest(novels, (candidate) => candidate.reading?.readAt)
  const gallery = latest(galleries, (candidate) => candidate.reading?.readAt)

  return [
    ...(game === undefined ? [] : [gameCard(game)]),
    ...(novel === undefined ? [] : [novelCard(novel)]),
    ...(gallery === undefined ? [] : [galleryCard(gallery)]),
  ]
}
