import { roundHalfEven } from './DbBoxes'
import type { RgbImage } from './Images'
import type { Cv } from './OpenCv'
import { mapBytes } from './Bytes'

/**
 * A port of the Manga Editor's cleaning plan (wenbu_manga/editor.py): which pixels are filled with the
 * bubble's paper colour, which go to LaMa, how inpainted paper settles to the bubble's colour, and the
 * text area inside a bubble. Page-wide dilations run on the smallest crop that gives the same result.
 */

export interface CleanBlock {
  readonly box: readonly [number, number, number, number]
  readonly drawn?: boolean | undefined
  readonly method?: 'fill' | 'inpaint' | undefined
  readonly fg?: ReadonlyArray<number> | undefined
  readonly bg?: ReadonlyArray<number> | undefined
}

const scanMargin = 6
const flat = 8
const paperLevel = 200
const largestBubble = 25
const paperTolerance = 60
const bubbleInset = [0.06, 0.05] as const

export interface Page {
  readonly cv: Cv
  readonly rgb: RgbImage
  readonly gray: Uint8Array
  /** 1 where the page is paper (lighter than 200 and away from ink), 0 elsewhere. */
  readonly paper: Uint8Array
  readonly seal: number
  readonly scratch: FloodScratch
}

const withMat = <A>(
  cv: Cv,
  rows: number,
  cols: number,
  type: number,
  data: Uint8Array,
  use: (mat: InstanceType<Cv['Mat']>) => A,
) => {
  const mat = cv.matFromArray(rows, cols, type, data)
  const result = use(mat)

  mat.delete()

  return result
}

const dilate = (cv: Cv, data: Uint8Array, width: number, height: number, iterations: number) =>
  withMat(cv, height, width, cv.CV_8UC1, data, (source) => {
    const out = new cv.Mat()
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U)

    cv.dilate(source, out, kernel, new cv.Point(-1, -1), iterations)

    const result = Uint8Array.from(out.data)

    out.delete()
    kernel.delete()

    return result
  })

/**
 * cv.dilate of a 0/1 mask with a 3x3 square, `iterations` times: the same as one square of side
 * 2 * iterations + 1, done as a row pass and a column pass. Pixels outside the page add nothing.
 */
export const dilateSquare = (
  data: Uint8Array,
  width: number,
  height: number,
  iterations: number,
) => {
  const rows = new Uint8Array(data.length)

  for (let y = 0; y < height; y += 1) {
    const start = y * width
    let last = Number.NEGATIVE_INFINITY

    for (let x = 0; x < width; x += 1) {
      if (data[start + x] !== 0) {
        last = x
      }

      if (x - last <= iterations) {
        rows[start + x] = 1
      }
    }

    last = Number.POSITIVE_INFINITY

    for (let x = width - 1; x >= 0; x -= 1) {
      if (data[start + x] !== 0) {
        last = x
      }

      if (last - x <= iterations) {
        rows[start + x] = 1
      }
    }
  }

  const out = new Uint8Array(data.length)

  for (let x = 0; x < width; x += 1) {
    let last = Number.NEGATIVE_INFINITY

    for (let y = 0; y < height; y += 1) {
      if (rows[y * width + x] !== 0) {
        last = y
      }

      if (y - last <= iterations) {
        out[y * width + x] = 1
      }
    }

    last = Number.POSITIVE_INFINITY

    for (let y = height - 1; y >= 0; y -= 1) {
      if (rows[y * width + x] !== 0) {
        last = y
      }

      if (last - y <= iterations) {
        out[y * width + x] = 1
      }
    }
  }

  return out
}

/** Reusable buffers for flood fills over one page. */
export interface FloodScratch {
  readonly marks: Uint8Array
  readonly queue: Int32Array
}

export const floodScratch = (pixels: number): FloodScratch => ({
  marks: new Uint8Array(pixels),
  queue: new Int32Array(pixels),
})

