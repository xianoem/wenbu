import { Effect, Option, Random } from 'effect'
import type { Cookies } from 'effect/http'
import type { RequestDelay } from '#contract/Downloads'
import {
  expectOk,
  findCookie,
  type GalleryPage,
  type GallerySource,
  pause,
  problem,
  readText,
  ReducedQualityOnly,
  send,
  type Session,
  type SourceContext,
} from './GallerySource'
import { decodeEntities, nonEmpty } from '../platform/Text'

const galleryPattern = /^\/g\/(\d+)\/([\da-f]{10})/

const noWarning = 'nw=1'

const delays: Record<RequestDelay, readonly [number, number]> = {
  fast: [0.75, 1.5],
  normal: [1.5, 3],
  careful: [3, 6],
}

export const isSignedIn = (session: Option.Option<Session>) =>
  Option.isSome(findCookie(session, 'ipb_member_id')) &&
  Option.isSome(findCookie(session, 'ipb_pass_hash'))

/** ExHentai sets `igneous` for accounts it lets in; others get `mystery` and a blank page. */
export const hasExAccess = (session: Option.Option<Session>) =>
  Option.exists(findCookie(session, 'igneous'), (value) => value !== '' && value !== 'mystery')

const rootFor = (context: SourceContext) =>
  hasExAccess(context.session) ? 'https://exhentai.org' : 'https://e-hentai.org'

const politePause = (context: SourceContext) => {
  const [min, max] = delays[context.settings.exhentaiDelay]

  return Effect.flatMap(Random.nextBetween(min, max), (seconds) => pause(seconds))
}

const noAccess = () =>
  problem(
    'sign-in',
    "ExHentai sent a blank page: this account can't open ExHentai. Sign in again in Settings.",
  )

const fetchPage = Effect.fnUntraced(function* (url: string, context: SourceContext) {
  const response = yield* send(url, context, { extraCookies: noWarning }).pipe(
    Effect.flatMap((sent) => expectOk(sent)),
  )

  const body = yield* readText(response)

  if (body.trim() === '') {
    return yield* noAccess()
  }

  return body
})

export interface GalleryListing {
  readonly title: Option.Option<string>
  readonly titleJapanese: Option.Option<string>
  readonly length: number
  readonly tags: ReadonlyArray<string>
  readonly links: ReadonlyArray<readonly [number, string]>
}

export const parseGallery = (html: string, gid: string): GalleryListing => {
  const title = nonEmpty(decodeEntities(/<h1 id="gn">([^<]*)<\/h1>/.exec(html)?.[1] ?? ''))
  const titleJapanese = nonEmpty(decodeEntities(/<h1 id="gj">([^<]*)<\/h1>/.exec(html)?.[1] ?? ''))
  const length = Number(/Length:<\/td><td class="gdt2">(\d+) pages?/.exec(html)?.[1] ?? 0)

  const tags = [...html.matchAll(/id="td_([^"]+)"/g)].map((match) =>
    decodeEntities(match[1] ?? '').replaceAll('_', ' '),
  )

  const links = [...html.matchAll(new RegExp(`/s/([\\da-f]{10})/${gid}-(\\d+)`, 'g'))].map(
    (match) => [Number(match[2]), match[1] ?? ''] as const,
  )

  return { title, titleJapanese, length, tags, links }
}

export interface ImagePage {
  readonly image: Option.Option<string>
  readonly original: Option.Option<string>
}

export const parseImagePage = (html: string): ImagePage => ({
  image: Option.map(nonEmpty(/<img id="img" src="([^"]+)"/.exec(html)?.[1]), decodeEntities),
  original: Option.map(nonEmpty(/hentai\.org(\/fullimg[^"]+)"/.exec(html)?.[1]), decodeEntities),
})

export const explainOriginalPage = (body: string) => {
  if (/requires GP|insufficient (?:funds|GP)|not enough GP/i.test(body)) {
    return new ReducedQualityOnly({ reason: 'not-enough-gp' })
  }

  if (/temporarily banned/i.test(body)) {
    return problem('limit', 'ExHentai has banned this account for a while. Resume later.')
  }

  return problem('failed', 'ExHentai sent a page instead of the original image.')
}

const imageLimitUsedUp = () =>
  problem('limit', "ExHentai's image limit is used up. Resume once it has recovered.")

const makePage = (
  root: string,
  gid: string,
  number: number,
  key: string,
  context: SourceContext,
): GalleryPage => ({
  number,
  image: (reduced) =>
    Effect.gen(function* () {
      const pageUrl = `${root}/s/${key}/${gid}-${number}`

      yield* politePause(context)

      const page = parseImagePage(yield* fetchPage(pageUrl, context))

      const image = yield* Option.match(page.image, {
        onNone: () => Effect.fail(problem('failed', 'ExHentai changed how it shows pages.')),
        onSome: Effect.succeed,
      })

      if (/\/509s?\.gif$/.test(image)) {
        return yield* imageLimitUsedUp()
      }

      const headers = { Referer: pageUrl }
      const wantsOriginal = context.settings.exhentaiQuality === 'original' && !reduced

      if (!wantsOriginal || Option.isNone(page.original)) {
        return { url: image, headers }
      }

      if (!isSignedIn(context.session)) {
        return yield* new ReducedQualityOnly({ reason: 'signed-out' })
      }

      return {
        url: `${root}${page.original.value}`,
        headers,
        explainPage: explainOriginalPage,
      }
    }),
})

export const imageLimits = (html: string) => {
  const at = html.search(/image limits?/i)
  const section = at === -1 ? html : html.slice(at, at + 600)
  const match = /<strong>([\d,]+)<\/strong>\D{0,60}?<strong>([\d,]+)<\/strong>/.exec(section)

  return Option.map(
    Option.fromNullishOr(match),
    (found) => `Image limits ${found[1] ?? '?'} of ${found[2] ?? '?'}`,
  )
}

const fetchHome = (context: SourceContext) =>
  send('https://e-hentai.org/home.php', context, { redirects: 'manual' }).pipe(
    Effect.flatMap((response) =>
      response.status >= 300 && response.status < 400
        ? Effect.fail(
            problem(
              'sign-in',
              'E-Hentai sent Wenbu to its login page: the sign-in did not take. Sign in again.',
            ),
          )
        : expectOk(response),
    ),
    Effect.flatMap(readText),
  )

const keepCookies = (session: Session, set: Cookies.Cookies, url: string): Session => {
  const host = URL.parse(url)?.hostname ?? ''

  const added = Object.values(set.cookies).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.options?.domain ?? host,
  }))

  return {
    ...session,
    cookies: [
      ...session.cookies.filter((cookie) => !added.some((next) => next.name === cookie.name)),
      ...added,
    ],
  }
}

