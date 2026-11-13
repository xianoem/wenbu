import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, FileSystem, Layer, Path, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { defaultDetailsSettings, DetailsRpc, type ListedWork } from '#contract/Details'
import { Games } from '../library/Games'
import { LlmClient } from '../llm/LlmClient'
import * as Database from '../platform/Database'
import { DetailsRpcLive } from './Details'
import { DetailsStore } from './DetailsStore'
import { DLsite, DLsitePacing } from './DLsite'

const fixtureText = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  return yield* fs.readFileString(path.join(import.meta.dirname, '__fixtures__', name))
})

interface Site {
  readonly reduced: string
  japan: boolean
  readonly product: string
  readonly sales: string
  readonly search: string
  readonly ranking: string
  readonly announced: ReadonlyArray<string>
  readonly genres: string
}

const route = (site: Site, requests: Array<string>) => (url: string) => {
  requests.push(url)

  if (url.includes('/genre/list')) {
    return new Response(site.genres)
  }

  if (url.includes('product.json?workno=RJ01009019')) {
    return new Response(site.product)
  }

  if (url.includes('product.json?workno=RJ01664771') && site.japan) {
    return new Response(site.product.replaceAll('RJ01009019', 'RJ01664771'))
  }

  if (url.includes('/work/=/product_id/RJ01664771.html')) {
    return new Response(site.reduced)
  }

  if (url.includes('product.json?workno=RJ309598')) {
    return new Response(
      site.product
        .replaceAll('RJ01009019', 'RJ309598')
        .replace('鍛冶師ノ姉ガ堕チル時…"', 'The Shimmering Horizon and Cursed Blacksmith"'),
    )
  }

  if (url.includes('product.json')) {
    return new Response('[]')
  }

  if (url.includes('/product/info/ajax')) {
    return new Response(site.sales)
  }

  if (url.includes('/ana_flg/on/')) {
    return new Response(site.announced[url.includes('/page/1/') ? 0 : 1])
  }

  if (url.includes('/fsr/ajax/')) {
    return new Response(site.search)
  }

  if (url.includes('/ranking/')) {
    return new Response(site.ranking)
  }

  if (url.startsWith('https://img.dlsite.jp/')) {
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]))
  }

  return new Response('missing', { status: 404 })
}

const LlmFake = Layer.succeed(LlmClient)({
  model: () => Effect.die('Not used here.'),
  describe: () => Effect.succeed({ presetName: 'Fast EN', modelName: 'Fake' }),
  complete: () =>
    Effect.succeed({
      text: '```json\n{"title": "When the Blacksmith Sister Falls", "description": "An RPG."}\n```',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: undefined,
    }),
})

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-details-' })
  const requests: Array<string> = []
  const cookies = new Map<string, string>()

  const site: Site = {
    reduced: yield* fixtureText('dlsite-reduced-page.html'),
    japan: false,
    product: yield* fixtureText('dlsite-product.json'),
    sales: yield* fixtureText('dlsite-sales.json'),
    search: yield* fixtureText('dlsite-search.json'),
    ranking: yield* fixtureText('dlsite-ranking.html'),
    announced: [
      yield* fixtureText('dlsite-announced-1.json'),
      yield* fixtureText('dlsite-announced-2.json'),
    ],
    genres: yield* fixtureText('dlsite-genres.html'),
  }

  const http = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      const reply = route(site, requests)(request.url)

      cookies.set(request.url, request.headers['cookie'] ?? '')

      return Effect.succeed(HttpClientResponse.fromWeb(request, reply))
    }),
  )

  const layer = DetailsRpcLive.pipe(
    Layer.provideMerge(Layer.mergeAll(DetailsStore.layer, Games.layer, LlmFake)),
    Layer.provide(DLsite.layer.pipe(Layer.provide(http))),
    Layer.provide(Layer.succeed(DLsitePacing)({ gap: 0, retry: 0 })),
    Layer.provide(KeyValueStore.layerMemory),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ WENBU_DATA_DIR: root }))),
  )

  return { root, requests, cookies, layer, site }
})

const addGame = Effect.fnUntraced(function* (id: string, folderPath: string) {
  const sql = yield* SqlClient.SqlClient
  const fs = yield* FileSystem.FileSystem

  yield* fs.makeDirectory(folderPath, { recursive: true })

  yield* sql`INSERT INTO games ${sql.insert({
    id,
    title: id,
    folder_path: folderPath,
    folder_key: folderPath.toLowerCase(),
    executable_path: `${folderPath}/Game.exe`,
    engine: 'rpg-maker-mv',
    size_bytes: 1,
    translation: 'original',
    added_at: '2026-09-01T00:00:00.000Z',
  })}`
})

