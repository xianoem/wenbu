import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Crypto, Effect, Layer } from 'effect'
import { Hex } from 'effect/encoding'
import { Images } from './Images'
import { crop, pillowResize } from './PillowResize'
import expected from './__fixtures__/resize.json'

const require = createRequire(import.meta.url)
const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

const ImagesLive = Images.layer({
  jpeg: require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  webp: require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
}).pipe(Layer.provideMerge(NodeServices.layer))

describe('pillowResize', () => {
  layer(ImagesLive)((it) => {
    for (const [size, digest] of Object.entries(expected)) {
      it.effect(`matches Pillow for ${size}`, () =>
        Effect.gen(function* () {
          const images = yield* Images
          const crypto = yield* Crypto.Crypto
          const source = yield* images.read(fixture('resize-source.png'))
          const lanczos = size.startsWith('lanczos-')
          const [width = 0, height = 0] = size.replace('lanczos-', '').split('x').map(Number)

          const image =
            size === 'crop'
              ? crop(source, -5, 10, 40, 80)
              : pillowResize(source, width, height, lanczos ? 'lanczos' : 'bilinear')

          const hash = yield* crypto.digest('SHA-256', image.data)

          expect(Hex.encode(new Uint8Array(hash))).toBe(digest)
        }),
      )
    }
  })
})
