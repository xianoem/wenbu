export interface ArchiveEntry {
  readonly path: string
  readonly read: () => Uint8Array
}

const header = Buffer.from('RGSSAD\0\x03', 'latin1')

const nextKey = (key: number) => (Math.imul(key, 7) + 3) >>> 0

const xorWithKey = (input: Uint8Array, key: number) =>
  input.map((byte, index) => byte ^ ((key >>> ((index % 4) * 8)) & 0xff))

const decryptPayload = (input: Uint8Array, fileKey: number) => {
  const output = Uint8Array.from(input)
  let key = fileKey >>> 0

  for (let offset = 0; offset < output.length; offset += 4) {
    for (let index = 0; index < 4 && offset + index < output.length; index++) {
      output[offset + index]! ^= (key >>> (index * 8)) & 0xff
    }

    key = nextKey(key)
  }

  return output
}

export const readArchive = (archive: Uint8Array): ReadonlyArray<ArchiveEntry> => {
  const view = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)

  if (view.length < 12 || !view.subarray(0, header.length).equals(header)) {
    throw new Error('Game.rgss3a is not an RGSS3A archive.')
  }

  const key = (Math.imul(view.readUInt32LE(header.length), 9) + 3) >>> 0
  const entries: Array<ArchiveEntry> = []
  let offset = header.length + 4

  const next = () => {
    const value = (view.readUInt32LE(offset) ^ key) >>> 0

    offset += 4

    return value
  }

  while (offset + 16 <= view.length) {
    const dataOffset = next()

    if (dataOffset === 0) {
      break
    }

    const size = next()
    const fileKey = next()
    const pathLength = next()

    if (pathLength <= 0 || offset + pathLength > view.length || dataOffset + size > view.length) {
      break
    }

    const path = Buffer.from(xorWithKey(view.subarray(offset, offset + pathLength), key)).toString(
      'utf-8',
    )

    offset += pathLength

    entries.push({
      path,
      read: () => decryptPayload(view.subarray(dataOffset, dataOffset + size), fileKey),
    })
  }

  return entries
}
