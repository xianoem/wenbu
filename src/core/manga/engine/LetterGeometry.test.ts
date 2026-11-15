import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Images } from './Images'
import { constrainGeometries, renderGeometry, safeArea, type LetterRegion } from './LetterGeometry'
import { OpenCv } from './OpenCv'
import expected from './__fixtures__/letter-geometry.json'

const modules = createRequire(import.meta.url)
const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

const Live = Layer.mergeAll(
  Images.layer({
    jpeg: modules.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    webp: modules.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
  }),
  OpenCv.layer,
).pipe(Layer.provideMerge(NodeServices.layer))

const count = (mask: Uint8Array | undefined) =>
  mask === undefined ? null : mask.filter((value) => value > 0).length

describe('LetterGeometry', () => {
  layer(Live)((it) => {
    it.effect('places lettering like the plugin', () =>
      Effect.gen(function* () {
        const images = yield* Images
        const { cv } = yield* OpenCv
        const page = yield* images.read(fixture('letter-page.png'))

        const regions = expected.map(({ region }): LetterRegion => ({
          xyxy: [
            region.xyxy[0] ?? 0,
            region.xyxy[1] ?? 0,
            region.xyxy[2] ?? 0,
            region.xyxy[3] ?? 0,
          ],
          text: region.text,
          translation: region.translation,
          vertical: region.vertical,
        }))

        const geometries = regions.map((region) => renderGeometry(cv, page, region))
        const constrained = constrainGeometries(regions, geometries)

        const ours = geometries.map((geometry, index) => {
          const settled = constrained[index] ?? geometry
          const [x1, y1, x2, y2] = settled.box

          const safe =
            settled.mask === undefined ? undefined : safeArea(cv, settled.mask, x2 - x1, y2 - y1, 5)

          return {
            box: [...geometry.box],
            maskSum: count(geometry.mask),
            constrained: [...settled.box],
            constrainedSum: count(settled.mask),
            safe: safe === undefined ? null : [...safe],
          }
        })

        expect(ours).toEqual(
          expected.map(({ box, maskSum, constrained, constrainedSum, safe }) => ({
            box,
            maskSum,
            constrained,
            constrainedSum,
            safe,
          })),
        )
      }),
    )
  })
})
