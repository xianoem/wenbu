import { assert, describe, it } from '@effect/vitest'
import type { GalleryTile } from '#contract/Galleries'
import type { NovelSummary } from '#contract/Novels'
import { jumpBackIn } from './jumpBackIn'

const game = (id: string, lastPlayedAt?: string) => ({
  id,
  title: `Game ${id}`,
  ...(lastPlayedAt === undefined ? {} : { lastPlayedAt }),
})

const novel = (id: string, readAt: string | null, newChapters = 0): NovelSummary => ({
  id,
  title: `原題 ${id}`,
  titleTranslated: `Novel ${id}`,
  author: null,
  coverUrl: null,
  language: 'zh',
  sourceLabel: 'Qidian',
  chapters: 220,
  newChapters,
  reading: readAt === null ? null : { chapter: 214, paragraph: 3, readAt },
  readingTitle: null,
  addedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

const gallery: GalleryTile = {
  kind: 'gallery',
  folder: 'D:\\Galleries\\Afterglow',
  title: 'Afterglow on the Pier',
  artists: [],
  source: null,
  originalPages: 41,
  translatedPages: 0,
  cover: null,
  coverVersion: 0,
  addedAt: '2026-11-01T00:00:00.000Z',
  reading: {
    page: 11,
    version: 'original',
    direction: 'rtl',
    shiftSpread: false,
    layout: 'single',
    readAt: '2026-11-18T10:00:00.000Z',
  },
}

describe('jumpBackIn', () => {
  it('picks the last game played, novel read and gallery opened', () => {
    const cards = jumpBackIn(
      [game('a', '2026-11-10T00:00:00.000Z'), game('b', '2026-11-18T00:00:00.000Z'), game('c')],
      [novel('x', '2026-11-01T00:00:00.000Z'), novel('y', '2026-11-17T00:00:00.000Z')],
      [gallery],
    )

    assert.deepStrictEqual(
      cards.map((card) => card.id),
      ['b', 'y', gallery.folder],
    )
  })

  it('says where each one left off', () => {
    const cards = jumpBackIn(
      [game('a', '2026-11-10T00:00:00.000Z')],
      [novel('x', '2026-11-01T00:00:00.000Z', 3)],
      [gallery],
    )

    assert.deepStrictEqual(
      cards.map((card) => card.note),
      ['Game', '3 new chapters', 'Page 12 of 41'],
    )
  })

  it('names the chapter when nothing new came out', () => {
    const [card] = jumpBackIn([], [novel('x', '2026-11-01T00:00:00.000Z')], [])

    assert.strictEqual(card?.note, 'Chapter 214')
  })

  it('leaves out games never played and novels never opened', () => {
    assert.deepStrictEqual(jumpBackIn([game('c')], [novel('x', null)], []), [])
  })
})
