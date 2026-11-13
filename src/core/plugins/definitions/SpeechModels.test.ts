import { describe, expect, it } from '@effect/vitest'
import type { ComputeDevice } from './SpeechModel'
import { speechModelSpecs } from './SpeechModels'

const gib = 1024 ** 3

const cpu: ComputeDevice = { name: 'Ryzen 7', kind: 'cpu', type: 'cpu', memory: 64 * gib }

const integrated: ComputeDevice = {
  name: 'AMD Radeon(TM) Graphics',
  kind: 'vulkan',
  type: 'integrated',
  memory: 36 * gib,
}

const rtx3070: ComputeDevice = {
  name: 'NVIDIA GeForce RTX 3070 Laptop GPU',
  kind: 'vulkan',
  type: 'gpu',
  memory: 8 * gib,
}

const gtx1650: ComputeDevice = { name: 'GTX 1650', kind: 'vulkan', type: 'gpu', memory: 4 * gib }

const qwen = speechModelSpecs['qwen3-asr']

const senseVoice = speechModelSpecs['sensevoice-small']

describe('Qwen3-ASR', () => {
  it('picks the 1.7B for a discrete GPU with 6 GB or more', () => {
    expect(qwen.choose([integrated, rtx3070, cpu])).toEqual({
      size: '1.7B',
      gpu: 'NVIDIA GeForce RTX 3070 Laptop GPU',
    })
  })

  it("never counts an integrated GPU's shared memory as a big GPU", () => {
    expect(qwen.choose([integrated, cpu])).toEqual({
      size: '0.6B',
      gpu: 'AMD Radeon(TM) Graphics',
    })
  })

  it('picks the 0.6B for a small GPU or none', () => {
    expect(qwen.choose([gtx1650, cpu])).toEqual({ size: '0.6B', gpu: 'GTX 1650' })
    expect(qwen.choose([cpu])).toEqual({ size: '0.6B' })
  })
})

describe('single-file models', () => {
  it('keep their one file and name the GPU they will run on', () => {
    expect(senseVoice.choose([integrated, rtx3070, cpu])).toEqual({
      size: 'Q8_0',
      gpu: 'NVIDIA GeForce RTX 3070 Laptop GPU',
    })

    expect(senseVoice.choose([integrated, cpu])).toEqual({
      size: 'Q8_0',
      gpu: 'AMD Radeon(TM) Graphics',
    })

    expect(senseVoice.choose([cpu])).toEqual({ size: 'Q8_0' })
  })

  it('offers a file for every size they choose', () => {
    for (const spec of Object.values(speechModelSpecs)) {
      for (const devices of [[rtx3070], [gtx1650], [cpu]]) {
        expect(spec.sizes[spec.choose(devices).size]).toBeDefined()
      }
    }
  })
})
