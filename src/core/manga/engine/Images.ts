import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js'
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { decode as decodePng, encode as encodePng } from 'fast-png'
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

/**
 * What happens to transparency: `white` composites onto white like the worker's load_image does for
 * pages, `dropped` discards it like Pillow's convert('RGB') does for masks and brush strokes.
 */
export type Alpha = 'white' | 'dropped'

const failed = (message: string) => new MangaError({ reason: 'failed', message })

/** Pillow's paste onto white through an alpha mask: DIV255(white * (255 - a) + value * a). */
const onWhite = (value: number, alpha: number) => {
  const tmp = 255 * (255 - alpha) + value * alpha + 128

  return ((tmp >> 8) + tmp) >> 8
}

const fromRgba = (
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
  mode: Alpha,
) => {
  const data = new Uint8Array(width * height * 3)

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = mode === 'white' ? (rgba[pixel * 4 + 3] ?? 255) : 255

    data[pixel * 3] = onWhite(rgba[pixel * 4] ?? 0, alpha)
    data[pixel * 3 + 1] = onWhite(rgba[pixel * 4 + 1] ?? 0, alpha)
    data[pixel * 3 + 2] = onWhite(rgba[pixel * 4 + 2] ?? 0, alpha)
  }

  return { width, height, data }
}

/**
 * Matches the worker's load_image: RGBA and palette pages are composited onto white (when `mode` is
 * `white`), other modes go through convert('RGB'): grey repeated, alpha of grey dropped, 16-bit
 * keeping the high byte.
 */
const pngToRgb = (bytes: Uint8Array, mode: Alpha): RgbImage => {
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
      const alpha = mode === 'white' ? (entry[3] ?? 255) : 255

      data[pixel * 3] = onWhite(entry[0] ?? 0, alpha)
      data[pixel * 3 + 1] = onWhite(entry[1] ?? 0, alpha)
      data[pixel * 3 + 2] = onWhite(entry[2] ?? 0, alpha)

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

    const alpha = channels === 4 && mode === 'white' ? sample(pixel * channels + 3) : 255

    data[pixel * 3] = onWhite(sample(pixel * channels), alpha)
    data[pixel * 3 + 1] = onWhite(sample(pixel * channels + 1), alpha)
    data[pixel * 3 + 2] = onWhite(sample(pixel * channels + 2), alpha)
  }

  return { width, height, data }
}

const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e

const isWebp = (bytes: Uint8Array) =>
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45

export class Images extends Context.Service<
  Images,
  {
    readonly read: (file: string, alpha?: Alpha) => Effect.Effect<RgbImage, MangaError>
    /** Writes RGB, or one grey channel when `data` holds one byte per pixel, as PNG. */
    readonly write: (file: string, image: RgbImage) => Effect.Effect<void, MangaError>
  }
>()('wenbu/core/manga/engine/Images') {
  static readonly layer = (codecs: CodecFiles) =>
    Layer.effect(
      Images,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const wasm = (file: string) =>
          fs
            .readFile(file)
            .pipe(Effect.mapError(() => failed(`The image decoder ${file} could not be loaded.`)))

        const jpegBinary = yield* wasm(codecs.jpeg)
        const webpBinary = yield* wasm(codecs.webp)

        yield* Effect.promise(() => initJpeg({ wasmBinary: jpegBinary }))
        yield* Effect.promise(() => initWebp({ wasmBinary: webpBinary }))

        const read = Effect.fn('Images.read')(function* (file: string, alpha: Alpha = 'white') {
          const bytes = yield* fs
            .readFile(file)
            .pipe(Effect.mapError(() => failed(`The page ${file} could not be read.`)))

          if (isPng(bytes)) {
            return yield* Effect.try({
              try: () => pngToRgb(bytes, alpha),
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

          return fromRgba(decoded.width, decoded.height, decoded.data, alpha)
        })

        const write = Effect.fn('Images.write')(
          function* (file: string, image: RgbImage) {
            const channels = image.data.length === image.width * image.height ? 1 : 3

            const bytes = encodePng(
              { width: image.width, height: image.height, data: image.data, channels, depth: 8 },
              { zlib: { level: 1 } },
            )

            const partial = `${file}.partial`

            yield* fs.makeDirectory(path.dirname(file), { recursive: true })
            yield* fs.writeFile(partial, bytes)
            yield* fs.rename(partial, file)
          },
          Effect.mapError(() => failed('The cleaned page could not be saved.')),
        )

        return Images.of({ read, write })
      }),
    )
}
