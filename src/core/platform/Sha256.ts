const roundConstants = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))

/** Effect's Crypto only hashes a whole buffer, and Node cannot read a file over 2 GB into one. */
export class Sha256 {
  private readonly state = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  private readonly block = new Uint8Array(64)
  private readonly words = new Uint32Array(64)
  private filled = 0
  private length = 0

  update(data: Uint8Array) {
    let at = 0

    this.length += data.length

    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, data.length)

      this.block.set(data.subarray(0, take), this.filled)
      this.filled += take
      at = take

      if (this.filled < 64) {
        return
      }

      this.compress(this.block, 0)
      this.filled = 0
    }

    for (; at + 64 <= data.length; at += 64) {
      this.compress(data, at)
    }

    this.block.set(data.subarray(at), 0)
    this.filled = data.length - at
  }

  digest() {
    const bits = this.length * 8

    this.block[this.filled++] = 0x80

    if (this.filled > 56) {
      this.block.fill(0, this.filled)
      this.compress(this.block, 0)
      this.filled = 0
    }

    this.block.fill(0, this.filled, 56)

    const view = new DataView(this.block.buffer)

    view.setUint32(56, Math.floor(bits / 2 ** 32))
    view.setUint32(60, bits >>> 0)
    this.compress(this.block, 0)

    const out = new Uint8Array(32)
    const outView = new DataView(out.buffer)

    this.state.forEach((value, index) => outView.setUint32(index * 4, value))

    return out
  }

  private compress(bytes: Uint8Array, offset: number) {
    const { words, state } = this

    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4

      words[index] =
        ((bytes[at] ?? 0) << 24) |
        ((bytes[at + 1] ?? 0) << 16) |
        ((bytes[at + 2] ?? 0) << 8) |
        (bytes[at + 3] ?? 0)
    }

    for (let index = 16; index < 64; index++) {
      const early = words[index - 15] ?? 0
      const late = words[index - 2] ?? 0
      const small0 = rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3)
      const small1 = rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10)

      words[index] = ((words[index - 16] ?? 0) + small0 + (words[index - 7] ?? 0) + small1) | 0
    }

    let a = state[0] ?? 0
    let b = state[1] ?? 0
    let c = state[2] ?? 0
    let d = state[3] ?? 0
    let e = state[4] ?? 0
    let f = state[5] ?? 0
    let g = state[6] ?? 0
    let h = state[7] ?? 0

    for (let index = 0; index < 64; index++) {
      const big1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choice = (e & f) ^ (~e & g)

      const first = (h + big1 + choice + (roundConstants[index] ?? 0) + (words[index] ?? 0)) | 0

      const big0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const second = (big0 + majority) | 0

      h = g
      g = f
      f = e
      e = (d + first) | 0
      d = c
      c = b
      b = a
      a = (first + second) | 0
    }

    state[0] = (state[0] ?? 0) + a
    state[1] = (state[1] ?? 0) + b
    state[2] = (state[2] ?? 0) + c
    state[3] = (state[3] ?? 0) + d
    state[4] = (state[4] ?? 0) + e
    state[5] = (state[5] ?? 0) + f
    state[6] = (state[6] ?? 0) + g
    state[7] = (state[7] ?? 0) + h
  }
}
