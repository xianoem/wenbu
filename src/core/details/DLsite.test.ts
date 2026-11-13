import { gzipSync } from 'node:zlib'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import {
  DLsite,
  DLsitePacing,
  comingFrom,
  mergeRankings,
  keywordPath,
  parseGenres,
  parseListDate,
  parseProduct,
  parseReducedPage,
  parseRanking,
  parseSales,
  parseSearch,
  parseSearchPage,
  Work,
} from './DLsite'

const fixture = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return yield* fs.readFileString(path.join(import.meta.dirname, '__fixtures__', name))
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie)

type Reply = Response | 'offline'

const fakeHttp = (route: (url: string) => Reply | undefined, requests: Array<string>) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      requests.push(request.url)

      const reply = route(request.url)

      if (reply === 'offline') {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: 'offline' }),
          }),
        )
      }

      return Effect.succeed(
        HttpClientResponse.fromWeb(request, reply ?? new Response('missing', { status: 404 })),
      )
    }),
  )

const dlsite = (route: (url: string) => Reply | undefined, requests: Array<string> = []) =>
  DLsite.layer.pipe(Layer.provide(fakeHttp(route, requests)))

const instant = Layer.succeed(DLsitePacing)({ gap: 0, retry: 0 })

describe('DLsite', () => {
  it.effect('reads a work from its product JSON', () =>
    Effect.gen(function* () {
      const work = Option.getOrThrow(parseProduct(yield* fixture('dlsite-product.json')))

      assert.strictEqual(work.code, 'RJ01009019')
      assert.strictEqual(work.title, '鍛冶師ノ姉ガ堕チル時…')
      assert.strictEqual(work.circle, 'Crazy Nirin')
      assert.strictEqual(work.circleId, 'RG43595')
      assert.strictEqual(work.releasedOn, '2023-03-17')
      assert.strictEqual(work.workType, 'RPG')
      assert.strictEqual(work.ageRating, 'adult')
      assert.deepStrictEqual(work.genres[0], { id: 510, name: 'RPG Maker' })
      assert.deepStrictEqual(work.creators, ['クレイジー二厘', '中森南文里'])
      assert.isTrue(work.altTitles.includes('カジシノアネガオチルトキ'))

      assert.match(
        Option.getOrThrow(work.coverUrl),
        /^https:\/\/img\.dlsite\.jp\/.*RJ01009019_img_main\.jpg$/,
      )

      assert.isAbove(work.sampleUrls.length, 0)

      assert.strictEqual(
        work.url,
        'https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html',
      )

      assert.deepStrictEqual(work.price, Option.some(1320))
      assert.deepStrictEqual(work.fileSize, Option.some(445756797))
      assert.deepStrictEqual(work.roles[0], { role: 'Created by', names: ['クレイジー二厘'] })
      assert.deepStrictEqual(work.languages, ['Japanese'])
    }),
  )

  it.effect('reads a work DLsite shows outside Japan only as a reduced page', () =>
    Effect.gen(function* () {
      const work = Option.getOrThrow(
        parseReducedPage(yield* fixture('dlsite-reduced-page.html'), 'RJ01664771'),
      )

      assert.isTrue(work.restricted)
      assert.strictEqual(work.title, '百合姫学園のヘテロセクシャル～淫欲に堕ちるチン負け双姫～')
      assert.strictEqual(work.circle, '金色complex')
      assert.strictEqual(work.circleId, 'RG30557')
      assert.match(work.description, /^「穢れ無き百合カップルを/)
      assert.match(Option.getOrThrow(work.coverUrl), /RJ01664771_img_main\.jpg$/)
      assert.strictEqual(work.releasedOn, '')
      assert.deepStrictEqual(work.genres, [])
      assert.isTrue(Option.isNone(parseReducedPage('<html></html>', 'RJ01664771')))
    }),
  )

  it.effect('marks a work read from its product JSON as not restricted', () =>
    Effect.gen(function* () {
      assert.isFalse(
        Option.getOrThrow(parseProduct(yield* fixture('dlsite-product.json'))).restricted,
      )
    }),
  )

  it.effect('reads a work saved before the restricted flag as not restricted', () =>
    Effect.gen(function* () {
      const saved = yield* Schema.decodeUnknownEffect(Work)({
        code: 'RJ01009019',
        title: 'Title',
        altTitles: [],
        circle: 'Circle',
        circleId: 'RG1',
        creators: [],
        genres: [],
        releasedOn: '2023-03-17',
        workType: 'RPG',
        description: '',
        ageRating: 'adult',
        coverUrl: null,
        sampleUrls: [],
        url: 'https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html',
      })

      assert.isFalse(saved.restricted)
    }),
  )

  it.effect('reads a sale and the language editions', () =>
    Effect.gen(function* () {
      const body = (yield* fixture('dlsite-product.json'))
        .replace('"official_price": 1320', '"official_price": 1650')
        .replace('"discount_rate": null', '"discount_rate": 20')
        .replace('"campaign_end_date": null', '"campaign_end_date": "2026-11-21 00:00:00"')
        .replace(
          '"language_editions": []',
          '"language_editions": [{"workno": "RJ01009019", "lang": "JPN", "label": "日本語"}, {"workno": "RJ01740651", "lang": "ENG", "label": "英語"}]',
        )

      const work = Option.getOrThrow(parseProduct(body))

      assert.deepStrictEqual(work.officialPrice, Option.some(1650))
      assert.deepStrictEqual(work.discountRate, Option.some(20))
      assert.deepStrictEqual(work.saleEndsOn, Option.some('2026-11-21'))
      assert.deepStrictEqual(work.languages, ['Japanese', 'English'])
    }),
  )

  it('treats an empty answer as no such work, and junk as nothing read', () => {
    assert.isTrue(Option.isNone(parseProduct('[]')))
    assert.isTrue(Option.isNone(parseProduct('<html>')))
  })

  it.effect('reads the rating from the sales answer', () =>
    Effect.gen(function* () {
      const sales = parseSales(yield* fixture('dlsite-sales.json'), 'RJ01009019')

      assert.deepStrictEqual(sales.rating, Option.some(4.48))
      assert.deepStrictEqual(sales.ratingCount, Option.some(2757))
      assert.deepStrictEqual(sales.sold, Option.some(9014))
      assert.deepStrictEqual(sales.wishlist, Option.some(8575))
      assert.isTrue(Option.isNone(parseSales('{}', 'RJ01009019').rating))
    }),
  )

  it.effect('reads search results with their genres, cover and release date', () =>
    Effect.gen(function* () {
      const hits = Option.getOrThrow(parseSearch(yield* fixture('dlsite-search.json')))
      const [first] = hits

      assert.strictEqual(hits.length, 3)
      assert.match(first?.code ?? '', /^RJ\d+$/)
      assert.notStrictEqual(first?.title, '')
      assert.notStrictEqual(first?.circle, '')
      assert.match(first?.circleId ?? '', /^RG\d+$/)
      assert.isTrue(Option.isSome(first?.coverUrl ?? Option.none()))
      assert.isTrue(Option.isSome(first?.releasedOn ?? Option.none()))
      assert.isAbove(first?.genres.length ?? 0, 0)
      assert.isTrue(Option.isNone(first?.rank ?? Option.none()))
    }),
  )

  it.effect('reads the ranking in rank order', () =>
    Effect.gen(function* () {
      const hits = parseRanking(yield* fixture('dlsite-ranking.html'))

      assert.deepStrictEqual(
        hits.map((hit) => Option.getOrNull(hit.rank)),
        [1, 2, 3],
      )

      assert.strictEqual(hits[0]?.code, 'RJ01192934')
      assert.isAbove(hits[0]?.genres.length ?? 0, 0)
      assert.isTrue(Option.isSome(hits[0]?.price ?? Option.none()))
    }),
  )

  it.effect('merges the ranking of all games with the rankings of single types', () =>
    Effect.gen(function* () {
      const [first, second, third] = parseRanking(yield* fixture('dlsite-ranking.html'))

      if (first === undefined || second === undefined || third === undefined) {
        return assert.fail('The fixture has fewer than three works.')
      }

      const ranked = (code: string, rank: number) => ({ ...third, code, rank: Option.some(rank) })

      const merged = mergeRankings(
        [first, second],
        [
          [first, ranked('rpg-40', 40), ranked('rpg-70', 70)],
          [second, ranked('adv-5', 5), ranked('adv-55', 55)],
        ],
      )

      assert.deepStrictEqual(
        merged.map((hit) => hit.code),
        [first.code, second.code, 'adv-5', 'rpg-40', 'adv-55', 'rpg-70'],
      )
    }),
  )

  it.effect('reads announced games from a search, with their planned date and page', () =>
    Effect.gen(function* () {
      const first = Option.getOrThrow(parseSearchPage(yield* fixture('dlsite-announced-1.json')))
      const second = Option.getOrThrow(parseSearchPage(yield* fixture('dlsite-announced-2.json')))

      assert.isFalse(first.last)
      assert.isTrue(second.last)
      assert.strictEqual(first.hits.length, 2)
      assert.include(Option.getOrThrow(first.hits[0]?.expected ?? Option.none()), '2027年12月下旬')
      assert.isTrue(first.hits.every((hit) => hit.circle !== '' && Option.isSome(hit.coverUrl)))
    }),
  )

  it.effect('lists the announced works still to come, soonest first', () =>
    Effect.gen(function* () {
      const [template] = Option.getOrThrow(
        parseSearchPage(yield* fixture('dlsite-announced-1.json')),
      ).hits

      if (template === undefined) {
        return assert.fail('The fixture has no works.')
      }

      const planned = (code: string, expected: string) => ({
        ...template,
        code,
        expected: Option.some(expected),
      })

      const coming = comingFrom(
        [
          planned('undated', '未定 発売予定'),
          planned('late', '2027年01月下旬 発売予定'),
          planned('stale', '2018年10月下旬 発売予定'),
          planned('this-month', '2026年11月上旬 発売予定'),
          planned('day', '2026年11月14日 発売予定'),
          planned('last-month', '2026年10月31日 発売予定'),
          planned('early', '2027年01月上旬 発売予定'),
        ],
        '2026-11',
      )

      assert.deepStrictEqual(
        coming.map((hit) => hit.code),
        ['this-month', 'day', 'early', 'late', 'undated'],
      )
    }),
  )

  it.effect('reads the genre list', () =>
    Effect.gen(function* () {
      const genres = parseGenres(yield* fixture('dlsite-genres.html'))

      assert.deepStrictEqual(genres[0], { id: 509, name: '3D Works' })
      assert.strictEqual(genres.length, 4)
    }),
  )

  it('joins search words with + as DLsite reads them', () => {
    assert.strictEqual(keywordPath(' Happy  School '), 'Happy+School')
    assert.strictEqual(keywordPath('Hikari & Akari'), 'Hikari+%26+Akari')
    assert.strictEqual(keywordPath('堕ちる彼女'), encodeURIComponent('堕ちる彼女'))
  })

  it('reads list dates in English and Japanese', () => {
    assert.deepStrictEqual(
      parseListDate('Release date:&nbsp;Oct/24/2026'),
      Option.some('2026-10-24'),
    )

    assert.deepStrictEqual(parseListDate('2026年3月7日'), Option.some('2026-03-07'))
    assert.isTrue(Option.isNone(parseListDate('未定')))
  })

  it.effect('asks for compressed pages and reads them', () =>
    Effect.gen(function* () {
      const body = yield* fixture('dlsite-ranking.html')

      const hits = yield* DLsite.use((site) => site.ranking('week', [])).pipe(
        Effect.provide([
          dlsite(() => new Response(gzipSync(body), { headers: { 'content-encoding': 'gzip' } })),
          instant,
        ]),
      )

      assert.strictEqual(hits.length, 3)
    }),
  )

  it.effect('asks for a code once and reads the work', () =>
    Effect.gen(function* () {
      const body = yield* fixture('dlsite-product.json')
      const requests: Array<string> = []

      const work = yield* DLsite.use((site) => site.work('RJ01009019')).pipe(
        Effect.provide([dlsite(() => new Response(body), requests), instant]),
      )

      assert.strictEqual(Option.getOrThrow(work).code, 'RJ01009019')

      assert.deepStrictEqual(requests, [
        'https://www.dlsite.com/maniax/api/=/product.json?workno=RJ01009019&locale=en_US',
      ])
    }),
  )

  it.effect('retries a dropped connection twice, then gives up', () =>
    Effect.gen(function* () {
      const requests: Array<string> = []

      const result = yield* DLsite.use((site) => site.work('RJ01009019')).pipe(
        Effect.provide([dlsite(() => 'offline', requests), instant]),
        Effect.flip,
      )

      assert.strictEqual(result.reason, 'unreachable')
      assert.strictEqual(requests.length, 3)
    }),
  )

  it.effect('looks for the reduced page once, and never retries a page DLsite does not have', () =>
    Effect.gen(function* () {
      const requests: Array<string> = []

      const work = yield* DLsite.use((site) => site.work('RJ99999999')).pipe(
        Effect.provide([dlsite(() => undefined, requests), instant]),
      )

      assert.isTrue(Option.isNone(work))

      assert.deepStrictEqual(requests, [
        'https://www.dlsite.com/maniax/api/=/product.json?workno=RJ99999999&locale=en_US',
        'https://www.dlsite.com/maniax/work/=/product_id/RJ99999999.html',
      ])
    }),
  )

  it.effect('waits a second between requests', () =>
    Effect.gen(function* () {
      const requests: Array<string> = []
      const layer = dlsite(() => new Response('[]'), requests)

      yield* Effect.gen(function* () {
        const site = yield* DLsite

        const fiber = yield* Effect.forkChild(
          Effect.all(
            [site.sales('RJ01000001'), site.sales('RJ01000002'), site.sales('RJ01000003')],
            {
              concurrency: 'unbounded',
            },
          ),
        )

        yield* TestClock.adjust('10 millis')
        assert.strictEqual(requests.length, 1)

        yield* TestClock.adjust('1 second')
        assert.strictEqual(requests.length, 2)

        yield* TestClock.adjust('1 second')
        assert.strictEqual(requests.length, 3)

        yield* Fiber.join(fiber)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('reports a page it can no longer read as changed', () =>
    Effect.gen(function* () {
      const error = yield* DLsite.use((site) => site.ranking('week', [])).pipe(
        Effect.provide([dlsite(() => new Response('<html></html>')), instant]),
        Effect.flip,
      )

      assert.strictEqual(error.reason, 'changed')
    }),
  )
})
