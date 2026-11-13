import { gunzipSync } from 'node:zlib'
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Schedule,
  Schema,
  Semaphore,
} from 'effect'
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import {
  AgeRating,
  DetailsError,
  type GameType,
  Genre,
  type RankingPeriod,
  WorkCode,
} from '#contract/Details'
import { decodeEntities, nonEmpty } from '../platform/Text'

export const Work = Schema.Struct({
  code: Schema.String,
  title: Schema.String,
  altTitles: Schema.Array(Schema.String),
  circle: Schema.String,
  circleId: Schema.String,
  creators: Schema.Array(Schema.String),
  genres: Schema.Array(Genre),
  releasedOn: Schema.String,
  workType: Schema.String,
  description: Schema.String,
  ageRating: AgeRating,
  coverUrl: Schema.OptionFromNullOr(Schema.String),
  sampleUrls: Schema.Array(Schema.String),
  url: Schema.String,
  restricted: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  price: Schema.OptionFromNullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  officialPrice: Schema.OptionFromNullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  discountRate: Schema.OptionFromNullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  saleEndsOn: Schema.OptionFromNullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  fileSize: Schema.OptionFromNullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  languages: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  roles: Schema.Array(
    Schema.Struct({ role: Schema.String, names: Schema.Array(Schema.String) }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

export type Work = typeof Work.Type

export interface Sales {
  readonly rating: Option.Option<number>
  readonly ratingCount: Option.Option<number>
  readonly sold: Option.Option<number>
  readonly wishlist: Option.Option<number>
}

export const ListedHit = Schema.Struct({
  code: Schema.String,
  title: Schema.String,
  circle: Schema.String,
  circleId: Schema.String,
  coverUrl: Schema.OptionFromNullOr(Schema.String),
  workType: Schema.String,
  genres: Schema.Array(Genre),
  price: Schema.OptionFromNullOr(Schema.Number),
  releasedOn: Schema.OptionFromNullOr(Schema.String),
  expected: Schema.OptionFromNullOr(Schema.String),
  rank: Schema.OptionFromNullOr(Schema.Number),
})

export type ListedHit = typeof ListedHit.Type

/** DLsite asks agents for at most 2 requests a second and 120 a minute (`/llms.txt`). */
export const DLsitePacing = Context.Reference<{
  readonly gap: Duration.Input
  readonly retry: Duration.Input
}>('wenbu/core/details/DLsitePacing', {
  defaultValue: () => ({ gap: '600 millis', retry: '30 seconds' }),
})

const site = 'https://www.dlsite.com/maniax'

const agent = 'Wenbu (desktop app for a personal game library)'

type Locale = 'ja_JP' | 'en_US'

const ImageFile = Schema.Struct({ url: Schema.String })

const Creators = Schema.Record(Schema.String, Schema.Array(Schema.Struct({ name: Schema.String })))

const isCreators = Schema.is(Creators)

const ProductJson = Schema.Struct({
  workno: Schema.String,
  work_name: Schema.String,
  work_name_kana: Schema.optional(Schema.NullOr(Schema.String)),
  alt_name: Schema.optional(Schema.NullOr(Schema.String)),
  maker_name: Schema.String,
  circle_id: Schema.optional(Schema.NullOr(Schema.String)),
  regist_date: Schema.String,
  age_category: Schema.Int,
  work_type: Schema.String,
  intro_s: Schema.optional(Schema.NullOr(Schema.String)),
  image_main: Schema.optional(Schema.NullOr(ImageFile)),
  image_samples: Schema.optional(Schema.NullOr(Schema.Array(ImageFile))),
  genres: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.Int, name: Schema.String }))),
  ),
  // PHP sends an empty array instead of an empty object.
  creaters: Schema.optional(Schema.NullOr(Schema.Union([Creators, Schema.Array(Schema.Unknown)]))),
  price: Schema.optional(Schema.NullOr(Schema.Number)),
  official_price: Schema.optional(Schema.NullOr(Schema.Number)),
  discount_rate: Schema.optional(Schema.NullOr(Schema.Number)),
  campaign_end_date: Schema.optional(Schema.NullOr(Schema.String)),
  contents_file_size: Schema.optional(Schema.NullOr(Schema.Number)),
  language_editions: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ workno: Schema.String, lang: Schema.String }))),
  ),
})

const decodeProducts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(ProductJson)))

