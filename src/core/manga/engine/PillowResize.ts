import type { RgbImage } from './Images'

/**
 * Pillow's Image.resize with BILINEAR or LANCZOS on 8-bit RGB (libImaging/Resample.c): the filter is
 * widened by the scale when shrinking, coefficients are in 22-bit fixed point, and a horizontal pass
 * runs before a vertical one.
 */

const precisionBits = 32 - 8 - 2
const half = 1 << (precisionBits - 1)

const triangle = (x: number) => {
  const distance = Math.abs(x)

  return distance < 1 ? 1 - distance : 0
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(x * Math.PI) / (x * Math.PI))

const lanczos = (x: number) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0)

export type Filter = 'bilinear' | 'lanczos'

const filters = {
  bilinear: { weight: triangle, support: 1 },
  lanczos: { weight: lanczos, support: 3 },
} as const

interface Coefficients {
  readonly size: number
  readonly bounds: Int32Array
  readonly weights: Int32Array
}

const coefficients = (inSize: number, outSize: number, filter: Filter): Coefficients => {
  const { weight: shape, support: reach } = filters[filter]
  const scale = inSize / outSize
  const filterScale = Math.max(scale, 1)
  const inverse = 1 / filterScale
  const support = reach * filterScale
  const size = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const weights = new Int32Array(outSize * size)
  const row = new Float64Array(size)

  for (let out = 0; out < outSize; out += 1) {
    const center = (out + 0.5) * scale
    const min = Math.max(0, Math.trunc(center - support + 0.5))
    const count = Math.min(inSize, Math.trunc(center + support + 0.5)) - min
    let total = 0

    row.fill(0)

    for (let x = 0; x < count; x += 1) {
      const weight = shape((x + min - center + 0.5) * inverse)

      row[x] = weight
      total += weight
    }

    for (let x = 0; x < count; x += 1) {
      const weight = total === 0 ? (row[x] ?? 0) : (row[x] ?? 0) / total

      weights[out * size + x] =
        weight < 0
          ? Math.trunc(-0.5 + weight * (1 << precisionBits))
          : Math.trunc(0.5 + weight * (1 << precisionBits))
    }

    bounds[out * 2] = min
    bounds[out * 2 + 1] = count
  }

  return { size, bounds, weights }
}

const clip8 = (value: number) => {
  const shifted = value >> precisionBits

  if (shifted < 0) {
    return 0
  }

  return shifted > 255 ? 255 : shifted
}

const horizontal = (image: RgbImage, width: number, filter: Filter): RgbImage => {
  const { size, bounds, weights } = coefficients(image.width, width, filter)
  const data = new Uint8Array(width * image.height * 3)

  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * image.width * 3

    for (let x = 0; x < width; x += 1) {
      const min = bounds[x * 2] ?? 0
      const count = bounds[x * 2 + 1] ?? 0

      for (let channel = 0; channel < 3; channel += 1) {
        let sum = half

        for (let k = 0; k < count; k += 1) {
          sum +=
            (image.data[rowStart + (min + k) * 3 + channel] ?? 0) * (weights[x * size + k] ?? 0)
        }

        data[(y * width + x) * 3 + channel] = clip8(sum)
      }
    }
  }

  return { width, height: image.height, data }
}

const vertical = (image: RgbImage, height: number, filter: Filter): RgbImage => {
  const { size, bounds, weights } = coefficients(image.height, height, filter)
  const data = new Uint8Array(image.width * height * 3)
  const stride = image.width * 3

  for (let y = 0; y < height; y += 1) {
    const min = bounds[y * 2] ?? 0
    const count = bounds[y * 2 + 1] ?? 0

    for (let column = 0; column < stride; column += 1) {
      let sum = half

      for (let k = 0; k < count; k += 1) {
        sum += (image.data[(min + k) * stride + column] ?? 0) * (weights[y * size + k] ?? 0)
      }

      data[y * stride + column] = clip8(sum)
    }
  }

  return { width: image.width, height, data }
}

export const pillowResize = (
  image: RgbImage,
  width: number,
  height: number,
  filter: Filter = 'bilinear',
): RgbImage => {
  const wide = width === image.width ? image : horizontal(image, width, filter)

  return height === image.height ? wide : vertical(wide, height, filter)
}

/** Image.crop with integer edges; parts outside the image are black, as in Pillow. */
export const crop = (image: RgbImage, left: number, top: number, right: number, bottom: number) => {
  const width = right - left
  const height = bottom - top
  const data = new Uint8Array(Math.max(0, width * height * 3))

  for (let y = Math.max(top, 0); y < Math.min(bottom, image.height); y += 1) {
    const from = Math.max(left, 0)
    const to = Math.min(right, image.width)

    if (to > from) {
      data.set(
        image.data.subarray((y * image.width + from) * 3, (y * image.width + to) * 3),
        ((y - top) * width + from - left) * 3,
      )
    }
  }

  return { width, height, data } satisfies RgbImage
}
