import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Crypto, Effect, Layer } from 'effect'
import { Hex } from 'effect/encoding'
import { Images } from './Images'
import { crop } from './PillowResize'
import { patchify, positionWeights } from './ReaderInput'
import cases from './__fixtures__/naflex.json'

const require = createRequire(import.meta.url)
const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

const ImagesLive = Images.layer({
  jpeg: require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  webp: require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
}).pipe(Layer.provideMerge(NodeServices.layer))

describe('ReaderInput', () => {
  layer(ImagesLive)((it) => {
    for (const { box, patches, size, pixels, weights } of cases) {
      it.effect(`matches the Hayai processor for ${box.join(',')} at ${patches} patches`, () =>
        Effect.gen(function* () {
          const images = yield* Images
          const crypto = yield* Crypto.Crypto
          const source = yield* images.read(fixture('resize-source.png'))
          const [left = 0, top = 0, right = 0, bottom = 0] = box
          const input = patchify(crop(source, left, top, right, bottom), patches)
          const grid = positionWeights(input.size.rows, input.size.columns)

          const digest = (data: Uint8Array) =>
            Effect.map(crypto.digest('SHA-256', data), (hash) => Hex.encode(new Uint8Array(hash)))

          expect([
            input.size.height,
            input.size.width,
            input.size.rows,
            input.size.columns,
          ]).toEqual(size)

          expect(yield* digest(input.pixels)).toBe(pixels)
          expect(yield* digest(new Uint8Array(grid.buffer))).toBe(weights)
        }),
      )
    }
  })
})
