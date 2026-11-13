import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Option, Path } from 'effect'
import {
  bookIdOf,
  builtInSites,
  detectSite,
  parseBook,
  parseChapterList,
  parseChapterText,
  parseSearch,
  siteFor,
  siteUrl,
} from './SitePages'

const fixtureOf = (site: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return yield* fs.readFileString(path.join(import.meta.dirname, '__fixtures__', site, name))
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie)

const fixture = (name: string) => fixtureOf('101kks', name)

const siteById = (id: string) => {
  const site = builtInSites.find((entry) => entry.id === id)

  if (site === undefined) {
    throw new Error(`No built-in site ${id}`)
  }

  return site
}

const kks = siteById('101kks')
const qidian = siteById('qidian')
const seventeen = siteById('17k')

describe('site addresses', () => {
  it('finds the site and book of a link', () => {
    const url = new URL('https://www.101kks.com/book/42674.html')

    expect(Option.map(siteFor(builtInSites, url), (site) => site.id)).toEqual(Option.some('101kks'))
    expect(bookIdOf(kks, url)).toEqual(Option.some('42674'))
    expect(bookIdOf(kks, new URL('https://101kks.com/txt/42674/1.html'))).toEqual(Option.none())
  })

  it('builds a site address from a template', () => {
    expect(siteUrl(kks, kks.selectors.book, { id: '42674' })).toBe(
      'https://101kks.com/book/42674.html',
    )

    expect(siteUrl(kks, '/search/{query}/1.html', { query: '大荒' })).toBe(
      'https://101kks.com/search/%E5%A4%A7%E8%8D%92/1.html',
    )
  })
})

describe('101kks pages', () => {
  it.effect('reads a book page', () =>
    Effect.gen(function* () {
      expect(parseBook(yield* fixture('book.html'))).toEqual({
        title: '劍燭大荒',
        author: '愛潛水的烏賊',
        coverUrl: 'https://101kks.com/files/article/image/42/42674/42674s.jpg',
        synopsis: '一個少年在燭火裡醒來，發現這個世界的《山海經》與他記得的不一樣。',
        tags: ['玄幻奇幻'],
        status: 'ongoing',
        latestChapter: '第六十四章 神乎其技（雙倍最後半天求月票）',
        url: 'https://101kks.com/book/42674.html',
      })
    }),
  )

  it.effect('reads the chapter list with clean titles and extras marked', () =>
    Effect.gen(function* () {
      const chapters = parseChapterList(kks, yield* fixture('chapters.html'))

      expect(chapters).toHaveLength(8)

      expect(chapters[0]).toEqual({
        title: '歡迎收藏',
        url: 'https://101kks.com/txt/42674/14648230.html',
        extra: true,
        locked: false,
        releasedAt: null,
      })

      expect(chapters.slice(3).map((chapter) => chapter.title)).toEqual([
        '第三章 丁家',
        '第四章 隔簾夜話',
        '第六十二章 小院清晨',
        '第六十三章 名與實',
        '第六十四章 神乎其技',
      ])
    }),
  )

  it.effect('reads a chapter without the ads and moves the author note out', () =>
    Effect.gen(function* () {
      expect(parseChapterText(kks, yield* fixture('chapter.html'))).toEqual({
        paragraphs: [
          '丁松言睜開眼時，窗外的天色還未亮透。',
          '他記得自己最後看見的是一盞燭火，火光裡盤著一條龍。',
          '「二哥，你醒了？」門邊探進一張少女的臉。',
          '「你是……」',
          '「我是輕煙呀。」',
        ],
        note: 'PS：幾分鐘後還有一章。',
      })
    }),
  )

  it.effect('reads search results', () =>
    Effect.gen(function* () {
      const results = parseSearch(kks, yield* fixture('search.html'))

      expect(results.map((result) => result.title)).toEqual(['挽弓，搭箭，射萬神！', '劍燭大荒'])

      expect(results[1]).toEqual({
        url: 'https://101kks.com/book/42674.html',
        title: '劍燭大荒',
        author: null,
        coverUrl: 'https://101kks.com/files/article/image/42/42674/42674s.jpg',
        latestChapter: '第六十四章 神乎其技',
      })
    }),
  )
})

