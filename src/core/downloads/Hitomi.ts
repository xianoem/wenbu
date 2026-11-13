import { Effect, Option, Schema } from 'effect'
import {
  expectOk,
  type GallerySource,
  problem,
  readText,
  send,
  type SourceContext,
} from './GallerySource'
import { nonEmpty } from '../platform/Text'

const galleryPattern =
  /^\/(?:manga|doujinshi|cg|gamecg|imageset|anime|galleries|reader)\/(?:[^/?#]+-)?(\d+)/

const ltn = 'https://ltn.gold-usergeneratedcontent.net'

const HitomiGallery = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  title: Schema.String,
  japanese_title: Schema.optional(Schema.NullOr(Schema.String)),
  files: Schema.Array(Schema.Struct({ hash: Schema.String, name: Schema.String })),
  tags: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          tag: Schema.String,
          female: Schema.optional(Schema.Unknown),
          male: Schema.optional(Schema.Unknown),
        }),
      ),
    ),
  ),
  artists: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ artist: Schema.String })))),
})

const decodeGallery = Schema.decodeUnknownOption(Schema.fromJsonString(HitomiGallery))

export interface ImageServers {
  readonly offsets: ReadonlyMap<number, number>
  readonly fallback: number
  readonly base: string
}

export const parseImageServers = (script: string): Option.Option<ImageServers> => {
  const offsets = new Map<number, number>()
  let pending: Array<number> = []

  for (const match of script.matchAll(/case\s+(\d+):(?:\s*o\s*=\s*(\d+))?/g)) {
    pending.push(Number(match[1]))

    if (match[2] !== undefined) {
      for (const key of pending) {
        offsets.set(key, Number(match[2]))
      }

      pending = []
    }
  }

  for (const match of script.matchAll(/if\s+\(g\s*===?\s*(\d+)\)[\s{]*o\s*=\s*(\d+)/g)) {
    offsets.set(Number(match[1]), Number(match[2]))
  }

  const fallback = /(?:var\s|default:)\s*o\s*=\s*(\d+)/.exec(script)?.[1]
  const base = /b:\s*["'](.+)["']/.exec(script)?.[1]

  if (base === undefined) {
    return Option.none()
  }

  return Option.some({
    offsets,
    fallback: fallback === undefined ? 0 : Number(fallback),
    base: base.replaceAll(/^\/+|\/+$/g, ''),
  })
}

export const imageUrl = (servers: ImageServers, hash: string) => {
  const number = Number.parseInt(`${hash.slice(-1)}${hash.slice(-3, -1)}`, 16)
  const server = (servers.offsets.get(number) ?? servers.fallback) + 1

  return `https://w${server}.gold-usergeneratedcontent.net/${servers.base}/${number}/${hash}.webp`
}

const fetchServers = Effect.fnUntraced(function* (context: SourceContext) {
  const response = yield* send(`${ltn}/gg.js`, context).pipe(
    Effect.flatMap((sent) => expectOk(sent)),
  )

  const script = yield* readText(response)

  return yield* Option.match(parseImageServers(script), {
    onNone: () => Effect.fail(problem('failed', 'hitomi.la changed how it serves images.')),
    onSome: Effect.succeed,
  })
})

export const Hitomi: GallerySource = {
  id: 'hitomi',
  matches: (url) => /^(www\.)?hitomi\.la$/i.test(url.hostname) && galleryPattern.test(url.pathname),
  pageConcurrency: 3,
  resolve: (url, context) =>
    Effect.gen(function* () {
      const id = galleryPattern.exec(url.pathname)?.[1] ?? ''

      const response = yield* send(`${ltn}/galleries/${id}.js`, context).pipe(
        Effect.flatMap((sent) => expectOk(sent)),
      )

      const script = yield* readText(response)

      const gallery = yield* Option.match(decodeGallery(script.slice(script.indexOf('{'))), {
        onNone: () =>
          Effect.fail(problem('failed', 'hitomi.la sent a gallery Wenbu could not read.')),
        onSome: Effect.succeed,
      })

      const servers = yield* fetchServers(context)
      const headers = { Referer: `https://hitomi.la/reader/${id}.html` }

      return {
        id: String(gallery.id),
        title: gallery.title,
        titleJapanese: nonEmpty(gallery.japanese_title),
        tags: (gallery.tags ?? []).map((tag) => {
          if (tag.female) {
            return `female:${tag.tag}`
          }

          return tag.male ? `male:${tag.tag}` : `tag:${tag.tag}`
        }),
        artists: (gallery.artists ?? []).map((artist) => artist.artist),
        pages: gallery.files.map((file, index) => ({
          number: index + 1,
          image: () => Effect.succeed({ url: imageUrl(servers, file.hash), headers }),
        })),
      }
    }),
  check: (context) => Effect.as(fetchServers(context), {}),
}
