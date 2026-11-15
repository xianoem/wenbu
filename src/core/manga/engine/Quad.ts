import type { Point } from './DbBoxes'

/** A port of manga-image-translator's Quadrilateral: one detected text line. */
export interface Quad {
  readonly pts: readonly [Point, Point, Point, Point]
  readonly vertical: boolean
  readonly score: number
}

const origin: Point = { x: 0, y: 0 }

const stableArgsort = (values: ReadonlyArray<number>) =>
  values
    .map((value, index) => ({ value, index }))
    .toSorted((a, b) => a.value - b.value)
    .map((entry) => entry.index)

/** sort_pnts: orders the corners and tells whether the line runs vertically. */
export const sortPoints = (
  input: ReadonlyArray<Point>,
): { readonly pts: Quad['pts']; readonly vertical: boolean } => {
  const pairs: Array<Point> = []

  for (const a of input) {
    for (const b of input) {
      pairs.push({ x: a.x - b.x, y: a.y - b.y })
    }
  }

  const order = stableArgsort(pairs.map((vector) => Math.hypot(vector.x, vector.y)))
  const first = pairs[order[8] ?? 0] ?? { x: 0, y: 0 }
  const second = pairs[order[10] ?? 0] ?? { x: 0, y: 0 }
  const aligned = first.x * second.x + first.y * second.y < 0 ? { x: -first.x, y: -first.y } : first

  const structure = {
    x: Math.abs((aligned.x + second.x) / 2),
    y: Math.abs((aligned.y + second.y) / 2),
  }

  const vertical = structure.x <= structure.y

  if (vertical) {
    const byY = stableArgsort(input.map((point) => point.y)).map(
      (index) => input[index] ?? { x: 0, y: 0 },
    )

    const top = byY.slice(0, 2)
    const bottom = byY.slice(2)
    const topOrder = stableArgsort(top.map((point) => point.x))
    const bottomOrder = stableArgsort(bottom.map((point) => point.x)).toReversed()

    const at = (list: ReadonlyArray<Point>, order: ReadonlyArray<number>, index: number) =>
      list[order[index] ?? 0] ?? origin

    return {
      pts: [
        at(top, topOrder, 0),
        at(top, topOrder, 1),
        at(bottom, bottomOrder, 0),
        at(bottom, bottomOrder, 1),
      ],
      vertical,
    }
  }

  const byX = stableArgsort(input.map((point) => point.x)).map(
    (index) => input[index] ?? { x: 0, y: 0 },
  )

  const byY = (a: Point, b: Point) => a.y - b.y
  const [leftTop = origin, leftBottom = origin] = [byX[0] ?? origin, byX[1] ?? origin].toSorted(byY)

  const [rightTop = origin, rightBottom = origin] = [byX[2] ?? origin, byX[3] ?? origin].toSorted(
    byY,
  )

  return { pts: [leftTop, rightTop, rightBottom, leftBottom], vertical }
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** The area of the points' convex hull, as shapely's MultiPoint(...).convex_hull.area. */
export const hullArea = (points: ReadonlyArray<Point>) => {
  const sorted = points.toSorted((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  if (sorted.length < 3) {
    return 0
  }

  const build = (list: ReadonlyArray<Point>) => {
    const hull: Array<Point> = []

    for (const point of list) {
      while (hull.length >= 2 && cross(hull.at(-2) ?? point, hull.at(-1) ?? point, point) <= 0) {
        hull.pop()
      }

      hull.push(point)
    }

    hull.pop()

    return hull
  }

  const hull = [...build(sorted), ...build(sorted.toReversed())]
  let area = 0

  hull.forEach((point, index) => {
    const next = hull[(index + 1) % hull.length] ?? point

    area += point.x * next.y - next.x * point.y
  })

  return Math.abs(area) / 2
}

export const quad = (points: ReadonlyArray<Point>, score: number): Quad => {
  const sorted = sortPoints(points)

  return { pts: sorted.pts, vertical: sorted.vertical, score }
}

export const quadArea = (line: Quad) => hullArea(line.pts)
