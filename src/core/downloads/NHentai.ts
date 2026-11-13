import { Effect, Option, Schema } from 'effect'
import { expectOk, type GallerySource, readJson, send, type SourceContext } from './GallerySource'
import { nonEmpty } from '../platform/Text'

const galleryPattern = /^\/g\/(\d+)/

const api = 'https://nhentai.net/api/v2/galleries'

const NHentaiGallery = Schema.Struct({
  id: Schema.Int,
  title: Schema.Struct({
    english: Schema.optional(Schema.NullOr(Schema.String)),
    japanese: Schema.optional(Schema.NullOr(Schema.String)),
    pretty: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  tags: Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String })),
  pages: Schema.Array(Schema.Struct({ number: Schema.Int, path: Schema.String })),
})

const headers = { Referer: 'https://nhentai.net/' }

const fetchGallery = Effect.fnUntraced(function* (id: string, context: SourceContext) {
  const response = yield* send(`${api}/${id}`, context, { headers }).pipe(
    Effect.flatMap((sent) => expectOk(sent)),
  )

  return yield* readJson(response, NHentaiGallery)
})

const imageUrl = (number: number, path: string) =>
  `https://i${1 + (number % 4)}.nhentai.net/${path}`

export const NHentai: GallerySource = {
  id: 'nhentai',
  matches: (url) =>
    /^(www\.)?nhentai\.net$/i.test(url.hostname) && galleryPattern.test(url.pathname),
  pageConcurrency: 3,
  resolve: (url, context) =>
    Effect.gen(function* () {
      const id = galleryPattern.exec(url.pathname)?.[1] ?? ''
      const gallery = yield* fetchGallery(id, context)
      const english = nonEmpty(gallery.title.english)

      return {
        id: String(gallery.id),
        title: Option.getOrElse(
          Option.orElse(english, () => nonEmpty(gallery.title.japanese)),
          () => `nhentai ${gallery.id}`,
        ),
        titleJapanese: nonEmpty(gallery.title.japanese),
        tags: gallery.tags
          .filter((tag) => tag.type !== 'language' || tag.name !== 'translated')
          .map((tag) => `${tag.type}:${tag.name}`),
        artists: gallery.tags.filter((tag) => tag.type === 'artist').map((tag) => tag.name),
        pages: gallery.pages.map((page) => ({
          number: page.number,
          image: () => Effect.succeed({ url: imageUrl(page.number, page.path), headers }),
        })),
      }
    }),
  check: (context) => Effect.as(fetchGallery('1', context), {}),
}
