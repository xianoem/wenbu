import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Crypto, Effect, FileSystem, Layer, Path } from 'effect'
import { Hex } from 'effect/encoding'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { download } from './Downloads'

const serving = (bytes: Uint8Array) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 70_001) {
            controller.enqueue(bytes.slice(at, at + 70_001))
          }

          controller.close()
        },
      })

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body, { headers: { 'content-length': String(bytes.length) } }),
        ),
      )
    }),
  )

describe('download', () => {
  it.effect('writes the file and hashes it as it arrives', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const bytes = yield* crypto.randomBytes(500_000)
      const target = path.join(yield* fs.makeTempDirectoryScoped(), 'model.gguf')
      const progress: Array<number> = []

      const result = yield* download('https://example.test/model.gguf', target, (done) =>
        Effect.sync(() => progress.push(done)),
      ).pipe(Effect.provide(serving(bytes)))

      expect(result).toEqual({
        sha256: Hex.encode(yield* crypto.digest('SHA-256', bytes)),
        bytes: bytes.length,
      })

      expect(yield* fs.readFile(target)).toEqual(bytes)
      expect(progress.at(-1)).toBe(bytes.length)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
