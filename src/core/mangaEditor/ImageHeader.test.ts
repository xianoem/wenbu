import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { imageSizeOf } from './ImageHeader'

const bytes = (...parts: ReadonlyArray<ReadonlyArray<number>>) => new Uint8Array(parts.flat())

const u16be = (value: number) => [(value >> 8) & 0xff, value & 0xff]
const u32be = (value: number) => [...u16be(value >>> 16), ...u16be(value & 0xffff)]
const u16le = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32le = (value: number) => [...u16le(value & 0xffff), ...u16le(value >>> 16)]

describe('imageSizeOf', () => {
  it('reads a PNG from its IHDR chunk', () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13),
      [0x49, 0x48, 0x44, 0x52],
      u32be(4218),
      u32be(6031),
    )

    expect(imageSizeOf(png)).toEqual(Option.some({ width: 4218, height: 6031 }))
  })

  it('reads a JPEG from its frame header, past other segments', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe1],
      u16be(6),
      [0, 0, 0, 0],
      [0xff, 0xc0],
      u16be(17),
      [8],
      u16be(6031),
      u16be(4218),
    )

    expect(imageSizeOf(jpeg)).toEqual(Option.some({ width: 4218, height: 6031 }))
  })

  it('reads a lossy WebP', () => {
    const webp = bytes(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      u32le(100),
      [...'WEBPVP8 '].map((c) => c.charCodeAt(0)),
      u32le(80),
      [0, 0, 0, 0x9d, 0x01, 0x2a],
      u16le(800),
      u16le(1200),
    )

    expect(imageSizeOf(webp)).toEqual(Option.some({ width: 800, height: 1200 }))
  })

  it('says nothing about bytes that are no image it knows', () => {
    expect(imageSizeOf(new Uint8Array([1, 2, 3, 4]))).toEqual(Option.none())
  })
})
