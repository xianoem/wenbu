import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { MangaCv } from './MangaCv'

const fake = fileURLToPath(new URL('./__fixtures__/fake-manga-cv.mjs', import.meta.url))

const FakeHelper = Layer.unwrap(Effect.sync(() => MangaCv.layer(process.execPath, [fake]))).pipe(
  Layer.provide(NodeServices.layer),
)

describe('MangaCv', () => {
  layer(FakeHelper)((it) => {
    it.effect('sends a page and reads it back across many pipe chunks', () =>
      Effect.gen(function* () {
        const helper = yield* MangaCv
        const data = new Uint8Array(1200 * 900 * 3).map((_, index) => index % 251)

        yield* helper.put(7, { width: 1200, height: 900, channels: 3, data })

        const back = yield* helper.get(7)

        expect([back.width, back.height, back.channels]).toEqual([1200, 900, 3])
        expect(Buffer.compare(back.data, data)).toBe(0)
      }),
    )

    it.effect('reports what the helper says when an operation fails', () =>
      Effect.gen(function* () {
        const helper = yield* MangaCv
        const error = yield* Effect.flip(helper.resize(1, 2, 10, 10))

        expect(error.message).toContain('unknown operation 4')
      }),
    )
  })
})
