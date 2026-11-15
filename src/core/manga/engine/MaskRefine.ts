import { Effect } from 'effect'
import type { Point } from './DbBoxes'
import type { GreyImage } from './Detector'
import type { MangaCv } from './MangaCv'
import type { Cv } from './OpenCv'
import { quad, type Quad } from './Quad'
import { fontSize } from './TextMerge'

/**
 * A port of manga-image-translator's mask refinement ("fit_text", mask_refinement/__init__.py and
 * complete_mask): connected parts of the detector's mask are given to the text line they belong to,
 * each line's part is refined with a dense CRF on the bilateral-filtered page and dilated, and the
 * union is scaled back to the page. The helper resizes, filters and runs the CRF, so those steps match
 * the plugin's OpenCV and pydensecrf exactly; labelling and dilation run in OpenCV.js.
 */

const pageId = 1
const scaledId = 40
const filteredId = 41
const maskId = 42
const maskScaledId = 43
const finalId = 44
const finalFullId = 45

const f = Math.fround

const shoelace = (polygon: ReadonlyArray<Point>) => {
  let area = 0

  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point

    area += point.x * next.y - next.x * point.y
  })

  return Math.abs(area) / 2
}

/** The area of a polygon clipped to an axis-aligned rectangle (Sutherland-Hodgman). */
const clippedArea = (
  polygon: ReadonlyArray<Point>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => {
  let output: Array<Point> = [...polygon]

  const clip = (inside: (p: Point) => boolean, cut: (a: Point, b: Point) => Point) => {
    const input = output

    output = []

    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length] ?? current

      if (inside(current)) {
        if (!inside(previous)) {
          output.push(cut(previous, current))
        }

        output.push(current)
      } else if (inside(previous)) {
        output.push(cut(previous, current))
      }
    })
  }

  const atX = (x: number) => (a: Point, b: Point) => ({
    x,
    y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x),
  })

  const atY = (y: number) => (a: Point, b: Point) => ({
    x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y),
    y,
  })

  clip((p) => p.x >= x1, atX(x1))
  clip((p) => p.x <= x2, atX(x2))
  clip((p) => p.y >= y1, atY(y1))
  clip((p) => p.y <= y2, atY(y2))

  return output.length < 3 ? 0 : shoelace(output)
}

const pointPolygonDistance = (p: Point, polygon: ReadonlyArray<Point>) => {
  let inside = false
  let best = Number.POSITIVE_INFINITY

  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length] ?? a

    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }

    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy

    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))

    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  })

  return inside ? 0 : best
}

/** extend_rect: grows a rectangle by `size` on every side, kept inside the image. */
const extendRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  maxX: number,
  maxY: number,
  size: number,
) => {
  const x1 = Math.max(x - size, 0)
  const y1 = Math.max(y - size, 0)

  return [
    x1,
    y1,
    Math.min(w + size * 2, maxX - x1 - 1),
    Math.min(h + size * 2, maxY - y1 - 1),
  ] as const
}

/** Quadrilateral.aabb.xywh, cast to int32 as BBox does. */
const xywh = (line: Quad) => {
  const xs = line.pts.map((point) => point.x)
  const ys = line.pts.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)

  return [
    Math.trunc(x),
    Math.trunc(y),
    Math.trunc(Math.max(...xs) - x),
    Math.trunc(Math.max(...ys) - y),
  ] as const
}

const crop = (
  data: Uint8Array,
  width: number,
  channels: number,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const out = new Uint8Array(w * h * channels)

  for (let row = 0; row < h; row += 1) {
    const start = ((y + row) * width + x) * channels

    out.set(data.subarray(start, start + w * channels), row * w * channels)
  }

  return out
}

const dilated = (cv: Cv, data: Uint8Array, width: number, height: number, size: number) => {
  const source = cv.matFromArray(height, width, cv.CV_8UC1, data)
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size))
  const out = new cv.Mat()

  cv.dilate(source, out, kernel)

  const result = Uint8Array.from(out.data)

  source.delete()
  kernel.delete()
  out.delete()

  return result
}

const crfOptions = {
  gaussianXy: 1,
  gaussianCompat: 3,
  bilateralXy: 23,
  bilateralRgb: 7,
  bilateralCompat: 20,
  iterations: 5,
}

/**
 * The refined text mask at full page size. `lines` are each block's text lines in page coordinates; the
 * page itself must already be in the helper as image 1.
 */
