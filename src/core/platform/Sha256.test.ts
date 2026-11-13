import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Crypto, Effect } from 'effect'
import { Hex } from 'effect/encoding'
import { Sha256 } from './Sha256'

const text = (value: string) => new TextEncoder().encode(value)

const hashOf = (...chunks: ReadonlyArray<Uint8Array>) => {
  const hash = new Sha256()

  for (const chunk of chunks) {
    hash.update(chunk)
  }

  return Hex.encode(hash.digest())
}

describe('Sha256', () => {
  it('matches the published test vectors', () => {
    expect(hashOf()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')

    expect(hashOf(text('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )

    expect(hashOf(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )

    expect(hashOf(text('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  it.effect('gives the same digest as Crypto for data split into any chunks', () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const data = yield* crypto.randomBytes(300_001)
      const expected = Hex.encode(yield* crypto.digest('SHA-256', data))

      expect(hashOf(data)).toBe(expected)
      expect(hashOf(data.subarray(0, 1), data.subarray(1, 64), data.subarray(64))).toBe(expected)

      const pieces: Array<Uint8Array> = []

      for (let at = 0; at < data.length; at += 997) {
        pieces.push(data.subarray(at, at + 997))
      }

      expect(hashOf(...pieces)).toBe(expected)
    }).pipe(Effect.provide(NodeServices.layer)),
  )
})
