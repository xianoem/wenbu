import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { probeOf } from './TensorRtRtx'

describe('TensorRtRtx', () => {
  it("reads the engine's probe from the end of its output", () => {
    expect(
      probeOf(
        'Could not load symbol cuStreamGetGreenCtx. Error code 127\n{"backend":"TensorRT-RTX","device":"NVIDIA GeForce RTX 3070 Laptop GPU"}\n',
      ),
    ).toEqual(
      Option.some({ backend: 'TensorRT-RTX', device: 'NVIDIA GeForce RTX 3070 Laptop GPU' }),
    )
  })

  it('finds no probe when the engine printed none', () => {
    expect(probeOf('The NVIDIA pack could not be loaded.\n')).toEqual(Option.none())
  })
})
