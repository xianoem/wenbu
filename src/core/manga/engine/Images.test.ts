import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Crypto, Effect, Layer } from 'effect'
import { Hex } from 'effect/encoding'
import { Images } from './Images'
import expected from './__fixtures__/pages.json'

const require = createRequire(import.meta.url)
const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

const ImagesLive = Images.layer({
  jpeg: require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  webp: require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
}).pipe(Layer.provideMerge(NodeServices.layer))

describe('Images', () => {
  layer(ImagesLive)((it) => {
    for (const [name, digest] of Object.entries(expected)) {
      it.effect(`decodes ${name} to the same RGB as Pillow`, () =>
        Effect.gen(function* () {
          const images = yield* Images
          const crypto = yield* Crypto.Crypto
          const image = yield* images.read(fixture(name))
          const hash = yield* crypto.digest('SHA-256', image.data)

          expect([image.width, image.height]).toEqual([40, 24])
          expect(Hex.encode(new Uint8Array(hash))).toBe(digest)
        }),
      )
    }
  })
})
