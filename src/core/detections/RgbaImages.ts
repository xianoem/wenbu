import { zlibSync } from 'fflate'
import type { RgbaImage } from '#contract/Detections'

export const fitWithin = (image: RgbaImage, maxDimension: number): RgbaImage => {
  const factor = Math.min(1, maxDimension / Math.max(image.width, image.height))

  if (factor >= 1) {
    return image
  }

  const width = Math.max(1, Math.floor(image.width * factor))
  const height = Math.max(1, Math.floor(image.height * factor))
  const pixels = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * image.height) / height)
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * image.height) / height))

    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * image.width) / width)
      const right = Math.max(left + 1, Math.floor(((x + 1) * image.width) / width))
      const sums = [0, 0, 0, 0]

      for (let sourceY = top; sourceY < bottom; sourceY++) {
        for (let sourceX = left; sourceX < right; sourceX++) {
          const offset = (sourceY * image.width + sourceX) * 4

          for (let channel = 0; channel < 4; channel++) {
            sums[channel] = (sums[channel] ?? 0) + (image.pixels[offset + channel] ?? 0)
          }
        }
      }

      const count = (bottom - top) * (right - left)
      const target = (y * width + x) * 4

      for (let channel = 0; channel < 4; channel++) {
        pixels[target + channel] = Math.round((sums[channel] ?? 0) / count)
      }
    }
  }

  return { width, height, pixels }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index

  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }

  return value >>> 0
})

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)

  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))

  return out
}

export const encodePng = (image: RgbaImage) => {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)

  view.setUint32(0, image.width)
  view.setUint32(4, image.height)
  header.set([8, 6, 0, 0, 0], 8)

  const stride = image.width * 4
  const rows = new Uint8Array((stride + 1) * image.height)

  for (let y = 0; y < image.height; y++) {
    rows.set(image.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }

  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(rows, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ]

  const png = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0

  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }

  return png
}