/**
 * cv.floodFill with 4-connectivity over the 1 pixels of `paper` from `seed`, as the list of pixels
 * reached. It stops once more than `limit` are reached, since the caller then only needs to know the
 * area is too large. The scratch marks are cleared again before it returns.
 */
export const floodPaper = (
  paper: Uint8Array,
  width: number,
  height: number,
  seed: readonly [number, number],
  limit: number,
  scratch: FloodScratch,
) => {
  const { marks, queue } = scratch
  const start = seed[1] * width + seed[0]
  const bounds = { left: width, top: height, right: -1, bottom: -1 }

  if (paper[start] === 0) {
    return { pixels: queue.subarray(0, 0), count: 0, bounds }
  }

  let head = 0
  let tail = 0

  const visit = (next: number) => {
    if (marks[next] === 0 && paper[next] !== 0) {
      marks[next] = 1
      queue[tail] = next
      tail += 1
    }
  }

  visit(start)

  while (head < tail && head <= limit) {
    const p = queue[head] ?? 0
    const x = p % width
    const y = (p - x) / width

    head += 1
    bounds.left = Math.min(bounds.left, x)
    bounds.right = Math.max(bounds.right, x)
    bounds.top = Math.min(bounds.top, y)
    bounds.bottom = Math.max(bounds.bottom, y)

    if (x > 0) {
      visit(p - 1)
    }

    if (x < width - 1) {
      visit(p + 1)
    }

    if (y > 0) {
      visit(p - width)
    }

    if (y < height - 1) {
      visit(p + width)
    }
  }

  const pixels = queue.subarray(0, tail)

  for (const p of pixels) {
    marks[p] = 0
  }

  return { pixels, count: tail, bounds }
}

/** Everything the plan reads off a page, computed once. */
export const pageOf = (cv: Cv, rgb: RgbImage): Page => {
  const gray = withMat(cv, rgb.height, rgb.width, cv.CV_8UC3, rgb.data, (source) => {
    const out = new cv.Mat()

    cv.cvtColor(source, out, cv.COLOR_RGB2GRAY)

    const result = Uint8Array.from(out.data)

    out.delete()

    return result
  })

  const seal = Math.max(2, Math.floor(rgb.height / 800))

  const ink = dilateSquare(
    mapBytes(gray, (value) => (value < paperLevel ? 1 : 0)),
    rgb.width,
    rgb.height,
    seal,
  )

  return {
    cv,
    rgb,
    gray,
    paper: mapBytes(ink, (value) => 1 - value),
    seal,
    scratch: floodScratch(rgb.width * rgb.height),
  }
}

export const clipped = (box: ReadonlyArray<number>, width: number, height: number) => {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box.map((edge) => roundHalfEven(edge))

  return [Math.max(0, x1), Math.max(0, y1), Math.min(width, x2), Math.min(height, y2)] as const
}

/** A full-page mask that is zero outside one rectangle. */
interface Region {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly data: Uint8Array
}

const emptyRegion: Region = { x: 0, y: 0, w: 0, h: 0, data: new Uint8Array(0) }

/** A crop that is 1 at the given page pixels. */
const regionOf = (
  pixels: Int32Array,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const data = new Uint8Array(w * h)

  for (const p of pixels) {
    data[(Math.floor(p / width) - y) * w + (p % width) - x] = 1
  }

  return data
}

const cropOf = (data: Uint8Array, width: number, x: number, y: number, w: number, h: number) => {
  const out = new Uint8Array(w * h)

  for (let row = 0; row < h; row += 1) {
    out.set(data.subarray((y + row) * width + x, (y + row) * width + x + w), row * w)
  }

  return out
}

