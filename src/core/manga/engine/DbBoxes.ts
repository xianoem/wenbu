import ClipperLib from 'clipper-lib'
import type { Cv } from './OpenCv'

/** A port of manga-image-translator's SegDetectorRepresenter.boxes_from_bitmap (DBNet post-processing). */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface DbOptions {
  readonly threshold: number
  readonly boxThreshold: number
  readonly unclipRatio: number
  readonly maxCandidates: number
}

export const defaultDbOptions: DbOptions = {
  threshold: 0.5,
  boxThreshold: 0.7,
  unclipRatio: 2.3,
  maxCandidates: 1000,
}

const minSize = 3

const f = Math.fround

/** numpy's round: halves go to the even neighbour. */
export const roundHalfEven = (value: number) => {
  const floor = Math.floor(value)
  const fraction = value - floor

  if (fraction > 0.5) {
    return floor + 1
  }

  if (fraction < 0.5) {
    return floor
  }

  return floor % 2 === 0 ? floor : floor + 1
}

/** cv::RotatedRect::points, in the float arithmetic OpenCV uses. */
const rectPoints = (cx: number, cy: number, width: number, height: number, angle: number) => {
  const radians = (angle * Math.PI) / 180
  const b = f(f(Math.cos(radians)) * 0.5)
  const a = f(f(Math.sin(radians)) * 0.5)
  const x0 = f(f(cx - f(a * height)) - f(b * width))
  const y0 = f(f(cy + f(b * height)) - f(a * width))
  const x1 = f(f(cx + f(a * height)) - f(b * width))
  const y1 = f(f(cy - f(b * height)) - f(a * width))

  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
    { x: f(f(2 * cx) - x0), y: f(f(2 * cy) - y0) },
    { x: f(f(2 * cx) - x1), y: f(f(2 * cy) - y1) },
  ]
}

/** get_mini_boxes: the min-area rectangle's corners ordered top-left, top-right, bottom-right, bottom-left. */
export const miniBox = (cv: Cv, points: ReadonlyArray<Point>) => {
  const flat = new Int32Array(points.length * 2)

  points.forEach((point, index) => {
    flat[index * 2] = point.x
    flat[index * 2 + 1] = point.y
  })

  const mat = cv.matFromArray(points.length, 1, cv.CV_32SC2, Array.from(flat))
  const rect = cv.minAreaRect(mat)

  mat.delete()

  const origin = { x: 0, y: 0 }

  const [p0 = origin, p1 = origin, p2 = origin, p3 = origin] = rectPoints(
    rect.center.x,
    rect.center.y,
    rect.size.width,
    rect.size.height,
    rect.angle,
  ).toSorted((left, right) => left.x - right.x)

  const [first, fourth] = p1.y > p0.y ? [p0, p1] : [p1, p0]
  const [second, third] = p3.y > p2.y ? [p2, p3] : [p3, p2]

  return { box: [first, second, third, fourth], side: Math.min(rect.size.width, rect.size.height) }
}

/** box_score_fast: the mean of the map inside the polygon's filled outline. */
const boxScore = (
  cv: Cv,
  pred: Float32Array,
  width: number,
  height: number,
  points: ReadonlyArray<Point>,
) => {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const clamp = (value: number, top: number) => Math.min(Math.max(value, 0), top)
  const xmin = clamp(Math.floor(Math.min(...xs)), width - 1)
  const xmax = clamp(Math.ceil(Math.max(...xs)), width - 1)
  const ymin = clamp(Math.floor(Math.min(...ys)), height - 1)
  const ymax = clamp(Math.ceil(Math.max(...ys)), height - 1)
  const w = xmax - xmin + 1
  const h = ymax - ymin + 1
  const mask = cv.Mat.zeros(h, w, cv.CV_8UC1)

  const polygon = cv.matFromArray(
    points.length,
    1,
    cv.CV_32SC2,
    points.flatMap((point) => [Math.trunc(point.x - xmin), Math.trunc(point.y - ymin)]),
  )

  const polygons = new cv.MatVector()

  polygons.push_back(polygon)
  cv.fillPoly(mask, polygons, new cv.Scalar(1))

  let sum = 0
  let count = 0

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask.data[y * w + x] !== 0) {
        sum += pred[(ymin + y) * width + xmin + x] ?? 0
        count += 1
      }
    }
  }

  polygon.delete()
  polygons.delete()
  mask.delete()

  return count === 0 ? 0 : sum / count
}

