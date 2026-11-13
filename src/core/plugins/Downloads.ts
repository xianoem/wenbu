import { Effect, FileSystem, Option, type Schema, Stream } from 'effect'
import { Hex } from 'effect/encoding'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { PluginError } from '#contract/Plugins'
import { Sha256 } from '../platform/Sha256'

const unavailable = (message: string) => new PluginError({ reason: 'unavailable', message })

const withAgent = HttpClientRequest.setHeader('User-Agent', 'Wenbu')

export const getJson = <S extends Schema.Top>(
  url: string,
  schema: S,
  request = HttpClientRequest.get(url),
) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const host = URL.parse(url)?.host ?? url

    const response = yield* client
      .execute(withAgent(request))
      .pipe(Effect.mapError(() => unavailable(`${host} could not be reached.`)))

    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(() => unavailable(`${host} sent an answer Wenbu could not read.`)),
    )
  })

export const contentLength = (url: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const response = yield* client.execute(withAgent(HttpClientRequest.head(url)))
    const length = Number(response.headers['content-length'])

    return Number.isFinite(length) && length > 0 ? Option.some(length) : Option.none()
  }).pipe(Effect.orElseSucceed(() => Option.none<number>()))

export const download = Effect.fn('download')(function* (
  url: string,
  file: string,
  onProgress: (done: number, total: number | undefined) => Effect.Effect<void>,
) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const fs = yield* FileSystem.FileSystem
  const host = URL.parse(url)?.host ?? url

  const response = yield* client
    .execute(withAgent(HttpClientRequest.get(url)))
    .pipe(Effect.mapError(() => unavailable(`${host} could not be reached.`)))

  const length = Number(response.headers['content-length'])
  const total = Number.isFinite(length) && length > 0 ? length : undefined
  let done = 0
  let reported = 0
  const hash = new Sha256()

  yield* response.stream.pipe(
    Stream.tap((chunk) => {
      done += chunk.length
      hash.update(chunk)

      const step = total === undefined ? 1_048_576 : total / 100

      if (done - reported < step) {
        return Effect.void
      }

      reported = done

      return onProgress(done, total)
    }),
    Stream.run(fs.sink(file)),
    Effect.mapError(() => unavailable(`The download from ${host} did not finish.`)),
  )

  yield* onProgress(done, total ?? done)

  // Hashed as it arrived: reading a multi-gigabyte model back in one piece fails in Node.
  return { sha256: Hex.encode(hash.digest()), bytes: done }
})
