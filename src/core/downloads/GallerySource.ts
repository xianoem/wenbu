import { Context, Effect, Option, Schema } from 'effect'
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import type { SessionCookie } from '#contract/CoreMessages'
import { type DownloadSettings, ProblemReason, type SourceId } from '#contract/Downloads'
import { nonEmpty } from '../platform/Text'

export const Pacing = Context.Reference<number>('wenbu/core/downloads/Pacing', {
  defaultValue: () => 1,
})

export const pause = Effect.fnUntraced(function* (seconds: number) {
  const scale = yield* Pacing

  yield* Effect.sleep(`${Math.round(seconds * scale * 1000)} millis`)
})

export const Session = Schema.Struct({
  cookies: Schema.Array(
    Schema.Struct({ name: Schema.String, value: Schema.String, domain: Schema.String }),
  ),
  userAgent: Schema.String,
  storage: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export type Session = typeof Session.Type

export class SourceProblem extends Schema.TaggedError<SourceProblem>()('SourceProblem', {
  reason: ProblemReason,
  message: Schema.String,
  transient: Schema.optional(Schema.Boolean),
}) {}

export class ReducedQualityOnly extends Schema.TaggedError<ReducedQualityOnly>()(
  'ReducedQualityOnly',
  { reason: Schema.Literals(['not-enough-gp', 'signed-out']) },
) {}

export interface SourceContext {
  readonly session: Option.Option<Session>
  readonly userAgent: string
  readonly settings: DownloadSettings
}

export interface ImageRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly explainPage?: (body: string) => SourceProblem | ReducedQualityOnly
}

export interface GalleryPage {
  readonly number: number
  readonly image: (
    reduced: boolean,
  ) => Effect.Effect<ImageRequest, SourceProblem | ReducedQualityOnly, HttpClient.HttpClient>
}

export interface Gallery {
  readonly id: string
  readonly title: string
  readonly titleJapanese: Option.Option<string>
  readonly tags: ReadonlyArray<string>
  readonly artists: ReadonlyArray<string>
  readonly pages: ReadonlyArray<GalleryPage>
}

export interface CheckResult {
  readonly detail?: string
  readonly session?: Session
}

export interface SignInPage {
  readonly url: string
  readonly instructions: string
  readonly sites: ReadonlyArray<string>
  readonly storageKeys: ReadonlyArray<string>
  readonly accepts: (session: Session) => boolean
}

export const storageValue = (session: Option.Option<Session>, key: string) =>
  Option.flatMap(session, (found) => nonEmpty(found.storage?.[key]))

export interface GallerySource {
  readonly id: SourceId
  readonly matches: (url: URL) => boolean
  readonly pageConcurrency: number
  readonly signIn?: SignInPage
  readonly resolve: (
    url: URL,
    context: SourceContext,
  ) => Effect.Effect<Gallery, SourceProblem, HttpClient.HttpClient>
  readonly check: (
    context: SourceContext,
  ) => Effect.Effect<CheckResult, SourceProblem, HttpClient.HttpClient>
}

export const problem = (reason: ProblemReason, message: string) =>
  new SourceProblem({ reason, message })

const transientProblem = (message: string) =>
  new SourceProblem({ reason: 'network', message, transient: true })

const domainMatches = (host: string, cookie: SessionCookie) => {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase()

  return host === domain || host.endsWith(`.${domain}`)
}

export const cookieHeader = (session: Option.Option<Session>, url: string, extra = '') => {
  const host = URL.parse(url)?.hostname.toLowerCase() ?? ''

  const cookies = Option.match(session, {
    onNone: () => [],
    onSome: (found) => found.cookies.filter((cookie) => domainMatches(host, cookie)),
  })

  return [...cookies.map((cookie) => `${cookie.name}=${cookie.value}`), extra]
    .filter((part) => part !== '')
    .join('; ')
}

export const findCookie = (session: Option.Option<Session>, name: string) =>
  Option.flatMap(session, (found) =>
    Option.fromNullishOr(found.cookies.find((cookie) => cookie.name === name)?.value),
  )

export interface RequestOptions {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly extraCookies?: string
  readonly redirects?: 'follow' | 'manual'
}

const maxRedirects = 10

export const headersFor = (
  context: SourceContext,
  url: string,
  options: RequestOptions = {},
): Record<string, string> => {
  const cookie = cookieHeader(context.session, url, options.extraCookies)

  return {
    'User-Agent': Option.match(context.session, {
      onNone: () => context.userAgent,
      onSome: (found) => found.userAgent,
    }),
    ...(cookie === '' ? {} : { Cookie: cookie }),
    ...options.headers,
  }
}

const hostOf = (url: string) => URL.parse(url)?.hostname ?? url

export const send = Effect.fnUntraced(function* (
  url: string,
  context: SourceContext,
  options: RequestOptions = {},
) {
  const base = yield* HttpClient.HttpClient

  const client =
    options.redirects === 'manual' ? base : base.pipe(HttpClient.followRedirects(maxRedirects))

  const make = options.method === 'POST' ? HttpClientRequest.post : HttpClientRequest.get
  const request = make(url).pipe(HttpClientRequest.setHeaders(headersFor(context, url, options)))

  const response = yield* client.execute(request).pipe(
    Effect.mapError(() => transientProblem(`${hostOf(url)} could not be reached.`)),
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () => Effect.fail(transientProblem(`${hostOf(url)} did not answer.`)),
    }),
  )

  if (response.status === 429 || response.status >= 500) {
    return yield* transientProblem(`${hostOf(url)} is busy (${response.status}).`)
  }

  return response
})

export const readText = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.mapError(() => transientProblem('The connection dropped while reading the answer.')),
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () => Effect.fail(transientProblem('The site stopped sending its answer.')),
    }),
  )

export const readJson = <S extends Schema.Top>(
  response: HttpClientResponse.HttpClientResponse,
  schema: S,
) =>
  Effect.flatMap(readText(response), (text) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(() =>
        problem('failed', `${hostOf(response.request.url)} sent an answer Wenbu could not read.`),
      ),
    ),
  )

export const expectOk = (
  response: HttpClientResponse.HttpClientResponse,
  onStatus: (status: number) => Option.Option<SourceProblem> = () => Option.none(),
) => {
  if (response.status >= 200 && response.status < 300) {
    return Effect.succeed(response)
  }

  return Effect.fail(
    Option.getOrElse(onStatus(response.status), () =>
      response.status === 404
        ? problem('not-found', 'The site has no gallery at this link.')
        : problem('failed', `${hostOf(response.request.url)} answered ${response.status}.`),
    ),
  )
}
