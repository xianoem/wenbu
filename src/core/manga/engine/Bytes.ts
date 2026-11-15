/**
 * Byte arrays built element by element. `Uint8Array.from(source, fn)` goes through the iterator
 * protocol and takes about two seconds on a 26 MP page; a plain loop takes a few milliseconds.
 */

export const bytes = (length: number, at: (index: number) => number) => {
  const out = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    out[index] = at(index)
  }

  return out
}

export const mapBytes = (source: ArrayLike<number>, map: (value: number) => number) =>
  bytes(source.length, (index) => map(source[index] ?? 0))