describe('detectSite', () => {
  it.effect('works out the 101kks entry from its pages', () =>
    Effect.gen(function* () {
      const detected = detectSite(new URL('https://101kks.com/book/42674.html'), {
        book: yield* fixture('book.html'),
        chapterList: {
          url: 'https://101kks.com/book/42674/index.html',
          html: yield* fixture('chapters.html'),
        },
        chapter: yield* fixture('chapter.html'),
      })

      expect(detected.selectors.book).toBe('/book/{id}.html')
      expect(parseChapterList(detected, yield* fixture('chapters.html'))).toHaveLength(8)
      expect(parseChapterText(detected, yield* fixture('chapter.html')).paragraphs).toHaveLength(5)
    }),
  )
})

describe('Qidian pages', () => {
  it.effect('reads the catalog with paid chapters and release dates', () =>
    Effect.gen(function* () {
      const chapters = parseChapterList(qidian, yield* fixtureOf('qidian', 'book.html'))

      expect(chapters.map((chapter) => [chapter.title, chapter.locked])).toEqual([
        ['欢迎收藏', false],
        ['第一章 晓梦', false],
        ['第二章 木鸢', false],
        ['第六十五章 名与实', true],
        ['第六十六章 神乎其技', true],
        ['第一百零四章 坦诚相告', true],
      ])

      expect(chapters[1]?.releasedAt).toBe('2026-05-30 13:10:39')
      expect(chapters[1]?.url).toBe('https://www.qidian.com/chapter/1048862481/907850545/')
    }),
  )

  it.effect('reads a free chapter and search results', () =>
    Effect.gen(function* () {
      expect(
        parseChapterText(qidian, yield* fixtureOf('qidian', 'chapter.html')).paragraphs,
      ).toEqual([
        '丁松言睁开眼时，窗外的天色还未亮透。',
        '他记得自己最后看见的是一盏烛火。',
        '“二哥，你醒了？”',
      ])

      const results = parseSearch(qidian, yield* fixtureOf('qidian', 'search.html'))

      expect(results[0]).toEqual({
        url: 'https://www.qidian.com/book/1048862481/',
        title: '剑烛大荒',
        author: '爱潜水的乌贼',
        coverUrl: 'https://bookcover.yuewen.com/qdbimg/349573/1048862481/150.webp',
        latestChapter: '第一百零四章 坦诚相告',
      })

      expect(results).toHaveLength(2)
    }),
  )
})

describe('17k pages', () => {
  it.effect('reads a book page without og:novel tags', () =>
    Effect.gen(function* () {
      expect(parseBook(yield* fixtureOf('17k', 'book.html'))).toMatchObject({
        title: '混混小子修仙记',
        author: '笑笑星儿',
        synopsis: '一个混混少年踏上修仙路。',
      })
    }),
  )

  it.effect('reads the list with VIP chapters, a chapter, and search results', () =>
    Effect.gen(function* () {
      const chapters = parseChapterList(seventeen, yield* fixtureOf('17k', 'list.html'))

      expect(chapters.map((chapter) => chapter.locked)).toEqual([false, false, true])
      expect(chapters[2]?.title).toBe('第99章 花罗刹的恐怖')
      expect(chapters[0]?.releasedAt).toBe('2010-11-15 10:36:00')

      expect(
        parseChapterText(seventeen, yield* fixtureOf('17k', 'chapter.html'), '第1章 美女的尴尬')
          .paragraphs,
      ).toEqual(['清晨的街道上没什么人。', '少年把手插进口袋里，慢慢走着。'])

      const results = parseSearch(seventeen, yield* fixtureOf('17k', 'search.html'))

      expect(results).toEqual([
        {
          url: 'https://www.17k.com/book/84954.html',
          title: '混混小子修仙记',
          author: '笑笑星儿',
          coverUrl: 'https://cdn.static.17k.com/book/189x272/54/49/84954.jpg-189x272',
          latestChapter: '第865章 大结局',
        },
      ])
    }),
  )
})
