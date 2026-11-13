import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { ScreenAiOcr } from './ScreenAiOcr'

const blank = (width: number, height: number) => ({
  width,
  height,
  pixels: new Uint8Array(width * height * 4).fill(255),
})

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fake = path.join(import.meta.dirname, '__fixtures__', 'fake-screen-ai.mjs')
  const starts = yield* fs.makeTempFileScoped()

  const layer = ScreenAiOcr.layer((folder) => ({
    command: process.execPath,
    args: [fake, '--resources', folder, '--starts', starts],
  }))

  const ocr = Context.get(yield* Layer.build(layer), ScreenAiOcr)

  const startedFolders = Effect.map(fs.readFileString(starts), (text) =>
    text.split('\n').filter(Boolean),
  )

  return { ocr, startedFolders }
})

describe('ScreenAiOcr', () => {
  it.live('keeps one helper running across requests for the same folder', () =>
    Effect.gen(function* () {
      const { ocr, startedFolders } = yield* setup

      const first = yield* ocr.recognize('plugins/153.05', blank(32, 16))

      yield* ocr.recognize('plugins/153.05', blank(32, 16))

      expect(first.paragraphs[0]?.lines[0]?.text).toBe('Wenbu detects text')
      expect(yield* startedFolders).toEqual(['plugins/153.05'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('starts a new helper when the plugin folder changes', () =>
    Effect.gen(function* () {
      const { ocr, startedFolders } = yield* setup

      yield* ocr.recognize('plugins/153.04', blank(8, 8))
      yield* ocr.recognize('plugins/153.05', blank(8, 8))

      expect(yield* startedFolders).toEqual(['plugins/153.04', 'plugins/153.05'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('reports a crash, then recovers with a fresh helper', () =>
    Effect.gen(function* () {
      const { ocr, startedFolders } = yield* setup

      const crash = yield* Effect.flip(ocr.recognize('plugins/153.05', blank(1, 1)))
      const after = yield* ocr.recognize('plugins/153.05', blank(8, 8))

      expect(crash.message).toBe('Screen AI stopped while reading the image.')
      expect(after.paragraphs).not.toHaveLength(0)
      expect(yield* startedFolders).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('scales large images to the size the library accepts, keeping the original size', () =>
    Effect.gen(function* () {
      const { ocr } = yield* setup

      const result = yield* ocr.recognize('plugins/153.05', blank(256, 128))

      expect(result.image).toEqual({ width: 256, height: 128 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
