import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { deflateSync } from 'fflate'
import { extractZipEntry, readZipEntry, readZipIndex } from './ZipIndex'

interface RawEntry {
  readonly name: Uint8Array
  readonly data: Uint8Array
  readonly deflate?: boolean
  readonly utf8Flag?: boolean
  readonly encrypted?: boolean
  readonly zip64?: boolean
}

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff]

const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]

const u64 = (value: number) => [...u32(value >>> 0), ...u32(Math.floor(value / 2 ** 32))]

const dosTime = (12 << 11) | (0 << 5)

const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 20

const zipOf = (entries: ReadonlyArray<RawEntry>) => {
  const local: Array<number> = []
  const central: Array<number> = []

  for (const entry of entries) {
    const body = entry.deflate === true ? deflateSync(entry.data) : entry.data
    const flags = (entry.utf8Flag === true ? 0x800 : 0) | (entry.encrypted === true ? 1 : 0)
    const method = entry.deflate === true ? 8 : 0
    const offset = local.length
    const big = entry.zip64 === true

    const extra = big
      ? [...u16(1), ...u16(24), ...u64(entry.data.length), ...u64(body.length), ...u64(offset)]
      : []

    local.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(0),
      ...u32(body.length),
      ...u32(entry.data.length),
      ...u16(entry.name.length),
      ...u16(0),
      ...entry.name,
      ...body,
    )

    central.push(
      ...u32(0x02014b50),
      ...u16(45),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(0),
      ...u32(big ? 0xffffffff : body.length),
      ...u32(big ? 0xffffffff : entry.data.length),
      ...u16(entry.name.length),
      ...u16(extra.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(big ? 0xffffffff : offset),
      ...entry.name,
      ...extra,
    )
  }

  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ]

  return Uint8Array.from([...local, ...central, ...end])
}

const utf8 = (text: string) => new TextEncoder().encode(text)

const shiftJisName = Uint8Array.from([
  0x83, 0x51, 0x81, 0x5b, 0x83, 0x80, 0x2f, 0x83, 0x66, 0x81, 0x5b, 0x83, 0x5e, 0x2e, 0x6a, 0x73,
  0x6f, 0x6e,
])

const writeZip = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-zip-' })
  const file = path.join(folder, 'update.zip')

  yield* fs.writeFile(file, bytes)

  return { folder, file }
})

describe('ZipIndex', () => {
  it.effect('lists entries with UTF-8, Shift-JIS and plain names', () =>
    Effect.gen(function* () {
      const { file } = yield* writeZip(
        zipOf([
          { name: utf8('ゲーム/www/data/System.json'), data: utf8('{}'), utf8Flag: true },
          { name: shiftJisName, data: utf8('[]') },
          { name: utf8('ゲーム/'), data: new Uint8Array(), utf8Flag: true },
          { name: utf8('Game.exe'), data: utf8('MZ') },
        ]),
      )

      const entries = yield* readZipIndex(file)

      expect(entries.map((entry) => [entry.name, entry.size, entry.directory])).toEqual([
        ['ゲーム/www/data/System.json', 2, false],
        ['ゲーム/データ.json', 2, false],
        ['ゲーム/', 0, true],
        ['Game.exe', 2, false],
      ])

      expect(entries[0]?.modifiedAt).toBe(Date.UTC(2026, 9, 20, 12))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('reads sizes and offsets from zip64 fields', () =>
    Effect.gen(function* () {
      const { file } = yield* writeZip(
        zipOf([
          { name: utf8('a.txt'), data: utf8('first'), zip64: true },
          { name: utf8('b.txt'), data: utf8('second one'), zip64: true },
        ]),
      )

      const entries = yield* readZipIndex(file)
      const second = entries[1]

      expect(entries.map((entry) => entry.size)).toEqual([5, 10])

      expect(
        second === undefined ? '' : new TextDecoder().decode(yield* readZipEntry(file, second)),
      ).toBe('second one')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('reads stored and deflated entries, and streams one to disk', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const big = utf8('こんにちは、世界。'.repeat(20_000))

      const { folder, file } = yield* writeZip(
        zipOf([
          { name: utf8('small.txt'), data: utf8('stored') },
          { name: utf8('big.txt'), data: big, deflate: true },
        ]),
      )

      const [small, large] = yield* readZipIndex(file)
      const target = path.join(folder, 'out', 'big.txt')

      yield* extractZipEntry(file, large!, target)

      expect(new TextDecoder().decode(yield* readZipEntry(file, small!))).toBe('stored')
      expect(large?.compressedSize).toBeLessThan(big.length)
      expect(Buffer.from(yield* fs.readFile(target)).equals(Buffer.from(big))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('refuses encrypted entries and files that are not zips', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const { folder, file } = yield* writeZip(
        zipOf([{ name: utf8('secret.txt'), data: utf8('x'), encrypted: true }]),
      )

      const notZip = path.join(folder, 'notes.zip')

      yield* fs.writeFileString(notZip, 'just text')

      const [secret] = yield* readZipIndex(file)
      const locked = yield* Effect.flip(readZipEntry(file, secret!))
      const broken = yield* Effect.flip(readZipIndex(notZip))

      expect(secret?.encrypted).toBe(true)
      expect(locked.message).toBe('The zip is password-protected. Unzip it first, then try again.')
      expect(broken.message).toBe('This file is not a zip archive, or it is damaged.')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