const SalesJson = Schema.Record(
  Schema.String,
  Schema.Struct({
    rate_average_2dp: Schema.optional(Schema.NullOr(Schema.Number)),
    rate_count: Schema.optional(Schema.NullOr(Schema.Number)),
    dl_count: Schema.optional(Schema.NullOr(Schema.Number)),
    wishlist_count: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
)

const decodeSales = Schema.decodeUnknownOption(Schema.fromJsonString(SalesJson))

const SearchJson = Schema.Struct({
  search_result: Schema.String,
  page_info: Schema.optional(Schema.Struct({ count: Schema.Number, last_indice: Schema.Number })),
})

const decodeSearch = Schema.decodeUnknownOption(Schema.fromJsonString(SearchJson))

const isWorkCode = Schema.is(WorkCode)

const absolute = (url: string) => (url.startsWith('//') ? `https:${url}` : url)

const ageRatingOf = (category: number): AgeRating => {
  if (category === 3) {
    return 'adult'
  }

  return category === 2 ? 'r15' : 'all'
}

const workUrl = (code: string) => `${site}/work/=/product_id/${code}.html`

const roleLabels: Record<string, string> = {
  created_by: 'Created by',
  scenario_by: 'Scenario',
  illust_by: 'Illustration',
  voice_by: 'Voice',
  music_by: 'Music',
  other_by: 'Other',
}

const rolesOf = (creaters: (typeof ProductJson.Type)['creaters']) => {
  const roles: typeof Creators.Type = isCreators(creaters) ? creaters : {}

  return Object.entries(roles).map(([key, people]) => ({
    role: roleLabels[key] ?? key,
    names: [...new Set(people.map((person) => person.name))],
  }))
}

const languageLabels: Record<string, string> = {
  JPN: 'Japanese',
  ENG: 'English',
  CHI_HANS: 'Chinese (Simplified)',
  CHI_HANT: 'Chinese (Traditional)',
  KO_KR: 'Korean',
  SPA: 'Spanish',
  GER: 'German',
  FRE: 'French',
  IND: 'Indonesian',
  ITA: 'Italian',
  POR: 'Portuguese',
  SWE: 'Swedish',
  THA: 'Thai',
  VIE: 'Vietnamese',
}

const languagesOf = (editions: (typeof ProductJson.Type)['language_editions']) =>
  editions === undefined || editions === null || editions.length === 0
    ? ['Japanese']
    : [...new Set(editions.map((edition) => languageLabels[edition.lang] ?? edition.lang))]

const creatorsOf = (creaters: (typeof ProductJson.Type)['creaters']) => {
  const roles: typeof Creators.Type = isCreators(creaters) ? creaters : {}
  const names = Object.values(roles).flatMap((people) => people.map((person) => person.name))

  return [...new Set(names)]
}

/** DLsite answers `[]` for a code it does not sell. */
export const parseProduct = (text: string): Option.Option<Work> =>
  Option.flatMap(decodeProducts(text), (products) =>
    Option.map(Option.fromNullishOr(products[0]), (product) => ({
      code: product.workno,
      title: product.work_name,
      altTitles: [product.work_name_kana, product.alt_name].flatMap((name) =>
        Option.toArray(nonEmpty(name)),
      ),
      circle: product.maker_name,
      circleId: product.circle_id ?? '',
      creators: creatorsOf(product.creaters),
      genres: product.genres ?? [],
      releasedOn: product.regist_date.slice(0, 10),
      workType: product.work_type,
      description: decodeEntities(product.intro_s ?? '').trim(),
      ageRating: ageRatingOf(product.age_category),
      coverUrl: Option.map(Option.fromNullishOr(product.image_main), (image) =>
        absolute(image.url),
      ),
      sampleUrls: (product.image_samples ?? []).map((image) => absolute(image.url)),
      url: workUrl(product.workno),
      restricted: false,
      price: Option.fromNullishOr(product.price),
      officialPrice: Option.fromNullishOr(product.official_price),
      discountRate: Option.fromNullishOr(product.discount_rate),
      saleEndsOn: Option.map(Option.fromNullishOr(product.campaign_end_date), (date) =>
        date.slice(0, 10),
      ),
      fileSize: Option.fromNullishOr(product.contents_file_size),
      languages: languagesOf(product.language_editions),
      roles: rolesOf(product.creaters),
    })),
  )

export const parseSales = (text: string, code: string): Sales => {
  const entry = Option.flatMap(decodeSales(text), (sales) => Option.fromNullishOr(sales[code]))

  return {
    rating: Option.flatMap(entry, (found) => Option.fromNullishOr(found.rate_average_2dp)),
    ratingCount: Option.flatMap(entry, (found) => Option.fromNullishOr(found.rate_count)),
    sold: Option.flatMap(entry, (found) => Option.fromNullishOr(found.dl_count)),
    wishlist: Option.flatMap(entry, (found) => Option.fromNullishOr(found.wishlist_count)),
  }
}

const months: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
}

export const parseListDate = (text: string): Option.Option<string> => {
  const english = /([A-Z][a-z]{2})\/(\d{1,2})\/(\d{4})/.exec(text)
  const month = months[english?.[1] ?? '']

  if (english !== null && month !== undefined) {
    return Option.some(`${english[3]}-${month}-${(english[2] ?? '').padStart(2, '0')}`)
  }

  const japanese = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text)

  return japanese === null
    ? Option.none()
    : Option.some(
        `${japanese[1]}-${(japanese[2] ?? '').padStart(2, '0')}-${(japanese[3] ?? '').padStart(2, '0')}`,
      )
}

