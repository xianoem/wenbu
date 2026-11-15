import type { RgbImage } from './Images'
import { pillowResize } from './PillowResize'

/**
 * The Hayai reader's host-side preprocessing (processing_hayai.py and modeling_hayai.py): the NaFlex
 * size search, the Pillow resize, 16-pixel patches and the antialiased position-embedding weights.
 */

export const patchSize = 16
const patchBytes = patchSize * patchSize * 3
const minPatches = 64
const maxScale = 4
const positionSide = 16

export interface NaFlexSize {
  readonly height: number
  readonly width: number
  readonly rows: number
  readonly columns: number
}

const sideAt = (length: number, scale: number) =>
  Math.max(patchSize, Math.ceil((length * scale) / patchSize) * patchSize)

const searchScale = (
  height: number,
  width: number,
  low: number,
  high: number,
  maxPatches: number,
) => {
  let lowest = low
  let highest = high

  while (highest - lowest >= 1e-5) {
    const scale = 0.5 * (lowest + highest)

    if ((sideAt(height, scale) / patchSize) * (sideAt(width, scale) / patchSize) <= maxPatches) {
      lowest = scale
    } else {
      highest = scale
    }
  }

  return lowest
}

const sizeAt = (height: number, width: number, scale: number): NaFlexSize => {
  const th = sideAt(height, scale)
  const tw = sideAt(width, scale)

  return { height: th, width: tw, rows: th / patchSize, columns: tw / patchSize }
}

/** _naflex_target_size: the largest patch grid within the budget, raised to 64 patches for tiny crops. */
export const naflexSize = (height: number, width: number, maxPatches: number): NaFlexSize => {
  const scale = searchScale(height, width, 1e-5, maxScale, maxPatches)
  const size = sizeAt(height, width, scale)

  if (size.rows * size.columns >= minPatches) {
    return size
  }

  return sizeAt(
    height,
    width,
    searchScale(height, width, scale, 100, Math.min(minPatches, maxPatches)),
  )
}

/** _decode_and_patchify_u8: patches in row-major order, each 16 rows of 16 RGB pixels. */
export const patchify = (crop: RgbImage, maxPatches: number) => {
  const size = naflexSize(crop.height, crop.width, maxPatches)

  const image =
    size.width === crop.width && size.height === crop.height
      ? crop
      : pillowResize(crop, size.width, size.height)

  const pixels = new Uint8Array(size.rows * size.columns * patchBytes)

  for (let row = 0; row < size.rows; row += 1) {
    for (let column = 0; column < size.columns; column += 1) {
      const patch = (row * size.columns + column) * patchBytes

      for (let y = 0; y < patchSize; y += 1) {
        const from = ((row * patchSize + y) * size.width + column * patchSize) * 3

        pixels.set(image.data.subarray(from, from + patchSize * 3), patch + y * patchSize * 3)
      }
    }
  }

  return { size, pixels }
}

const f = Math.fround

/** One axis of PyTorch's antialiased bilinear interpolation from 16 cells, in float32 like ATen. */
const axisWeights = (outSize: number) => {
  const scale = f(positionSide / outSize)
  const support = scale >= 1 ? scale : 1
  const inverse = scale >= 1 ? f(1 / scale) : 1
  const weights = new Float32Array(outSize * positionSide)

  for (let out = 0; out < outSize; out += 1) {
    const center = f(scale * f(out + 0.5))
    const min = Math.max(Math.trunc(f(f(center - support) + 0.5)), 0)
    const count = Math.min(Math.trunc(f(f(center + support) + 0.5)), positionSide) - min
    const row: Array<number> = []
    let total = 0

    for (let j = 0; j < count; j += 1) {
      const x = Math.abs(f(f(f(j + min - center) + 0.5) * inverse))
      const weight = x < 1 ? f(1 - x) : 0

      row.push(weight)
      total = f(total + weight)
    }

    row.forEach((weight, j) => {
      weights[out * positionSide + min + j] = total === 0 ? 0 : f(weight / total)
    })
  }

  return weights
}

/** _aa_grid_weights: for each patch, its weight on each of the 16 x 16 position embeddings. */
export const positionWeights = (rows: number, columns: number) => {
  const vertical = axisWeights(rows)
  const horizontal = axisWeights(columns)
  const cells = positionSide * positionSide
  const weights = new Float32Array(rows * columns * cells)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const patch = (row * columns + column) * cells

      for (let a = 0; a < positionSide; a += 1) {
        const wy = vertical[row * positionSide + a] ?? 0

        if (wy === 0) {
          continue
        }

        for (let b = 0; b < positionSide; b += 1) {
          weights[patch + a * positionSide + b] = f(
            wy * (horizontal[column * positionSide + b] ?? 0),
          )
        }
      }
    }
  }

  return weights
}
