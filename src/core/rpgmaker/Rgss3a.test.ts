import { describe, expect, it } from '@effect/vitest'
import { readArchive } from './Rgss3a'

const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4)

  bytes.writeUInt32LE(value >>> 0)

  return [...bytes]
}

const encryptPayload = (input: Buffer, fileKey: number) => {
  const output = Buffer.from(input)
  let key = fileKey

  for (let offset = 0; offset < output.length; offset += 4) {
    for (let index = 0; index < 4 && offset + index < output.length; index++) {
      output[offset + index]! ^= (key >>> (index * 8)) & 0xff
    }

    key = (Math.imul(key, 7) + 3) >>> 0
  }

  return output
}

const makeArchive = (files: ReadonlyArray<readonly [string, string]>) => {
  const seed = 0x12345678
  const key = (Math.imul(seed, 9) + 3) >>> 0
  const fileKey = 0xaabbccdd
  const paths = files.map(([path]) => Buffer.from(path))
  const tableSize = paths.reduce((size, path) => size + 16 + path.length, 0) + 4
  let dataOffset = 12 + tableSize
  const table: Array<number> = []
  const payloads: Array<number> = []

  for (const [index, [, content]] of files.entries()) {
    const path = paths[index]!
    const payload = encryptPayload(Buffer.from(content), fileKey)

    for (const value of [dataOffset, payload.length, fileKey, path.length]) {
      table.push(...uint32(value ^ key))
    }

    table.push(...path.map((byte, at) => byte ^ ((key >>> ((at % 4) * 8)) & 0xff)))
    payloads.push(...payload)
    dataOffset += payload.length
  }

  return Uint8Array.from([
    ...Buffer.from('RGSSAD\0\x03', 'latin1'),
    ...uint32(seed),
    ...table,
    ...uint32(0 ^ key),
    ...payloads,
  ])
}

describe('Rgss3a', () => {
  const archive = makeArchive([
    ['Data\\Map001.rvdata2', 'map data'],
    ['Graphics\\Titles1\\Title.png', 'image'],
  ])

  it('lists and decrypts every entry of a version 3 archive', () => {
    expect(
      readArchive(archive).map((entry) => [entry.path, Buffer.from(entry.read()).toString()]),
    ).toEqual([
      ['Data\\Map001.rvdata2', 'map data'],
      ['Graphics\\Titles1\\Title.png', 'image'],
    ])
  })

  it('rejects files that are not archives', () => {
    expect(() => readArchive(Buffer.from('not an archive at all'))).toThrow('RGSS3A')
  })
})