const text = (html: string) =>
  decodeEntities(html.replaceAll(/<[^>]*>/g, ' '))
    .replaceAll(/\s+/g, ' ')
    .trim()

const firstMatch = (pattern: RegExp, html: string) => Option.fromNullishOr(pattern.exec(html)?.[1])

const metaContent = (html: string, attribute: string, name: string) =>
  firstMatch(new RegExp(`<meta[^>]*${attribute}="${name}"[^>]*content="([^"]*)"`), html)

export const parseReducedPage = (html: string, code: string): Option.Option<Work> =>
  Option.map(metaContent(html, 'property', 'og:title'), (ogTitle) => {
    const named = decodeEntities(ogTitle).replace(/\s*\|\s*DLsite.*$/, '')
    const bracket = /^(.*)\s\[([^\]]+)\]$/.exec(named)
    const maker = /maker_id\/(RG\d+)\.html"[^>]*>\s*(?:<span>)?([^<]*)/.exec(html)

    return {
      code,
      title: (bracket?.[1] ?? named).trim(),
      altTitles: [],
      circle: text(maker?.[2] ?? '') || (bracket?.[2] ?? ''),
      circleId: maker?.[1] ?? '',
      creators: [],
      genres: [],
      releasedOn: '',
      workType: '',
      description: text(Option.getOrElse(metaContent(html, 'itemprop', 'description'), () => '')),
      ageRating: 'adult',
      coverUrl: Option.map(metaContent(html, 'property', 'og:image'), absolute),
      sampleUrls: [],
      url: workUrl(code),
      restricted: true,
      price: Option.none(),
      officialPrice: Option.none(),
      discountRate: Option.none(),
      saleEndsOn: Option.none(),
      fileSize: Option.none(),
      languages: [],
      roles: [],
    }
  })

const genresIn = (html: string): ReadonlyArray<Genre> => {
  const seen = new Map<number, string>()

  for (const match of html.matchAll(/\/genre\/(\d+)\/from\/work\.genre">([^<]*)</g)) {
    seen.set(Number(match[1]), text(match[2] ?? ''))
  }

  return [...seen].map(([id, name]) => ({ id, name }))
}

const coverIn = (html: string) =>
  Option.map(
    firstMatch(/'(\/\/img\.dlsite\.jp\/[^']+\.jpg)'/, html).pipe(
      Option.orElse(() => firstMatch(/src="(\/\/img\.dlsite\.jp\/[^"]+\.jpg)"/, html)),
    ),
    absolute,
  )

