import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { chooseTorch, models } from './MangaImageTranslator'

describe('chooseTorch', () => {
  it('picks the newest CUDA build the driver runs', () => {
    expect(
      chooseTorch(Option.some('NVIDIA GeForce RTX 3070 Laptop GPU, 527.99\n'), 'win32').manifest,
    ).toEqual({
      torchBackend: 'cu118',
      gpu: 'NVIDIA GeForce RTX 3070 Laptop GPU',
      driver: '527.99',
    })

    expect(
      chooseTorch(Option.some('NVIDIA GeForce RTX 5090, 581.42'), 'win32').manifest.torchBackend,
    ).toBe('cu128')

    expect(
      chooseTorch(Option.some('NVIDIA GeForce RTX 4070, 560.94'), 'win32').manifest.torchBackend,
    ).toBe('cu126')
  })

  it('compares driver versions part by part', () => {
    expect(chooseTorch(Option.some('GPU, 560.28.03'), 'linux').manifest.torchBackend).toBe('cu126')
    expect(chooseTorch(Option.some('GPU, 560.28.02'), 'linux').manifest.torchBackend).toBe('cu118')
  })

  it('falls back to the CPU without an NVIDIA GPU', () => {
    expect(chooseTorch(Option.none(), 'win32')).toMatchObject({ manifest: { torchBackend: 'cpu' } })
    expect(chooseTorch(Option.some(''), 'win32').manifest.torchBackend).toBe('cpu')
  })

  it('says why an old driver gets the CPU build', () => {
    const choice = chooseTorch(Option.some('NVIDIA GeForce GTX 970, 472.12'), 'win32')

    expect(choice.manifest.torchBackend).toBe('cpu')
    expect(choice.detail).toContain('Update the NVIDIA driver')
  })
})

describe('models', () => {
  it('go where upstream looks for them', () => {
    expect(models.map((model) => model.file.split('/')[0])).toEqual([
      'detection',
      'ocr',
      'ocr',
      'inpainting',
    ])
  })
})
