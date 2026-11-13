import { Effect, Exit, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'
import { pageImageUrl } from '#contract/PageImage'
import type { ImageKind } from '../mangaEditor'

export type FindImage = (request: {
  readonly payload: { readonly folder: string; readonly page: string; readonly kind: ImageKind }
}) => Promise<Exit.Exit<string, unknown>>

export class Unreadable extends Schema.TaggedError<Unreadable>()('Unreadable', {}) {}

const SEPARATOR = '\u0000'

const requestOf = (key: string) => {
  const [folder = '', page = '', kind = 'original', version = '0'] = key.split(SEPARATOR)
  const known: ReadonlyArray<ImageKind> = ['original', 'result', 'cleaned', 'brush']

  return {
    payload: { folder, page, kind: known.find((each) => each === kind) ?? 'original' },
    version: Number(version),
  }
}

const files = new Map<string, Promise<string>>()

export const pageFile = (find: FindImage, key: string) => {
  const known = files.get(key)

  if (known !== undefined) {
    return known
  }

  const finding = find({ payload: requestOf(key).payload }).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(new Unreadable()),
  )

  files.set(key, finding)
  finding.catch(() => files.delete(key))

  return finding
}

export const pageUrl = (find: FindImage, key: string) =>
  pageFile(find, key).then((file) => pageImageUrl(file, requestOf(key).version))

const ahead = new Map<string, HTMLImageElement>()

const AHEAD_KEPT = 4

export const preload = (find: FindImage, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    void pageUrl(find, key).then(
      (url) => {
        if (ahead.has(url)) {
          return
        }

        const image = new Image()

        image.decoding = 'async'
        image.src = url
        image.decode().catch(() => undefined)
        ahead.set(url, image)

        for (const old of ahead.keys()) {
          if (ahead.size <= AHEAD_KEPT) {
            break
          }

          ahead.delete(old)
        }
      },
      () => undefined,
    )
  }
}

export const fullBitmap = (find: FindImage, key: string) =>
  Effect.gen(function* () {
    const url = yield* Effect.tryPromise({
      try: () => pageUrl(find, key),
      catch: () => new Unreadable(),
    })

    const response = yield* HttpClient.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((ok) => ok.arrayBuffer),
      Effect.mapError(() => new Unreadable()),
    )

    return yield* Effect.tryPromise({
      try: () => createImageBitmap(new Blob([response])),
      catch: () => new Unreadable(),
    })
  }).pipe(Effect.provide(FetchHttpClient.layer))
