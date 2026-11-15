import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Images } from './Images'
import { crops } from './Inpaint'
import { OpenCv } from './OpenCv'
import expected from './__fixtures__/inpaint-crops.json'

const modules = createRequire(import.meta.url)
const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

const Live = Layer.mergeAll(
  Images.layer({
    jpeg: modules.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    webp: modules.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
  }),
  OpenCv.layer,
).pipe(Layer.provideMerge(NodeServices.layer))

describe('crops', () => {
  layer(Live)((it) => {
    it.effect('plans the same LaMa crops as the plugin', () =>
      Effect.gen(function* () {
        const images = yield* Images
        const { cv } = yield* OpenCv
        const mask = yield* images.read(fixture('inpaint-mask.png'), 'dropped')

        const grey = Uint8Array.from(
          { length: mask.width * mask.height },
          (_, p) => mask.data[p * 3] ?? 0,
        )

        expect(crops(cv, grey, mask.width, mask.height)).toEqual(expected)
      }),
    )
  })
})