const priceIn = (html: string) =>
  Option.map(
    firstMatch(/work_price_base">([\d,]+)</, html).pipe(
      Option.orElse(() => firstMatch(/work_price">([\d,]+)/, html)),
    ),
    (price) => Number(price.replaceAll(',', '')),
  )

const hitIn = (html: string): Option.Option<ListedHit> => {
  const code = firstMatch(/product_id\/((?:RJ|VJ|BJ)\d+)\.html/, html)
  const maker = /maker_id\/(RG\d+|VG\d+|BG\d+)\.html">([^<]*)</.exec(html)

  return Option.map(Option.filter(code, isWorkCode), (found) => ({
    code: found,
    title: text(
      firstMatch(/<dt class="work_name">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/, html).pipe(
        Option.getOrElse(() => ''),
      ),
    ),
    circle: text(maker?.[2] ?? ''),
    circleId: maker?.[1] ?? '',
    coverUrl: coverIn(html),
    workType: Option.getOrElse(firstMatch(/work_category type_(\w+)/, html), () => ''),
    genres: genresIn(html),
    price: priceIn(html),
    releasedOn: Option.flatMap(firstMatch(/sales_date">([^<]*)</, html), parseListDate),
    expected: Option.flatMap(firstMatch(/expected_date">([^<]*)</, html), (date) =>
      nonEmpty(text(date)),
    ),
    rank: Option.map(firstMatch(/rank_no[^>]*>(\d+)</, html), Number),
  }))
}

const splitAt = (html: string, start: RegExp) => {
  const starts = [...html.matchAll(start)].map((match) => match.index)

  return starts.map((at, index) => html.slice(at, starts[index + 1] ?? html.length))
}

const hitsIn = (html: string, start: RegExp) =>
  splitAt(html, start).flatMap((chunk) => Option.toArray(hitIn(chunk)))

export const parseSearchPage = (body: string) =>
  Option.map(decodeSearch(body), (found) => ({
    hits: hitsIn(found.search_result, /<tr\s+data-list_item_product_id=/g),
    last: found.page_info === undefined || found.page_info.last_indice >= found.page_info.count,
  }))

export const parseSearch = (body: string): Option.Option<ReadonlyArray<ListedHit>> =>
  Option.map(parseSearchPage(body), (found) => found.hits)

export const parseRanking = (html: string): ReadonlyArray<ListedHit> =>
  hitsIn(html, /<tr class="[^"]*">\s*<td class="ranking_count">/g)

const monthPartEnds: Record<string, string> = { 上旬: '10', 中旬: '20', 下旬: '31' }

const plannedBy = (hit: ListedHit) =>
  Option.flatMap(hit.expected, (expected) => {
    const planned = /(\d{4})年(\d{1,2})月(?:(\d{1,2})日|(上旬|中旬|下旬))?/.exec(expected)

    if (planned === null) {
      return Option.none<string>()
    }

    const [, year, month = '', day, part = ''] = planned

    return Option.some(
      `${year}-${month.padStart(2, '0')}-${(day ?? monthPartEnds[part] ?? '31').padStart(2, '0')}`,
    )
  })

const isOverdue = (hit: ListedHit, month: string) =>
  Option.exists(plannedBy(hit), (planned) => planned.slice(0, 7) < month)

/** DLsite keeps announcements whose planned month passed years ago. */
export const comingFrom = (hits: ReadonlyArray<ListedHit>, month: string) =>
  hits
    .filter((hit) => !isOverdue(hit, month))
    .toSorted((a, b) =>
      Option.getOrElse(plannedBy(a), () => '9999').localeCompare(
        Option.getOrElse(plannedBy(b), () => '9999'),
      ),
    )

const announcedPages = 21

const announcedBatch = 3

/** DLsite ranks 100 works a list and cannot rank by tag; per-type rankings reach further down. */
export const mergeRankings = (
  combined: ReadonlyArray<ListedHit>,
  perType: ReadonlyArray<ReadonlyArray<ListedHit>>,
): ReadonlyArray<ListedHit> => {
  const inCombined = new Set(combined.map((hit) => hit.code))
  const byCode = new Map(perType.flat().map((hit) => [hit.code, hit]))

  const deeper = [...byCode.values()]
    .filter((hit) => !inCombined.has(hit.code))
    .toSorted(
      (a, b) => Option.getOrElse(a.rank, () => Infinity) - Option.getOrElse(b.rank, () => Infinity),
    )

  return [...combined, ...deeper]
}

export const parseGenres = (html: string): ReadonlyArray<Genre> => {
  const seen = new Map<number, string>()

  for (const match of html.matchAll(/\/genre\/=\/genre\/(\d+)">([^<]*)</g)) {
    seen.set(Number(match[1]), text(match[2] ?? ''))
  }

  return [...seen]
    .map(([id, name]) => ({ id, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

class Transient extends Schema.TaggedError<Transient>()('Transient', { message: Schema.String }) {}

const unreachable = (message: string) => new DetailsError({ reason: 'unreachable', message })

const changed = new DetailsError({
  reason: 'changed',
  message: 'DLsite changed its page, so Wenbu could not read it.',
})

const gamesOnly = 'work_type_category%5B0%5D/game'

/** DLsite reads words in a keyword path apart by `+`; an encoded space is refused with a 403. */
export const keywordPath = (keyword: string) =>
  keyword
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => encodeURIComponent(word))
    .join('+')

const searchUrl = (
  keyword: string,
  filters = '',
  order = 'trend',
  perPage = 30,
  kinds = gamesOnly,
  page = 1,
) =>
  `${site}/fsr/ajax/=/language/jp/sex_category%5B0%5D/male/${kinds}/${filters}${
    keyword === '' ? '' : `keyword/${keywordPath(keyword)}/`
  }order/${order}/per_page/${perPage}/page/${page}/show_type/1`

const tagFilters = (ids: ReadonlyArray<number>) =>
  ids.length === 0
    ? ''
    : `${ids.map((id, index) => `genre%5B${index}%5D/${String(id).padStart(3, '0')}/`).join('')}genre_and_or/and/`

/** Naming game types replaces the games category, which DLsite would otherwise read as a third filter. */
const gameTypeKinds = (types: ReadonlyArray<GameType>) =>
  types.length === 0
    ? gamesOnly
    : types.map((type, index) => `work_type%5B${index}%5D/${type}`).join('/')

export class DLsite extends Context.Service<
  DLsite,
  {
    readonly work: (code: string) => Effect.Effect<Option.Option<Work>, DetailsError>
    readonly sales: (code: string) => Effect.Effect<Sales, DetailsError>
    readonly search: (keyword: string) => Effect.Effect<ReadonlyArray<ListedHit>, DetailsError>
    readonly ranking: (
      period: RankingPeriod,
      types: ReadonlyArray<GameType>,
    ) => Effect.Effect<ReadonlyArray<ListedHit>, DetailsError>
    readonly newest: (
      tagIds: ReadonlyArray<number>,
      types: ReadonlyArray<GameType>,
    ) => Effect.Effect<ReadonlyArray<ListedHit>, DetailsError>
    readonly upcoming: (month: string) => Effect.Effect<ReadonlyArray<ListedHit>, DetailsError>
    readonly genres: Effect.Effect<ReadonlyArray<Genre>, DetailsError>
    readonly image: (url: string) => Effect.Effect<Uint8Array, DetailsError>
  }
>()('wenbu/core/details/DLsite') {
  static readonly layer = Layer.effect(
    DLsite,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.followRedirects(5))
      const gate = yield* Semaphore.make(1)
      let lastStart = Number.NEGATIVE_INFINITY

      const waitTurn = Effect.gen(function* () {
        const { gap } = yield* DLsitePacing
        const wait = lastStart + Duration.toMillis(gap) - (yield* Clock.currentTimeMillis)

        if (wait > 0) {
          yield* Effect.sleep(Duration.millis(wait))
        }

        lastStart = yield* Clock.currentTimeMillis
      }).pipe(gate.withPermits(1))

      const once = Effect.fnUntraced(function* (url: string, locale: Locale) {
        yield* waitTurn

        const request = HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            'User-Agent': agent,
            'Accept-Encoding': 'gzip',
            Cookie: `adultchecked=1; locale=${locale}`,
          }),
        )

        const response = yield* client.execute(request).pipe(
          Effect.mapError(() => new Transient({ message: 'DLsite could not be reached.' })),
          Effect.timeoutOrElse({
            duration: '30 seconds',
            orElse: () => Effect.fail(new Transient({ message: 'DLsite did not answer.' })),
          }),
        )

        if (response.status === 429 || response.status >= 500) {
          return yield* new Transient({ message: `DLsite is busy (${response.status}).` })
        }

        if (response.status === 404) {
          return Option.none()
        }

        if (response.status < 200 || response.status >= 300) {
          return yield* new DetailsError({
            reason: 'changed',
            message: `DLsite refused the request (${response.status}).`,
          })
        }

        return Option.some(response)
      })

      const fetch = Effect.fnUntraced(function* (url: string, locale: Locale = 'en_US') {
        const { retry } = yield* DLsitePacing

        return yield* once(url, locale).pipe(
          Effect.retry({
            while: Predicate.isTagged('Transient'),
            schedule: Schedule.spaced(retry),
            times: 2,
          }),
          Effect.catchTag('Transient', (error) => Effect.fail(unreachable(error.message))),
        )
      })

      const bodyOf = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
        const bytes = yield* response.arrayBuffer.pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          Effect.mapError(() => unreachable('The connection to DLsite dropped.')),
        )

        if (response.headers['content-encoding'] !== 'gzip') {
          return bytes
        }

        return yield* Effect.try({
          try: () => new Uint8Array(gunzipSync(bytes)),
          catch: () => unreachable('DLsite sent a page that could not be read.'),
        })
      })

      const fetchText = Effect.fnUntraced(function* (url: string, locale: Locale = 'en_US') {
        const response = yield* fetch(url, locale)

        if (Option.isNone(response)) {
          return Option.none<string>()
        }

        return Option.some(new TextDecoder().decode(yield* bodyOf(response.value)))
      })

      const page = Effect.fnUntraced(function* (url: string, locale: Locale = 'en_US') {
        const body = yield* fetchText(url, locale)

        if (Option.isNone(body)) {
          return yield* changed
        }

        return body.value
      })

      const list = Effect.fnUntraced(function* (
        url: string,
        parse: (html: string) => ReadonlyArray<ListedHit>,
      ) {
        const hits = parse(yield* page(url, 'ja_JP'))

        return hits.length === 0 ? yield* changed : hits
      })

      const searchPageOf = Effect.fnUntraced(function* (url: string, locale: Locale) {
        const found = parseSearchPage(yield* page(url, locale))

        if (Option.isNone(found)) {
          return yield* changed
        }

        return found.value
      })

      const searchPage = (url: string, locale: Locale = 'en_US') =>
        Effect.map(searchPageOf(url, locale), (found) => found.hits)

      return DLsite.of({
        work: Effect.fn('DLsite.work')(function* (code: string) {
          const body = yield* fetchText(`${site}/api/=/product.json?workno=${code}&locale=en_US`)
          const work = Option.flatMap(body, parseProduct)

          if (Option.isSome(work)) {
            return work
          }

          const page = yield* fetchText(workUrl(code))

          return Option.flatMap(page, (html) => parseReducedPage(html, code))
        }),
        sales: Effect.fn('DLsite.sales')(function* (code: string) {
          const body = yield* fetchText(`${site}/product/info/ajax?product_id=${code}`)

          return Option.match(body, {
            onNone: () => ({
              rating: Option.none(),
              ratingCount: Option.none(),
              sold: Option.none(),
              wishlist: Option.none(),
            }),
            onSome: (found) => parseSales(found, code),
          })
        }),
        search: (keyword) => searchPage(searchUrl(keyword)),
        ranking: (period, types) =>
          types.length === 0
            ? list(`${site}/ranking/${period}?category=game`, parseRanking)
            : // A game type can have sold nothing in the period, so an empty ranking is an answer.
              Effect.map(
                page(
                  `${site}/ranking/${period}?category=game${types.map((type, index) => `&sub%5B${index}%5D=${type}`).join('')}`,
                  'ja_JP',
                ),
                (html) => parseRanking(html),
              ),
        newest: (tagIds, types) =>
          searchPage(
            searchUrl('', tagFilters(tagIds), 'release_d', 100, gameTypeKinds(types)),
            'ja_JP',
          ),
        // DLsite's own upcoming page shows ten days at a time and every kind of work.
        upcoming: Effect.fn('DLsite.upcoming')(function* (month: string) {
          const hits: Array<ListedHit> = []

          for (let first = 1; first <= announcedPages; first += announcedBatch) {
            const pages = yield* Effect.forEach(
              Array.from({ length: announcedBatch }, (_, at) => first + at),
              (at) =>
                searchPageOf(
                  searchUrl('', 'ana_flg/on/', 'release_d', 100, gamesOnly, at),
                  'ja_JP',
                ),
              { concurrency: 'unbounded' },
            )

            hits.push(...pages.flatMap((found) => found.hits))

            if (
              pages.some((found) => found.last || found.hits.some((hit) => isOverdue(hit, month)))
            ) {
              break
            }
          }

          const byCode = new Map(hits.map((hit) => [hit.code, hit]))

          return comingFrom([...byCode.values()], month)
        }),
        genres: Effect.gen(function* () {
          const genres = parseGenres(yield* page(`${site}/genre/list`))

          return genres.length === 0 ? yield* changed : genres
        }),
        image: Effect.fn('DLsite.image')(function* (url: string) {
          const response = yield* fetch(url)

          if (Option.isNone(response)) {
            return yield* new DetailsError({
              reason: 'not-found',
              message: 'DLsite has no such image.',
            })
          }

          return yield* bodyOf(response.value)
        }),
      })
    }),
  )
}