const handshakeHops = 6

/** Letting the HTTP client follow exhentai.org's redirects loses the cookies set on the way. */
export const visitExHentai = Effect.fnUntraced(function* (context: SourceContext, start: Session) {
  let session = start
  let url = 'https://exhentai.org/'

  for (let hop = 0; hop < handshakeHops; hop++) {
    const response = yield* send(
      url,
      { ...context, session: Option.some(session) },
      {
        redirects: 'manual',
      },
    )

    session = keepCookies(session, response.cookies, url)

    const location = response.headers['location']

    if (response.status < 300 || response.status >= 400 || location === undefined) {
      return { body: yield* readText(response), session }
    }

    url = new URL(location, url).href
  }

  return yield* problem('failed', 'exhentai.org kept redirecting Wenbu. Try again later.')
})

export const ExHentai: GallerySource = {
  id: 'exhentai',
  matches: (url) =>
    /^(www\.)?(e-|ex)hentai\.org$/i.test(url.hostname) && galleryPattern.test(url.pathname),
  // ExHentai bans accounts that load many pages at once.
  pageConcurrency: 1,
  signIn: {
    url: 'https://forums.e-hentai.org/index.php?act=Login&CODE=00',
    instructions:
      'Sign in on the E-Hentai forum in the browser Wenbu opened, then close the browser.',
    sites: ['e-hentai.org', 'exhentai.org'],
    storageKeys: [],
    accepts: (session) => isSignedIn(Option.some(session)),
  },
  resolve: (url, context) =>
    Effect.gen(function* () {
      const [, gid = '', token = ''] = galleryPattern.exec(url.pathname) ?? []
      const root = rootFor(context)
      const galleryUrl = `${root}/g/${gid}/${token}/`

      const first = yield* fetchPage(galleryUrl, context).pipe(
        Effect.catchTag('SourceProblem', (error) =>
          error.reason === 'not-found' && url.hostname.startsWith('ex') && root !== url.origin
            ? Effect.fail(
                problem(
                  'sign-in',
                  'This gallery is only on ExHentai. Sign in with an account that can open it.',
                ),
              )
            : Effect.fail(error),
        ),
      )

      if (/Key missing|Gallery not found|Gallery Not Available|has been removed/i.test(first)) {
        return yield* problem('not-found', 'ExHentai has no gallery at this link.')
      }

      const listing = parseGallery(first, gid)
      const keys = new Map(listing.links)

      for (let index = 1; keys.size < listing.length; index++) {
        yield* politePause(context)

        const next = parseGallery(yield* fetchPage(`${galleryUrl}?p=${index}`, context), gid)
        const before = keys.size

        for (const [number, key] of next.links) {
          keys.set(number, key)
        }

        if (keys.size === before) {
          break
        }
      }

      return {
        id: gid,
        title: Option.getOrElse(
          Option.orElse(listing.title, () => listing.titleJapanese),
          () => `Gallery ${gid}`,
        ),
        titleJapanese: listing.titleJapanese,
        tags: listing.tags,
        artists: listing.tags
          .filter((tag) => tag.startsWith('artist:'))
          .map((tag) => tag.slice('artist:'.length)),
        pages: [...keys]
          .toSorted(([left], [right]) => left - right)
          .map(([number, key]) => makePage(root, gid, number, key, context)),
      }
    }),
  check: (context) =>
    Effect.gen(function* () {
      if (Option.isNone(context.session) || !isSignedIn(context.session)) {
        return yield* problem('sign-in', 'Sign in to ExHentai first.')
      }

      const limits = imageLimits(yield* fetchHome(context))
      const ex = yield* visitExHentai(context, context.session.value)

      const access = hasExAccess(Option.some(ex.session)) && ex.body.trim() !== ''

      return {
        detail: [Option.getOrUndefined(limits), access ? 'ExHentai access' : 'E-Hentai only']
          .filter((part) => part !== undefined)
          .join(' · '),
        session: ex.session,
      }
    }),
}
