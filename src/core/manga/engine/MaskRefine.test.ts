// The test is skipped, synchronously, when `pnpm build:native` has not built the helper.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { decode } from 'fast-png'
import { Images } from './Images'
import { MangaCv } from './MangaCv'
import { refineMask } from './MaskRefine'
import { OpenCv } from './OpenCv'
import lines from './__fixtures__/mask-lines.json'

/** A drawn page refined by the plugin's own mask_refinement.dispatch; needs `pnpm build:native`. */
const helperExe = fileURLToPath(
  new URL(
    `../../../../resources/native/${process.platform}-${process.arch}/wenbu-manga-cv.exe`,
    import.meta.url,
  ),
)

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))
const require = createRequire(import.meta.url)

const Live = Layer.mergeAll(
  Images.layer({
    jpeg: require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    webp: require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
  }),
  OpenCv.layer,
  MangaCv.layer(helperExe),
).pipe(Layer.provideMerge(NodeServices.layer))

describe.skipIf(!existsSync(helperExe))('refineMask', () => {
  layer(Live)((it) => {
    it.effect('refines a page mask exactly as the plugin does', () =>
      Effect.gen(function* () {
        const images = yield* Images
        const helper = yield* MangaCv
        const { cv } = yield* OpenCv
        const page = yield* images.read(fixture('mask-page.png'))
        const raw = decode(readFileSync(fixture('mask-raw.png')))

        yield* helper.put(1, { ...page, channels: 3 })

        const mask = yield* refineMask(
          cv,
          helper,
          page,
          { width: raw.width, height: raw.height, data: Uint8Array.from(raw.data) },
          lines.map((line) => line.map(([x = 0, y = 0]) => ({ x, y }))),
        )

        expect(
          Buffer.compare(
            mask,
            Uint8Array.from(decode(readFileSync(fixture('mask-refined.png'))).data),
          ),
        ).toBe(0)
      }),
    )
  })
})
