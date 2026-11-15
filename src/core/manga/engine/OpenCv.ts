import { createRequire } from 'node:module'
import type cvTypes from '@techstark/opencv-js'
import { Context, Effect, Layer } from 'effect'

export type Cv = typeof cvTypes

/** OpenCV compiled to WebAssembly. The package exports a promise of the initialised module. */
export class OpenCv extends Context.Service<OpenCv, { readonly cv: Cv }>()(
  'wenbu/core/manga/engine/OpenCv',
) {
  static readonly layer = Layer.effect(
    OpenCv,
    Effect.map(
      Effect.promise(
        // SAFETY: the package's main export is a promise of the OpenCV module its types describe.
        () => createRequire(import.meta.url)('@techstark/opencv-js') as Promise<Cv>,
      ),
      (cv) => ({ cv }),
    ),
  )
}
