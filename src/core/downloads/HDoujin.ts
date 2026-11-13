import { Effect, Option, Schema } from 'effect'
import { type HDoujinQuality, HDoujinQuality as Qualities } from '#contract/Downloads'
import {
  expectOk,
  type GallerySource,
  problem,
  readJson,
  send,
  type SourceContext,
  storageValue,
} from './GallerySource'
import { nonEmpty } from '../platform/Text'

const galleryPattern = /^\/(?:g|reader)\/(\d+)\/(\w+)/

const api = 'https://api.hdoujin.org'

const headers = { Referer: 'https://hdoujin.org/', Origin: 'https://hdoujin.org' }

const Detail = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, namespace: Schema.optional(Schema.Int) })),
  ),
})

const Formats = Schema.Struct({
  data: Schema.Record(
    Schema.String,
    Schema.Struct({ id: Schema.optional(Schema.NullOr(Schema.Int)), key: Schema.String }),
  ),
})

const Pages = Schema.Struct({
  base: Schema.String,
  entries: Schema.Array(Schema.Struct({ path: Schema.String })),
})

const Listing = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ id: Schema.Int, key: Schema.String })),
})

const namespaces: Record<number, string> = {
  1: 'artist',
  2: 'circle',
  3: 'parody',
  4: 'magazine',
  5: 'character',
  7: 'uploader',
  8: 'male',
  9: 'female',
  10: 'mixed',
  11: 'language',
  12: 'other',
}

const signInAgain = () =>
  problem('sign-in', 'HDoujin no longer accepts the saved sign-in. Sign in again in Settings.')

const deniedAsSignIn = (status: number) =>
  status === 401 || status === 403 ? Option.some(signInAgain()) : Option.none()

const AccountToken = Schema.fromJsonString(
  Schema.Struct({ session: Schema.optional(Schema.String) }),
)

const decodeAccountToken = Schema.decodeUnknownOption(AccountToken)

const accountHeaders = (context: SourceContext): Record<string, string> =>
  Option.match(
    Option.flatMap(storageValue(context.session, 'token'), (token) =>
      Option.flatMap(decodeAccountToken(token), (parsed) => nonEmpty(parsed.session)),
    ),
    {
      onNone: () => headers,
      onSome: (session) => ({ ...headers, Authorization: `Bearer ${session}` }),
    },
  )

const accessToken = (context: SourceContext) =>
  Option.match(storageValue(context.session, 'clearance'), {
    onNone: () =>
      Effect.fail(problem('sign-in', 'Sign in to HDoujin in Settings › Downloads first.')),
    onSome: Effect.succeed,
  })

export const chooseFormat = (formats: (typeof Formats.Type)['data'], preferred: HDoujinQuality) => {
  const order = Qualities.literals.slice(Qualities.literals.indexOf(preferred))

  for (const width of order) {
    const format = formats[width]

    if (format?.id !== undefined && format.id !== null) {
      return Option.some({ width, id: format.id, key: format.key })
    }
  }

  return Option.none()
}

const fetchFormats = Effect.fnUntraced(function* (id: string, key: string, context: SourceContext) {
  const crt = yield* accessToken(context)

  const response = yield* send(`${api}/books/detail/${id}/${key}?crt=${crt}`, context, {
    method: 'POST',
    headers: accountHeaders(context),
  }).pipe(Effect.flatMap((sent) => expectOk(sent, deniedAsSignIn)))

  return (yield* readJson(response, Formats)).data
})

export const HDoujin: GallerySource = {
  id: 'hdoujin',
  matches: (url) =>
    /^(www\.)?hdoujin\.(org|net)$/i.test(url.hostname) && galleryPattern.test(url.pathname),
  pageConcurrency: 3,
  signIn: {
    url: 'https://hdoujin.org/',
    instructions:
      'Sign in to your HDoujin account in the browser Wenbu opened, open any gallery so its pages load, then close the browser.',
    sites: ['hdoujin.org', 'hdoujin.net'],
    storageKeys: ['clearance', 'token'],
    accepts: (session) => Option.isSome(storageValue(Option.some(session), 'clearance')),
  },
  resolve: (url, context) =>
    Effect.gen(function* () {
      const [, id = '', key = ''] = galleryPattern.exec(url.pathname) ?? []
      const crt = yield* accessToken(context)

      const detail = yield* send(`${api}/books/detail/${id}/${key}`, context, { headers }).pipe(
        Effect.flatMap((sent) => expectOk(sent)),
        Effect.flatMap((response) => readJson(response, Detail)),
      )

      const formats = yield* fetchFormats(id, key, context)

      const format = yield* Option.match(chooseFormat(formats, context.settings.hdoujinQuality), {
        onNone: () => Effect.fail(problem('not-found', 'HDoujin has no images for this gallery.')),
        onSome: Effect.succeed,
      })

      const pages = yield* send(
        `${api}/books/data/${id}/${key}/${format.id}/${format.key}/${format.width}?crt=${crt}`,
        context,
        { headers },
      ).pipe(
        Effect.flatMap((sent) => expectOk(sent, deniedAsSignIn)),
        Effect.flatMap((response) => readJson(response, Pages)),
      )

      const tags = (detail.tags ?? []).map((tag) => {
        const namespace = namespaces[tag.namespace ?? 0]

        return namespace === undefined ? `tag:${tag.name}` : `${namespace}:${tag.name}`
      })

      return {
        id,
        title: detail.title,
        titleJapanese: nonEmpty(detail.subtitle),
        tags,
        artists: (detail.tags ?? []).filter((tag) => tag.namespace === 1).map((tag) => tag.name),
        pages: pages.entries.map((entry, index) => ({
          number: index + 1,
          image: () => Effect.succeed({ url: `${pages.base}${entry.path}`, headers }),
        })),
      }
    }),
  check: (context) =>
    Effect.gen(function* () {
      yield* accessToken(context)

      const listing = yield* send(`${api}/books`, context, { headers }).pipe(
        Effect.flatMap((sent) => expectOk(sent)),
        Effect.flatMap((response) => readJson(response, Listing)),
      )

      const sample = listing.entries[0]

      if (sample !== undefined) {
        yield* fetchFormats(String(sample.id), sample.key, context)
      }

      return {}
    }),
}
