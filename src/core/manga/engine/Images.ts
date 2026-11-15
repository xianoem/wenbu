import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js'
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js'
import { Context, Effect, FileSystem, Layer } from 'effect'
import { decode as decodePng } from 'fast-png'
import { MangaError } from '#contract/Manga'

/** Packed 8-bit RGB, row-major. */
export interface RgbImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export interface CodecFiles {
  readonly jpeg: string
  readonly webp: string
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const fromRgba = (width: number, height: number, rgba: Uint8ClampedArray | Uint8Array) => {
  const data = new Uint8Array(width * height * 3)

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 3] = rgba[pixel * 4] ?? 0
    data[pixel * 3 + 1] = rgba[pixel * 4 + 1] ?? 0
    data[pixel * 3 + 2] = rgba[pixel * 4 + 2] ?? 0
  }

  return { width, height, data }
}

/** Matches Pillow's `convert('RGB')`: alpha is dropped, grey is repeated, palettes are looked up, 16-bit keeps the high byte. */
const pngToRgb = (bytes: Uint8Array): RgbImage => {
  const png = decodePng(bytes)
  const { width, height, channels, depth } = png
  const rowBytes = Math.ceil((width * channels * depth) / 8)

  const packed = (pixel: number) => {
    const x = pixel % width
    const bit = x * depth
    const byte = png.data[Math.floor(pixel / width) * rowBytes + Math.floor(bit / 8)] ?? 0

    return (byte >> (8 - depth - (bit % 8))) & ((1 << depth) - 1)
  }

  const sample = (index: number) => {
    if (depth === 16) {
      return (png.data[index] ?? 0) >> 8
    }

    return png.data[index] ?? 0
  }

  const data = new Uint8Array(width * height * 3)

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (png.palette !== undefined) {
      const entry = png.palette[depth < 8 ? packed(pixel) : sample(pixel)] ?? [0, 0, 0]

      data[pixel * 3] = entry[0] ?? 0
      data[pixel * 3 + 1] = entry[1] ?? 0
      data[pixel * 3 + 2] = entry[2] ?? 0

      continue
    }

    if (channels < 3) {
      const grey =
        depth < 8
          ? Math.round((packed(pixel) * 255) / ((1 << depth) - 1))
          : sample(pixel * channels)

      data[pixel * 3] = grey
      data[pixel * 3 + 1] = grey
      data[pixel * 3 + 2] = grey

      continue
    }

    data[pixel * 3] = sample(pixel * channels)
    data[pixel * 3 + 1] = sample(pixel * channels + 1)
    data[pixel * 3 + 2] = sample(pixel * channels + 2)
  }

  return { width, height, data }
}

const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e

const isWebp = (bytes: Uint8Array) =>
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45

export class Images extends Context.Service<
  Images,
  { readonly read: (file: string) => Effect.Effect<RgbImage, MangaError> }
>()('wenbu/core/manga/engine/Images') {
  static readonly layer = (codecs: CodecFiles) =>
    Layer.effect(
      Images,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        const wasm = (file: string) =>
          fs
            .readFile(file)
            .pipe(Effect.mapError(() => failed(`The image decoder ${file} could not be loaded.`)))

        const jpegBinary = yield* wasm(codecs.jpeg)
        const webpBinary = yield* wasm(codecs.webp)

        yield* Effect.promise(() => initJpeg({ wasmBinary: jpegBinary }))
        yield* Effect.promise(() => initWebp({ wasmBinary: webpBinary }))

        const read = Effect.fn('Images.read')(function* (file: string) {
          const bytes = yield* fs
            .readFile(file)
            .pipe(Effect.mapError(() => failed(`The page ${file} could not be read.`)))

          if (isPng(bytes)) {
            return yield* Effect.try({
              try: () => pngToRgb(bytes),
              catch: () => failed(`The page ${file} is not a readable PNG.`),
            })
          }

          const decoded = yield* Effect.tryPromise({
            try: () => {
              const owned = bytes.slice().buffer

              return isWebp(bytes) ? decodeWebp(owned) : decodeJpeg(owned)
            },
            catch: () => failed(`The page ${file} could not be decoded.`),
          })

          return fromRgba(decoded.width, decoded.height, decoded.data)
        })

        return Images.of({ read })
      }),
    )
}