/** cv2.dilate with a 3x3 square, `iterations` times, of a region that is zero outside its rectangle. */
const dilateRegion = (page: Page, region: Region, iterations: number): Region => {
  if (region.w === 0) {
    return region
  }

  const x = Math.max(0, region.x - iterations)
  const y = Math.max(0, region.y - iterations)
  const r = Math.min(page.rgb.width, region.x + region.w + iterations)
  const b = Math.min(page.rgb.height, region.y + region.h + iterations)
  const w = r - x
  const h = b - y
  const padded = new Uint8Array(w * h)

  for (let row = 0; row < region.h; row += 1) {
    padded.set(
      region.data.subarray(row * region.w, (row + 1) * region.w),
      (region.y - y + row) * w + region.x - x,
    )
  }

  return { x, y, w, h, data: dilate(page.cv, padded, w, h, iterations) }
}

const strokeMask = (cv: Cv, gray: Uint8Array, w: number, h: number) => {
  let low = 255
  let high = 0

  for (const value of gray) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }

  if (gray.length === 0 || high - low < flat) {
    return new Uint8Array(w * h).fill(255)
  }

  const dark = withMat(cv, h, w, cv.CV_8UC1, gray, (source) => {
    const out = new cv.Mat()

    cv.threshold(source, out, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)

    const result = Uint8Array.from(out.data)

    out.delete()

    return result
  })

  const set = dark.filter((value) => value !== 0).length
  const strokes = set <= dark.length / 2 ? dark : mapBytes(dark, (value) => 255 - value)

  return dilate(cv, strokes, w, h, 2)
}

const mean = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0) / values.length

const scannedColours = (block: CleanBlock) => {
  if (block.fg?.length !== 3 || block.bg?.length !== 3) {
    return undefined
  }

  const text = mean(block.fg)
  const paper = mean(block.bg)

  return Math.abs(text - paper) < flat ? undefined : ([text, paper] as const)
}

/** block_mask: the scan mask around the block, or, for drawn blocks, the text's strokes inside it. */
export const blockMask = (page: Page, scan: Uint8Array, block: CleanBlock): Region => {
  const { width, height } = page.rgb

  if (block.drawn !== true) {
    const [x1, y1, x2, y2] = clipped(
      [
        block.box[0] - scanMargin,
        block.box[1] - scanMargin,
        block.box[2] + scanMargin,
        block.box[3] + scanMargin,
      ],
      width,
      height,
    )

    if (x2 > x1 && y2 > y1) {
      const data = mapBytes(cropOf(scan, width, x1, y1, x2 - x1, y2 - y1), (value) =>
        value >= 127 ? 255 : 0,
      )

      if (data.some((value) => value !== 0)) {
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, data }
      }
    }
  }

  const [x1, y1, x2, y2] = clipped(block.box, width, height)

  if (x2 <= x1 || y2 <= y1) {
    return emptyRegion
  }

  const w = x2 - x1
  const h = y2 - y1
  const crop = cropOf(page.gray, width, x1, y1, w, h)
  const colours = scannedColours(block)

  const data =
    colours === undefined
      ? strokeMask(page.cv, crop, w, h)
      : dilate(
          page.cv,
          mapBytes(crop, (value) =>
            Math.abs(value - colours[0]) < Math.abs(value - colours[1]) ? 255 : 0,
          ),
          w,
          h,
          2,
        )

  return { x: x1, y: y1, w, h, data }
}

export interface Bubble {
  /** The filled outline of the bubble, as a region of the page. */
  readonly bubble: Region
  readonly colour: readonly [number, number, number]
}

