import { Option } from 'effect'

export interface ImageSize {
  readonly width: number
  readonly height: number
}

const u16be = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
const u16le = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
const u24le = (bytes: Uint8Array, at: number) => u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16)
const u32be = (bytes: Uint8Array, at: number) => u16be(bytes, at) * 0x10000 + u16be(bytes, at + 2)
const i32le = (bytes: Uint8Array, at: number) => u16le(bytes, at) | (u16le(bytes, at + 2) << 16)

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

const sized = (width: number, height: number) =>
  width > 0 && height > 0 ? Option.some({ width, height }) : Option.none<ImageSize>()

// C4, C8 and CC fall in the frame range but are other markers.
const isFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

const jpegSize = (bytes: Uint8Array) => {
  let at = 2

  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) {
      return Option.none<ImageSize>()
    }

    const marker = bytes[at + 1] ?? 0

    if (isFrame(marker)) {
      return sized(u16be(bytes, at + 7), u16be(bytes, at + 5))
    }

    at += 2 + u16be(bytes, at + 2)
  }

  return Option.none<ImageSize>()
}

const webpSize = (bytes: Uint8Array) => {
  if (startsWith(bytes, ascii('VP8 '), 12)) {
    return sized(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff)
  }

  if (startsWith(bytes, ascii('VP8L'), 12)) {
    const bits = i32le(bytes, 21)

    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }

  if (startsWith(bytes, ascii('VP8X'), 12)) {
    return sized(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1)
  }

  return Option.none<ImageSize>()
}

export const imageSizeOf = (bytes: Uint8Array): Option.Option<ImageSize> => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return sized(u32be(bytes, 16), u32be(bytes, 20))
  }

  if (startsWith(bytes, [0xff, 0xd8])) {
    return jpegSize(bytes)
  }

  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return webpSize(bytes)
  }

  if (startsWith(bytes, ascii('GIF'))) {
    return sized(u16le(bytes, 6), u16le(bytes, 8))
  }

  if (startsWith(bytes, ascii('BM'))) {
    return sized(i32le(bytes, 18), Math.abs(i32le(bytes, 22)))
  }

  return Option.none<ImageSize>()
}