export const refineMask = Effect.fnUntraced(function* (
  cv: Cv,
  helper: MangaCv['Service'],
  page: { readonly width: number; readonly height: number },
  rawMask: GreyImage,
  lines: ReadonlyArray<ReadonlyArray<Point>>,
  options: { readonly dilationOffset: number; readonly kernelSize: number } = {
    dilationOffset: 0,
    kernelSize: 3,
  },
) {
  const scale = Math.max(Math.min((rawMask.height - page.height / 3) / rawMask.height, 1), 0.5)
  const width = Math.trunc(page.width * scale)
  const height = Math.trunc(page.height * scale)

  yield* helper.resize(pageId, scaledId, width, height)
  yield* helper.bilateral(scaledId, filteredId, 17, 80, 80)

  const filtered = yield* helper.get(filteredId)

  yield* helper.put(maskId, { ...rawMask, channels: 1 })
  yield* helper.resize(maskId, maskScaledId, width, height)

  const mask = Uint8Array.from((yield* helper.get(maskScaledId)).data, (value) =>
    value > 0 ? 255 : 0,
  )

  yield* Effect.forEach([scaledId, filteredId, maskId, maskScaledId], (id) => helper.drop(id), {
    discard: true,
  })

  const textlines = lines.map((pts) =>
    quad(
      pts.map((point) => ({ x: point.x * scale, y: point.y * scale })),
      0,
    ),
  )

  const maskMat = cv.matFromArray(height, width, cv.CV_8UC1, mask)

  for (const line of textlines) {
    const [x, y, w, h] = xywh(line)

    cv.rectangle(maskMat, new cv.Point(x, y), new cv.Point(x + w, y + h), new cv.Scalar(0), 1)
  }

  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const centroids = new cv.Mat()
  const count = cv.connectedComponentsWithStats(maskMat, labels, stats, centroids)

  maskMat.delete()
  centroids.delete()

  const areas = textlines.map((line) => shoelace(line.pts))
  const assigned = textlines.map(() => new Set<number>())

  const rects: Array<readonly [number, number, number, number] | undefined> = textlines.map(
    () => undefined,
  )

  let valid = false

  for (let label = 1; label < count; label += 1) {
    const stat = (column: number) => stats.data32S[label * 5 + column] ?? 0
    const [x1, y1, w1, h1, area1] = [stat(0), stat(1), stat(2), stat(3), stat(4)]

    if (area1 <= 9) {
      continue
    }

    const ratios = textlines.map((line, index) =>
      f(clippedArea(line.pts, x1, y1, x1 + w1, y1 + h1) / Math.min(area1, areas[index] ?? 0)),
    )

    const distances = textlines.map((line) =>
      f(pointPolygonDistance({ x: x1 + w1 / 2, y: y1 + h1 / 2 }, line.pts)),
    )

    let target = ratios.indexOf(Math.max(...ratios))

    if (area1 >= (areas[target] ?? 0)) {
      continue
    }

    if ((ratios[target] ?? 0) <= 1e-2) {
      target = distances.indexOf(Math.min(...distances))

      const near = textlines[target]
      const unit = Math.max(Math.min(near === undefined ? 0 : fontSize(near), w1, h1), 10)

      if ((distances[target] ?? 0) >= 0.5 * unit) {
        continue
      }
    }

    assigned[target]?.add(label)

    const rect = rects[target]

    rects[target] =
      rect === undefined
        ? [x1, y1, x1 + w1, y1 + h1]
        : [
            Math.min(rect[0], x1),
            Math.min(rect[1], y1),
            Math.max(rect[2], x1 + w1),
            Math.max(rect[3], y1 + h1),
          ]

    valid = true
  }

  stats.delete()

  const final = new Uint8Array(width * height)

  if (valid) {
    for (const [index, line] of textlines.entries()) {
      const rect = rects[index]
      const mine = assigned[index] ?? new Set<number>()

      if (rect === undefined) {
        continue
      }

      const [rx, ry, rr, rb] = rect
      const textSize = Math.min(rr - rx, rb - ry, fontSize(line))

      const [x1, y1, w1, h1] = extendRect(
        rx,
        ry,
        rr - rx,
        rb - ry,
        width,
        height,
        Math.trunc(textSize * 0.1),
      )

      const dilateSize = Math.max(
        Math.floor(Math.trunc((textSize + options.dilationOffset) * 0.3) / 2) * 2 + 1,
        3,
      )

      if (w1 <= 0 || h1 <= 0) {
        continue
      }

      const [x2, y2, w2, h2] = extendRect(x1, y1, w1, h1, width, height, Math.ceil(dilateSize / 2))
      const cc = new Uint8Array(w2 * h2)

      for (let row = 0; row < h2; row += 1) {
        for (let column = 0; column < w2; column += 1) {
          const label = labels.data32S[(y2 + row) * width + x2 + column] ?? 0

          cc[row * w2 + column] = mine.has(label) ? 255 : 0
        }
      }

      const regionMask = crop(cc, w2, 1, x1 - x2, y1 - y2, w1, h1)

      const refined = yield* helper.crf(
        { width: w1, height: h1, channels: 3, data: crop(filtered.data, width, 3, x1, y1, w1, h1) },
        regionMask,
        crfOptions,
      )

      for (let row = 0; row < h1; row += 1) {
        cc.set(refined.subarray(row * w1, (row + 1) * w1), (y1 - y2 + row) * w2 + x1 - x2)
      }

      const grown = dilated(cv, cc, w2, h2, dilateSize)

      for (let row = 0; row < h2; row += 1) {
        for (let column = 0; column < w2; column += 1) {
          const at = (y2 + row) * width + x2 + column

          final[at] = (final[at] ?? 0) | (grown[row * w2 + column] ?? 0)
        }
      }
    }
  }

  labels.delete()

  const finished = valid ? dilated(cv, final, width, height, options.kernelSize) : final

  yield* helper.put(finalId, { width, height, channels: 1, data: finished })
  yield* helper.resize(finalId, finalFullId, page.width, page.height)

  const full = yield* helper.get(finalFullId)

  yield* Effect.forEach([finalId, finalFullId], (id) => helper.drop(id), { discard: true })

  return Uint8Array.from(full.data, (value) => (value > 0 ? 255 : 0))
})
