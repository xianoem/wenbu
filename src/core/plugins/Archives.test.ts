import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { strToU8, zipSync } from 'fflate'
import { readZip } from './Archives'

const texts = (files: ReadonlyArray<{ readonly path: string; readonly data: Uint8Array }>) =>
  Object.fromEntries(files.map((file) => [file.path, new TextDecoder().decode(file.data)]))

describe('Archives', () => {
  it.effect('reads only the zip entries the mapping keeps, under their new paths', () =>
    Effect.gen(function* () {
      const zip = zipSync({
        'pkg/resources/lib.dll': strToU8('library'),
        'pkg/resources/models/a.tflite': strToU8('model'),
        'pkg/README.md': strToU8('readme'),
        'pkg/resources/': new Uint8Array(),
      })

      const files = yield* readZip(zip, (name) =>
        name.startsWith('pkg/resources/') ? name.slice('pkg/resources/'.length) : undefined,
      )

      expect(texts(files)).toEqual({ 'lib.dll': 'library', 'models/a.tflite': 'model' })
    }),
  )

  it.effect('fails on data that is not an archive', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readZip(strToU8('not a zip'), (name) => name))

      expect(error.message).toBe('The download is not a valid archive.')
    }),
  )
})
