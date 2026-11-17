import { describe, expect, it } from '@effect/vitest'
import { engineStarted, modelUrl } from './MangaEngine'
import models from './mangaEngineModels.json' with { type: 'json' }

describe('MangaEngine', () => {
  it('downloads each model from the GitHub release it was published in', () => {
    expect(modelUrl('manga-engine-models-1', 'detect.onnx')).toBe(
      'https://github.com/xianoem/wenbu/releases/download/manga-engine-models-1/detect.onnx',
    )
  })

  it('pins every file the engine reads, with its licences', () => {
    const names = models.files.map((file) => file.name)

    for (const name of [
      'detect.onnx',
      'lama.onnx',
      'reader.weights',
      'reader-tokenizer.json',
      'langid.bin',
      'MODELS.md',
    ]) {
      expect(names).toContain(name)
    }

    expect(models.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes > 0)).toBe(
      true,
    )
  })

  it('counts the engine as started once it prints its ready line', () => {
    expect(engineStarted('{"event":"ready","protocol":2}\n')).toBe(true)
    expect(engineStarted("The reader's tokenizer could not be read.\n")).toBe(false)
  })
})