/** unclip: grows the box by area * ratio / perimeter with Clipper's round joins, as pyclipper does. */
const unclip = (box: ReadonlyArray<Point>, ratio: number) => {
  let area = 0
  let length = 0

  box.forEach((point, index) => {
    const next = box[(index + 1) % box.length] ?? point

    area += point.x * next.y - next.x * point.y
    length += Math.hypot(next.x - point.x, next.y - point.y)
  })

  const distance = ((Math.abs(area) / 2) * ratio) / length
  const offset = new ClipperLib.ClipperOffset(2, 0.25)
  const solution: Array<Array<{ X: number; Y: number }>> = []

  offset.AddPath(
    box.map((point) => ({ X: Math.trunc(point.x), Y: Math.trunc(point.y) })),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  )

  offset.Execute(solution, distance)

  return solution.flat().map((point) => ({ x: point.X, y: point.Y }))
}

export interface DbBox {
  readonly points: ReadonlyArray<Point>
  readonly score: number
}

const contoursOf = (
  cv: Cv,
  pred: Float32Array,
  width: number,
  height: number,
  threshold: number,
) => {
  const bitmap = new cv.Mat(height, width, cv.CV_8UC1)

  for (let index = 0; index < width * height; index += 1) {
    bitmap.data[index] = (pred[index] ?? 0) > threshold ? 255 : 0
  }

  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  cv.findContours(bitmap, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

  const found: Array<Array<Point>> = []

  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index)
    const points: Array<Point> = []

    for (let point = 0; point < contour.rows; point += 1) {
      points.push({ x: contour.data32S[point * 2] ?? 0, y: contour.data32S[point * 2 + 1] ?? 0 })
    }

    found.push(points)
    contour.delete()
  }

  bitmap.delete()
  contours.delete()
  hierarchy.delete()

  return found
}

/** Boxes from a DBNet probability map, in the coordinates of a `destWidth` × `destHeight` image. */
export const dbBoxes = (
  cv: Cv,
  pred: Float32Array,
  width: number,
  height: number,
  destWidth: number,
  destHeight: number,
  options: DbOptions = defaultDbOptions,
): ReadonlyArray<DbBox> => {
  const boxes: Array<DbBox> = []

  const contours = contoursOf(cv, pred, width, height, options.threshold).slice(
    0,
    options.maxCandidates,
  )

  for (const contour of contours) {
    const first = miniBox(cv, contour)

    if (first.side < minSize) {
      continue
    }

    const score = boxScore(cv, pred, width, height, contour)

    if (options.boxThreshold > score) {
      continue
    }

    const expanded = unclip(first.box, options.unclipRatio)

    if (expanded.length === 0) {
      continue
    }

    const second = miniBox(cv, expanded)

    if (second.side < minSize + 2) {
      continue
    }

    const scaled = second.box.map((point) => ({
      x: Math.min(Math.max(roundHalfEven(f(f(f(point.x) / width) * destWidth)), 0), destWidth),
      y: Math.min(Math.max(roundHalfEven(f(f(f(point.y) / height) * destHeight)), 0), destHeight),
    }))

    const sums = scaled.map((point) => point.x + point.y)
    const start = sums.indexOf(Math.min(...sums))
    const rolled = [...scaled.slice(start), ...scaled.slice(0, start)]

    boxes.push({ points: rolled, score })
  }

  return boxes
}