const client = RpcTest.makeClient(DetailsRpc)

const has = (work: ListedWork, tagId: number) => work.genres.some((genre) => genre.id === tagId)

const runToEnd = Effect.gen(function* () {
  const rpc = yield* client

  yield* rpc.startFinding()

  yield* rpc.watchFinding().pipe(
    Stream.filter((progress) => !progress.running && progress.total > 0),
    Stream.take(1),
    Stream.runDrain,
  )
})

const inSetup = <A, E, R>(
  test: (context: {
    readonly root: string
    readonly requests: Array<string>
    readonly cookies: ReadonlyMap<string, string>
    readonly site: Site
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { root, requests, cookies, layer, site } = yield* setup

    return yield* test({ root, requests, cookies, site }).pipe(Effect.provide(layer))
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe('Details', () => {
  it.effect('links a game by the code in a folder inside it, and caches its cover', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const fs = yield* FileSystem.FileSystem
        const rpc = yield* client
        const folder = path.join(root, 'Games', 'Blacksmith')

        yield* addGame('smith', folder)
        yield* fs.makeDirectory(path.join(folder, '230317-G01009019'))
        yield* runToEnd

        const details = yield* rpc.gameDetails({ gameId: 'smith' })

        assert.strictEqual(details?.link.code, 'RJ01009019')
        assert.strictEqual(details?.link.linkedBy, 'code')
        assert.strictEqual(details?.link.confidence, 100)
        assert.strictEqual(details?.circle, 'Crazy Nirin')
        assert.strictEqual(details?.rating, 4.48)
        assert.isTrue(yield* fs.exists(details?.cover ?? ''))

        const [summary] = yield* rpc.gameSummaries()

        assert.strictEqual(summary?.gameId, 'smith')
        assert.strictEqual(summary?.cover, details?.cover)
      }),
    ),
  )

  it.effect('links a search result confident enough, and leaves the rest for review', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        yield* addGame(
          'horizon',
          path.join(root, 'Games', 'The_Shimmering_Horizon_and_Cursed_Blacksmith_v1.2'),
        )

        yield* addGame('unknown', path.join(root, 'Games', 'Completely Unrelated Title'))
        yield* runToEnd

        const horizon = yield* rpc.gameDetails({ gameId: 'horizon' })

        assert.strictEqual(horizon?.link.code, 'RJ309598')
        assert.strictEqual(horizon?.link.linkedBy, 'search')
        assert.isAtLeast(horizon?.link.confidence ?? 0, 90)

        const review = yield* rpc.reviewList()

        assert.deepStrictEqual(
          review.map((item) => [item.gameId, item.state]),
          [['unknown', 'no-match']],
        )
      }),
    ),
  )

  it.effect('links a pasted link, keeps edited fields through a refresh, and unlocks them', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        yield* addGame('smith', path.join(root, 'Games', 'Smith'))

        const linked = yield* rpc.linkWork({
          gameId: 'smith',
          input: 'https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html',
        })

        assert.strictEqual(linked.link.linkedBy, 'user')

        yield* rpc.editDetails({
          gameId: 'smith',
          edits: [{ field: 'title', value: ' Blacksmith Sister ' }],
        })

        const refreshed = yield* rpc.refreshDetails({ gameId: 'smith' })

        assert.strictEqual(refreshed.title, 'Blacksmith Sister')
        assert.deepStrictEqual(refreshed.locked, ['title'])

        const unlocked = yield* rpc.unlockDetails({ gameId: 'smith', field: 'title' })

        assert.strictEqual(unlocked.title, '鍛冶師ノ姉ガ堕チル時…')
      }),
    ),
  )

  it.effect('refuses input without a code, and a code DLsite does not sell', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        yield* addGame('smith', path.join(root, 'Games', 'Smith'))

        const invalid = yield* Effect.flip(rpc.linkWork({ gameId: 'smith', input: 'blacksmith' }))
        const missing = yield* Effect.flip(rpc.linkWork({ gameId: 'smith', input: 'RJ01754034' }))

        assert.strictEqual(invalid.reason, 'invalid')
        assert.strictEqual(missing.reason, 'not-found')
        assert.isNull(yield* rpc.gameDetails({ gameId: 'smith' }))
      }),
    ),
  )

  it.effect('skips a game marked No details in later runs', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        yield* addGame(
          'skip',
          path.join(root, 'Games', 'The Shimmering Horizon and Cursed Blacksmith'),
        )

        yield* rpc.markNoDetails({ gameId: 'skip' })
        yield* runToEnd

        assert.isNull(yield* rpc.gameDetails({ gameId: 'skip' }))
        assert.deepStrictEqual(yield* rpc.reviewList(), [])
      }),
    ),
  )

  it.effect('lists only the ranked works with every chosen tag, fetching it once an hour', () =>
    inSetup(({ requests }) =>
      Effect.gen(function* () {
        const rpc = yield* client

        const all = yield* rpc.dlsiteList({ list: 'top', period: 'week' })
        const [first] = all.works

        assert.strictEqual(all.works.length, 3)
        assert.strictEqual(first?.rank, 1)

        const tags = first?.genres ?? []
        const rare = tags.find((tag) => all.works.some((work) => !has(work, tag.id)))

        if (rare === undefined) {
          return assert.fail('Every ranked work has the same tags.')
        }

        yield* rpc.setFilter({ target: { tag: rare }, chosen: true })

        const one = yield* rpc.dlsiteList({ list: 'top', period: 'week' })

        assert.isAbove(one.works.length, 0)
        assert.isBelow(one.works.length, all.works.length)
        assert.isTrue(one.works.every((work) => has(work, rare.id)))

        assert.deepStrictEqual(
          one.works.map((work) => work.rank),
          one.works.map((_, at) => at + 1),
        )

        const ranked = requests.filter((url) => url.includes('/ranking/'))

        assert.strictEqual(ranked.length, 13)
        assert.isTrue(ranked.some((url) => url.endsWith('?category=game&sub%5B0%5D=RPG')))

        yield* rpc.setFilter({
          target: { tag: { id: 999_999, name: 'No such tag' } },
          chosen: true,
        })

        assert.deepStrictEqual((yield* rpc.dlsiteList({ list: 'top', period: 'week' })).works, [])

        yield* rpc.setFilter({
          target: { tag: { id: 999_999, name: 'No such tag' } },
          chosen: false,
        })

        yield* rpc.setFilter({ target: { tag: rare }, chosen: false })

        assert.deepStrictEqual((yield* rpc.dlsiteFilters()).tags, [])

        assert.strictEqual(
          (yield* rpc.dlsiteList({ list: 'top', period: 'week' })).works.length,
          all.works.length,
        )

        assert.strictEqual(requests.filter((url) => url.includes('/ranking/')).length, 13)
      }),
    ),
  )

  it.effect('asks DLsite to rank the chosen game types alone', () =>
    inSetup(({ requests }) =>
      Effect.gen(function* () {
        const rpc = yield* client

        yield* rpc.setFilter({ target: { gameType: 'RPG' }, chosen: true })
        yield* rpc.setFilter({ target: { gameType: 'ADV' }, chosen: true })
        yield* rpc.dlsiteList({ list: 'top', period: 'month' })

        assert.deepStrictEqual(
          requests.filter((url) => url.includes('/ranking/')),
          [
            'https://www.dlsite.com/maniax/ranking/month?category=game&sub%5B0%5D=ADV&sub%5B1%5D=RPG',
          ],
        )
      }),
    ),
  )

  it.effect('lists every announced game, soonest first, reading each page of them', () =>
    inSetup(({ requests }) =>
      Effect.gen(function* () {
        const rpc = yield* client
        const upcoming = yield* rpc.dlsiteList({ list: 'upcoming', period: 'week' })

        assert.deepStrictEqual(
          upcoming.works.map((work) => work.code),
          ['RJ027341', 'RJ01660603', 'RJ01635389', 'RJ376847'],
        )

        const asked = requests.filter((url) => url.includes('/ana_flg/on/'))

        assert.strictEqual(asked.length, 3)
        assert.include(asked[0], 'work_type_category%5B0%5D/game/ana_flg/on/order/release_d/')
        assert.isTrue(asked.some((url) => url.includes('/page/2/')))
      }),
    ),
  )

  it.effect('asks the Japanese DLsite for new works with every chosen tag and game type', () =>
    inSetup(({ requests, cookies }) =>
      Effect.gen(function* () {
        const rpc = yield* client

        yield* rpc.setFilter({ target: { gameType: 'RPG' }, chosen: true })
        yield* rpc.setFilter({ target: { gameType: 'ADV' }, chosen: true })
        yield* rpc.setFilter({ target: { tag: { id: 48, name: 'Netorare' } }, chosen: true })
        yield* rpc.setFilter({ target: { tag: { id: 510, name: 'RPG Maker' } }, chosen: true })

        assert.deepStrictEqual(yield* rpc.dlsiteFilters(), {
          tags: [
            { id: 48, name: 'Netorare' },
            { id: 510, name: 'RPG Maker' },
          ],
          gameTypes: ['ADV', 'RPG'],
        })

        const listed = yield* rpc.dlsiteList({ list: 'new', period: 'week' })
        const asked = requests.findLast((url) => url.includes('/fsr/ajax/')) ?? ''

        assert.include(asked, 'work_type%5B0%5D/ADV/work_type%5B1%5D/RPG/')
        assert.notInclude(asked, 'work_type_category')
        assert.include(asked, 'genre%5B0%5D/048/genre%5B1%5D/510/genre_and_or/and/')
        assert.include(cookies.get(asked) ?? '', 'locale=ja_JP')

        assert.isTrue(
          listed.works.every(
            (work) => has(work, 48) && has(work, 510) && ['ADV', 'RPG'].includes(work.workType),
          ),
        )

        yield* rpc.dlsiteList({ list: 'top', period: 'week' })
        yield* rpc.dlsiteList({ list: 'upcoming', period: 'week' })

        for (const part of ['/ranking/', '/ana_flg/on/']) {
          const url = requests.findLast((found) => found.includes(part)) ?? ''

          assert.include(cookies.get(url) ?? '', 'locale=ja_JP')
        }
      }),
    ),
  )

  it.effect('translates the title and description with the chosen preset', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        yield* addGame('smith', path.join(root, 'Games', 'Smith'))
        yield* rpc.linkWork({ gameId: 'smith', input: 'RJ01009019' })
        yield* rpc.saveDetailsSettings({ ...defaultDetailsSettings, translatePresetId: 'fast' })

        const translated = yield* rpc.translateDetails({ gameId: 'smith' })

        assert.strictEqual(translated.translatedTitle, 'When the Blacksmith Sister Falls')
        assert.strictEqual(translated.translatedDescription, 'An RPG.')
      }),
    ),
  )

  it.effect(
    'links a work DLsite hides outside Japan from its reduced page, then fills it in from Japan',
    () =>
      inSetup(({ root, site }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path
          const fs = yield* FileSystem.FileSystem
          const rpc = yield* client
          const folder = path.join(root, 'Games', 'Duo Fallen Lesbian NTR')

          yield* addGame('duo', folder)
          yield* fs.makeDirectory(path.join(folder, '261025-G01664771v1.03'))
          yield* runToEnd

          const reduced = yield* rpc.gameDetails({ gameId: 'duo' })

          assert.strictEqual(reduced?.link.code, 'RJ01664771')
          assert.isTrue(reduced?.restricted)
          assert.strictEqual(reduced?.circle, '金色complex')
          assert.deepStrictEqual(reduced?.genres, [])

          site.japan = true
          yield* runToEnd

          const full = yield* rpc.gameDetails({ gameId: 'duo' })

          assert.isFalse(full?.restricted)
          assert.strictEqual(full?.releasedOn, '2023-03-17')
        }),
      ),
  )

  it.effect('shows a DLsite work in Wenbu, with its sales and whether the Library has it', () =>
    inSetup(({ root }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const rpc = yield* client

        const page = yield* rpc.dlsiteWork({ code: 'RJ01009019' })

        assert.strictEqual(page.title, '鍛冶師ノ姉ガ堕チル時…')
        assert.strictEqual(page.price, 1320)
        assert.strictEqual(page.sold, 9014)
        assert.strictEqual(page.rating, 4.48)
        assert.isFalse(page.announced)
        assert.isNull(page.gameId)

        yield* addGame('smith', path.join(root, 'Games', 'Smith'))
        yield* rpc.linkWork({ gameId: 'smith', input: 'RJ01009019' })

        assert.strictEqual((yield* rpc.dlsiteWork({ code: 'RJ01009019' })).gameId, 'smith')

        const missing = yield* Effect.flip(rpc.dlsiteWork({ code: 'RJ01000001' }))

        assert.strictEqual(missing.reason, 'not-found')
      }),
    ),
  )

  it.effect("lists a circle's games from DLsite's search", () =>
    inSetup(() =>
      Effect.gen(function* () {
        const rpc = yield* client
        const all = yield* rpc.dlsiteList({ list: 'new', period: 'week' })
        const circleId = all.works[0]?.circleId ?? ''

        const works = yield* rpc.circleWorks({ circleId })

        assert.isAbove(works.length, 0)
        assert.isTrue(works.every((work) => work.circleId === circleId))
      }),
    ),
  )
})