/** np.median of uint8 values, cast back to uint8 as the plugin does. */
const median = (values: Uint8Array) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0
  }

  return Math.trunc(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

/** bubble_around: the paper-coloured area the block sits in, if it is a bubble and not the page. */
export const bubbleAround = (page: Page, box: ReadonlyArray<number>): Bubble | undefined => {
  const { cv, rgb, paper, seal } = page
  const { width, height } = rgb
  const [x1, y1, x2, y2] = clipped(box, width, height)

  if (x2 <= x1 || y2 <= y1) {
    return undefined
  }

  const w = x2 - x1
  const h = y2 - y1
  let seed: readonly [number, number] | undefined

  withMat(cv, h, w, cv.CV_8UC1, cropOf(paper, width, x1, y1, w, h), (crop) => {
    const labels = new cv.Mat()
    const stats = new cv.Mat()
    const centroids = new cv.Mat()
    const count = cv.connectedComponentsWithStats(crop, labels, stats, centroids, 4)

    if (count >= 2) {
      let largest = 1

      for (let label = 2; label < count; label += 1) {
        if ((stats.data32S[label * 5 + 4] ?? 0) > (stats.data32S[largest * 5 + 4] ?? 0)) {
          largest = label
        }
      }

      const first = labels.data32S.indexOf(largest)

      seed = [(first % w) + x1, Math.floor(first / w) + y1]
    }

    labels.delete()
    stats.delete()
    centroids.delete()
  })

  if (seed === undefined) {
    return undefined
  }

  const flooded = floodPaper(paper, width, height, seed, w * h * largestBubble, page.scratch)
  const { count } = flooded
  const { left, top, right, bottom } = flooded.bounds

  if (count > w * h * largestBubble) {
    return undefined
  }

  const inside: Region = {
    x: left,
    y: top,
    w: right - left + 1,
    h: bottom - top + 1,
    data: regionOf(flooded.pixels, width, left, top, right - left + 1, bottom - top + 1),
  }

  const grown = dilateRegion(page, inside, seal)

  const bubble = withMat(cv, grown.h, grown.w, cv.CV_8UC1, grown.data, (source) => {
    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    const filled = cv.Mat.zeros(grown.h, grown.w, cv.CV_8UC1)

    cv.findContours(source, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    cv.drawContours(filled, contours, -1, new cv.Scalar(255), -1)

    const data = Uint8Array.from(filled.data)

    contours.delete()
    hierarchy.delete()
    filled.delete()

    return { ...grown, data }
  })

  const channels = [0, 1, 2].map(() => new Uint8Array(count))
  let n = 0

  for (let row = 0; row < inside.h; row += 1) {
    for (let column = 0; column < inside.w; column += 1) {
      if (inside.data[row * inside.w + column] !== 0) {
        const at = ((inside.y + row) * width + inside.x + column) * 3

        channels.forEach((channel, c) => {
          channel[n] = rgb.data[at + c] ?? 0
        })

        n += 1
      }
    }
  }

  const [r = 0, g = 0, b = 0] = channels.map(median)

  return { bubble, colour: [r, g, b] }
}

const at = (region: Region, x: number, y: number) =>
  x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h
    ? (region.data[(y - region.y) * region.w + x - region.x] ?? 0)
    : 0

/** clean_plan: the page with fill-cleaned bubbles painted, and the mask left for LaMa. */
export const cleanPlan = (
  page: Page,
  scan: Uint8Array,
  blocks: ReadonlyArray<CleanBlock>,
  brush: Uint8Array | undefined,
) => {
  const { width, height } = page.rgb
  const filled = Uint8Array.from(page.rgb.data)
  const inpaint = new Uint8Array(width * height)
  const keep = (p: number) => brush !== undefined && (brush[p * 3 + 1] ?? 0) >= 127
  const reach = Math.max(3, Math.floor(height / 500))

  for (const block of blocks) {
    const text = blockMask(page, scan, block)
    const around = block.method === 'fill' ? bubbleAround(page, block.box) : undefined

    if (around === undefined) {
      const grown = dilateRegion(page, text, reach)

      for (let row = 0; row < grown.h; row += 1) {
        for (let column = 0; column < grown.w; column += 1) {
          const p = (grown.y + row) * width + grown.x + column

          inpaint[p] = (inpaint[p] ?? 0) | (grown.data[row * grown.w + column] ?? 0)
        }
      }

      continue
    }

    const strokes = dilateRegion(page, text, 2)

    for (let row = 0; row < strokes.h; row += 1) {
      for (let column = 0; column < strokes.w; column += 1) {
        const x = strokes.x + column
        const y = strokes.y + row
        const p = y * width + x

        if (
          (strokes.data[row * strokes.w + column] ?? 0) > 0 &&
          at(around.bubble, x, y) > 0 &&
          !keep(p)
        ) {
          filled.set(around.colour, p * 3)
        }
      }
    }
  }

  if (brush !== undefined) {
    for (let p = 0; p < width * height; p += 1) {
      if ((brush[p * 3] ?? 0) >= 127) {
        inpaint[p] = 255
      }

      if (keep(p)) {
        inpaint[p] = 0
      }
    }
  }

  return { filled: { width, height, data: filled } satisfies RgbImage, inpaint }
}

/** settle_paper: inpainted pixels close to a bubble's paper colour become exactly that colour. */
export const settlePaper = (
  page: Page,
  inpainted: RgbImage,
  blocks: ReadonlyArray<CleanBlock>,
  mask: Uint8Array,
) => {
  const { width } = page.rgb
  const settled = Uint8Array.from(inpainted.data)

  for (const block of blocks) {
    const around = bubbleAround(page, block.box)

    if (around === undefined) {
      continue
    }

    const { bubble, colour } = around

    for (let row = 0; row < bubble.h; row += 1) {
      for (let column = 0; column < bubble.w; column += 1) {
        const p = (bubble.y + row) * width + bubble.x + column

        if ((bubble.data[row * bubble.w + column] ?? 0) === 0 || (mask[p] ?? 0) === 0) {
          continue
        }

        const distance =
          Math.abs((inpainted.data[p * 3] ?? 0) - colour[0]) +
          Math.abs((inpainted.data[p * 3 + 1] ?? 0) - colour[1]) +
          Math.abs((inpainted.data[p * 3 + 2] ?? 0) - colour[2])

        if (distance <= paperTolerance) {
          settled.set(colour, p * 3)
        }
      }
    }
  }

  return { width, height: page.rgb.height, data: settled } satisfies RgbImage
}

/** text_area: the bubble around a block, inset, where lettering may go. */
export const textArea = (page: Page, box: ReadonlyArray<number>) => {
  const around = bubbleAround(page, box)

  if (around === undefined) {
    return undefined
  }

  const { bubble } = around
  let x1 = Number.POSITIVE_INFINITY
  let y1 = Number.POSITIVE_INFINITY
  let x2 = -1
  let y2 = -1

  for (let row = 0; row < bubble.h; row += 1) {
    for (let column = 0; column < bubble.w; column += 1) {
      if ((bubble.data[row * bubble.w + column] ?? 0) !== 0) {
        x1 = Math.min(x1, bubble.x + column)
        x2 = Math.max(x2, bubble.x + column + 1)
        y1 = Math.min(y1, bubble.y + row)
        y2 = Math.max(y2, bubble.y + row + 1)
      }
    }
  }

  const dx = roundHalfEven((x2 - x1) * bubbleInset[0])
  const dy = roundHalfEven((y2 - y1) * bubbleInset[1])

  return [x1 + dx, y1 + dy, x2 - dx, y2 - dy] as const
}

const patchRing = 12
const grainLimit = 10
const patchTone = 14

const medianFloat = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/**
 * blend_patch: a brushed patch takes the tone of the ring around it and the paper grain from beside
 * it. The grain's Gaussian blur runs only on the strip it is read from, wide enough for its kernel.
 */
export const blendPatch = (
  cv: Cv,
  base: RgbImage,
  inpainted: RgbImage,
  mask: Uint8Array,
): RgbImage => {
  const { width, height } = base
  const inside = (p: number) => (mask[p] ?? 0) > 0
  let left = width
  let right = -1
  let top = height
  let bottom = -1

  for (let p = 0; p < mask.length; p += 1) {
    if (inside(p)) {
      left = Math.min(left, p % width)
      right = Math.max(right, p % width)
      top = Math.min(top, Math.floor(p / width))
      bottom = Math.max(bottom, Math.floor(p / width))
    }
  }

  if (right < 0) {
    return inpainted
  }

  const result = Float32Array.from(inpainted.data)

  const ringRegion = dilate(
    cv,
    mapBytes(mask, (value) => (value > 0 ? 1 : 0)),
    width,
    height,
    patchRing,
  )

  const ringPixels: Array<Array<number>> = [[], [], []]
  const insidePixels: Array<Array<number>> = [[], [], []]

  for (let p = 0; p < mask.length; p += 1) {
    if (inside(p)) {
      insidePixels.forEach((channel, c) => channel.push(result[p * 3 + c] ?? 0))
    } else if ((ringRegion[p] ?? 0) > 0) {
      ringPixels.forEach((channel, c) => channel.push(base.data[p * 3 + c] ?? 0))
    }
  }

  if ((ringPixels[0]?.length ?? 0) > 0) {
    const shift = [0, 1, 2].map((c) =>
      Math.min(
        Math.max(medianFloat(ringPixels[c] ?? []) - medianFloat(insidePixels[c] ?? []), -patchTone),
        patchTone,
      ),
    )

    for (let p = 0; p < mask.length; p += 1) {
      if (inside(p)) {
        for (let c = 0; c < 3; c += 1) {
          result[p * 3 + c] = Math.fround((result[p * 3 + c] ?? 0) + (shift[c] ?? 0))
        }
      }
    }
  }

  const span = right - left + 1 + patchRing
  const offset = right + span < width ? span : -span
  const radius = 8
  const stripLeft = Math.max(0, left + offset - radius)
  const stripRight = Math.min(width, right + offset + 1 + radius)
  const stripTop = Math.max(0, top - radius)
  const stripBottom = Math.min(height, bottom + 1 + radius)
  const stripWidth = stripRight - stripLeft
  const stripHeight = stripBottom - stripTop

  if (stripWidth > 0 && stripHeight > 0) {
    const strip = new Float32Array(stripWidth * stripHeight * 3)

    for (let row = 0; row < stripHeight; row += 1) {
      for (let column = 0; column < stripWidth * 3; column += 1) {
        strip[row * stripWidth * 3 + column] =
          base.data[((stripTop + row) * width + stripLeft) * 3 + column] ?? 0
      }
    }

    const source = cv.matFromArray(stripHeight, stripWidth, cv.CV_32FC3, strip)
    const blurred = new cv.Mat()

    cv.GaussianBlur(source, blurred, new cv.Size(0, 0), 2)

    for (let p = 0; p < mask.length; p += 1) {
      if (!inside(p)) {
        continue
      }

      const x = ((((p % width) + offset) % width) + width) % width
      const y = Math.floor(p / width)
      const sx = x - stripLeft
      const sy = y - stripTop

      if (sx < 0 || sx >= stripWidth || sy < 0 || sy >= stripHeight) {
        continue
      }

      const grain = [0, 1, 2].map((c) =>
        Math.fround(
          (strip[(sy * stripWidth + sx) * 3 + c] ?? 0) -
            (blurred.data32F[(sy * stripWidth + sx) * 3 + c] ?? 0),
        ),
      )

      if (Math.max(...grain.map(Math.abs)) > grainLimit) {
        continue
      }

      for (let c = 0; c < 3; c += 1) {
        result[p * 3 + c] = Math.fround((result[p * 3 + c] ?? 0) + (grain[c] ?? 0))
      }
    }

    source.delete()
    blurred.delete()
  }

  return {
    width,
    height,
    data: mapBytes(result, (value) => Math.trunc(Math.min(Math.max(value, 0), 255))),
  }
}
