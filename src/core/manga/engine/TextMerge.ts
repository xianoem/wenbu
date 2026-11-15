import { type Point, roundHalfEven } from './DbBoxes'
import type { PanelBox } from './Kumiko'
import { pySetOrder } from './PySet'
import { hullArea, type Quad } from './Quad'

/**
 * A port of how the manga plugin turns detected text lines into blocks: the 48px OCR's direction vote
 * and line order (ocr/common.py, ocr/model_48px.py), the networkx merge (textline_merge), TextBlock's
 * geometry and sort_regions. numpy's float32 arithmetic is reproduced where the plugin used it.
 */

type Direction = 'h' | 'v'

export interface Line extends Quad {
  readonly direction: Direction
}

export interface Block {
  readonly lines: ReadonlyArray<Line>
  readonly fontSize: number
  readonly angle: number
  readonly xyxy: readonly [number, number, number, number]
  readonly vertical: boolean
}

const f = Math.fround

const f32Norm = (x: number, y: number) => f(Math.sqrt(f(f(f(x) * f(x)) + f(f(y) * f(y)))))

/** numpy's pairwise sum for float32 arrays, then the float32 division np.mean does. */
const f32Mean = (values: ReadonlyArray<number>) => {
  const sum = (start: number, count: number): number => {
    if (count < 8) {
      let total = 0

      for (let i = 0; i < count; i += 1) {
        total = f(total + (values[start + i] ?? 0))
      }

      return total
    }

    if (count <= 128) {
      const r = Array.from({ length: 8 }, (_, j) => f(values[start + j] ?? 0))
      let i = 8

      for (; i < count - (count % 8); i += 8) {
        for (let j = 0; j < 8; j += 1) {
          r[j] = f((r[j] ?? 0) + (values[start + i + j] ?? 0))
        }
      }

      const [r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0, r6 = 0, r7 = 0] = r
      let total = f(f(f(r0 + r1) + f(r2 + r3)) + f(f(r4 + r5) + f(r6 + r7)))

      for (; i < count; i += 1) {
        total = f(total + (values[start + i] ?? 0))
      }

      return total
    }

    let half = Math.floor(count / 2)

    half -= half % 8

    return f(sum(start, half) + sum(start + half, count - half))
  }

  return f(sum(0, values.length) / values.length)
}

const mean = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0) / values.length

const std = (values: ReadonlyArray<number>) => {
  const average = mean(values)

  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

const structure = (line: Quad) => {
  const [a, b, c, d] = line.pts

  const mid = (p: Point, q: Point): Point => ({
    x: Math.trunc((p.x + q.x) / 2),
    y: Math.trunc((p.y + q.y) / 2),
  })

  return [mid(a, b), mid(c, d), mid(b, c), mid(d, a)] as const
}

const vectors = (line: Quad) => {
  const [l1a, l1b, l2a, l2b] = structure(line)

  return {
    v1: { x: l1b.x - l1a.x, y: l1b.y - l1a.y },
    v2: { x: l2b.x - l2a.x, y: l2b.y - l2a.y },
  }
}

const aspectRatio = (line: Quad) => {
  const { v1, v2 } = vectors(line)

  return f(f32Norm(v2.x, v2.y) / f32Norm(v1.x, v1.y))
}

export const fontSize = (line: Quad) => {
  const { v1, v2 } = vectors(line)

  return Math.min(f32Norm(v2.x, v2.y), f32Norm(v1.x, v1.y))
}

const unitV1 = (line: Quad) => {
  const { v1 } = vectors(line)
  const norm = f32Norm(v1.x, v1.y)

  return { x: f(v1.x / norm), y: f(v1.y / norm) }
}

const unitV2 = (line: Quad) => {
  const { v2 } = vectors(line)
  const norm = f32Norm(v2.x, v2.y)

  return { x: f(v2.x / norm), y: f(v2.y / norm) }
}

const angleOf = (line: Quad) => {
  const cosangle = unitV1(line).x

  return (Math.acos(cosangle) + Math.PI) % Math.PI
}

const approximatelyAxisAligned = (line: Quad) => {
  const u1 = unitV1(line)
  const u2 = unitV2(line)

  return (
    Math.abs(u1.y) < 0.05 || Math.abs(u1.x) < 0.05 || Math.abs(u2.y) < 0.05 || Math.abs(u2.x) < 0.05
  )
}

const centroid = (line: Quad) => ({
  x: (line.pts[0].x + line.pts[1].x + line.pts[2].x + line.pts[3].x) / 4,
  y: (line.pts[0].y + line.pts[1].y + line.pts[2].y + line.pts[3].y) / 4,
})

const aabb = (line: Quad) => {
  const xs = line.pts.map((point) => point.x)
  const ys = line.pts.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)

  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

const pointSegmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy

  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))

  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)

  const onSegment = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  )
}

const inside = (p: Point, polygon: ReadonlyArray<Point>) => {
  let result = false

  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a

    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      result = !result
    }
  })

  return result
}

const edges = (polygon: ReadonlyArray<Point>) =>
  polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length] ?? a] as const)

/** shapely's Polygon.distance: zero when the polygons touch or overlap. */
export const polygonDistance = (first: ReadonlyArray<Point>, second: ReadonlyArray<Point>) => {
  const firstEdges = edges(first)
  const secondEdges = edges(second)

  if (
    firstEdges.some(([a, b]) => secondEdges.some(([c, d]) => segmentsCross(a, b, c, d))) ||
    inside(first[0] ?? { x: 0, y: 0 }, second) ||
    inside(second[0] ?? { x: 0, y: 0 }, first)
  ) {
    return 0
  }

  let best = Number.POSITIVE_INFINITY

  for (const p of first) {
    for (const [a, b] of secondEdges) {
      best = Math.min(best, pointSegmentDistance(p, a, b))
    }
  }

  for (const p of second) {
    for (const [a, b] of firstEdges) {
      best = Math.min(best, pointSegmentDistance(p, a, b))
    }
  }

  return best
}

const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)

/** Quadrilateral.distance_impl, which depends on the direction the OCR assigned. */
const lineDistance = (self: Line, other: Line, rho = 0.5) => {
  const fs = Math.max(fontSize(self), fontSize(other))
  const s = structure(self)
  const o = structure(other)

  if (self.direction === 'h') {
    const dist1 = hullArea([self.pts[0], self.pts[3], other.pts[0], other.pts[3]]) / fs
    const dist2 = hullArea([self.pts[2], self.pts[1], other.pts[2], other.pts[1]]) / fs
    const dist3 = hullArea([s[0], s[1], o[0], o[1]]) / fs
    let pattern = 'h_left'

    if (dist1 < fs * rho) {
      pattern = 'h_left'
    }

    if (dist2 < fs * rho && dist2 < dist1) {
      pattern = 'h_right'
    }

    if (dist3 < fs * rho && dist3 < dist1 && dist3 < dist2) {
      pattern = 'h_middle'
    }

    if (pattern === 'h_left') {
      return distance(self.pts[0].x, self.pts[0].y, other.pts[0].x, other.pts[0].y)
    }

    if (pattern === 'h_right') {
      return distance(self.pts[1].x, self.pts[1].y, other.pts[1].x, other.pts[1].y)
    }

    return distance(s[0].x, s[0].y, o[0].x, o[0].y)
  }

  const dist1 = hullArea([self.pts[0], self.pts[1], other.pts[0], other.pts[1]]) / fs
  const dist2 = hullArea([self.pts[2], self.pts[3], other.pts[2], other.pts[3]]) / fs
  let top = true

  if (dist1 < fs * rho) {
    top = true
  }

  if (dist2 < fs * rho && dist2 < dist1) {
    top = false
  }

  return top
    ? distance(self.pts[0].x, self.pts[0].y, other.pts[0].x, other.pts[0].y)
    : distance(self.pts[2].x, self.pts[2].y, other.pts[2].x, other.pts[2].y)
}

interface MergeTolerances {
  readonly ratio: number
  readonly discardConnectionGap: number
  readonly charGapTolerance: number
  readonly charGapTolerance2: number
  readonly fontSizeRatioTol: number
  readonly aspectRatioTol: number
}

const defaults: MergeTolerances = {
  ratio: 1.9,
  discardConnectionGap: 2,
  charGapTolerance: 0.6,
  charGapTolerance2: 1.5,
  fontSizeRatioTol: 1.5,
  aspectRatioTol: 2,
}

/** quadrilateral_can_merge_region. */
const canMerge = (a: Quad, b: Quad, t: MergeTolerances) => {
  const b1 = aabb(a)
  const b2 = aabb(b)
  const charSize = Math.min(fontSize(a), fontSize(b))
  const dist = polygonDistance(a.pts, b.pts)

  if (dist > t.discardConnectionGap * charSize) {
    return false
  }

  if (f(Math.max(fontSize(a), fontSize(b)) / charSize) > t.fontSizeRatioTol) {
    return false
  }

  if (aspectRatio(a) > t.aspectRatioTol && aspectRatio(b) < 1 / t.aspectRatioTol) {
    return false
  }

  if (aspectRatio(b) > t.aspectRatioTol && aspectRatio(a) < 1 / t.aspectRatioTol) {
    return false
  }

  if (approximatelyAxisAligned(a) && approximatelyAxisAligned(b)) {
    if (dist >= charSize * t.charGapTolerance) {
      return false
    }

    if (
      Math.abs(b1.x + Math.floor(b1.w / 2) - (b2.x + Math.floor(b2.w / 2))) < t.charGapTolerance2
    ) {
      return true
    }

    if (b1.w > b1.h * t.ratio && b2.h > b2.w * t.ratio) {
      return false
    }

    if (b2.w > b2.h * t.ratio && b1.h > b1.w * t.ratio) {
      return false
    }

    if (b1.w > b1.h * t.ratio || b2.w > b2.h * t.ratio) {
      return (
        Math.abs(b1.x - b2.x) < charSize * t.charGapTolerance2 ||
        Math.abs(b1.x + b1.w - (b2.x + b2.w)) < charSize * t.charGapTolerance2
      )
    }

    if (b1.h > b1.w * t.ratio || b2.h > b2.w * t.ratio) {
      return (
        Math.abs(b1.y - b2.y) < charSize * t.charGapTolerance2 ||
        Math.abs(b1.y + b1.h - (b2.y + b2.h)) < charSize * t.charGapTolerance2
      )
    }

    return false
  }

  if (Math.abs(angleOf(a) - angleOf(b)) < (15 * Math.PI) / 180) {
    const fsA = fontSize(a)
    const fsB = fontSize(b)
    const fs = Math.min(fsA, fsB)

    if (dist > fs * t.charGapTolerance2) {
      return false
    }

    return f(f(Math.abs(f(fsA - fsB))) / fs) <= 0.25
  }

  return false
}

/** networkx's undirected graph: adjacency in insertion order, components as CPython sets. */
class Graph {
  readonly nodes: ReadonlyArray<number>
  private readonly adjacency = new Map<number, Array<number>>()

  constructor(nodes: ReadonlyArray<number>) {
    this.nodes = nodes

    for (const node of nodes) {
      this.adjacency.set(node, [])
    }
  }

  addEdge(u: number, v: number) {
    const fromU = this.adjacency.get(u) ?? []

    if (!fromU.includes(v)) {
      fromU.push(v)
      this.adjacency.get(v)?.push(u)
    }
  }

  /** connected_components: each component's members in the order Python iterates the set. */
  components() {
    const seen = new Set<number>()
    const found: Array<ReadonlyArray<number>> = []

    for (const source of this.nodes) {
      if (seen.has(source)) {
        continue
      }

      const inserted = [source]
      const local = new Set([source])
      let level = [source]

      while (level.length > 0) {
        const next: Array<number> = []

        for (const v of level) {
          for (const w of this.adjacency.get(v) ?? []) {
            if (!local.has(w)) {
              local.add(w)
              inserted.push(w)
              next.push(w)
            }
          }

          if (local.size === this.nodes.length) {
            break
          }
        }

        if (local.size === this.nodes.length) {
          break
        }

        level = next
      }

      for (const node of local) {
        seen.add(node)
      }

      found.push(pySetOrder(inserted))
    }

    return found
  }
}

/** The 48px OCR's direction pass, then its output order: lines sorted by the width of their 48px crops. */
export const assignDirections = (lines: ReadonlyArray<Quad>): ReadonlyArray<Line> => {
  const graph = new Graph(lines.map((_, index) => index))

  lines.forEach((u, i) => {
    lines.forEach((v, j) => {
      if (j > i && canMerge(u, v, { ...defaults, aspectRatioTol: 1 })) {
        graph.addEdge(i, j)
      }
    })
  })

  const directed: Array<Line> = []

  for (const component of graph.components()) {
    const directions = component.map((index) => (lines[index]?.vertical ? 'v' : 'h'))
    const vertical = directions.filter((direction) => direction === 'v').length
    const horizontal = directions.length - vertical
    const firstDirection = directions[0] ?? 'h'

    const majority: Direction =
      vertical === horizontal ? firstDirection : vertical > horizontal ? 'v' : 'h'

    const keyed = component.map((index) => {
      const line = lines[index] ?? lines[0]
      const box = line === undefined ? { x: 0, y: 0, w: 0, h: 0 } : aabb(line)

      return { index, key: majority === 'h' ? box.y + Math.floor(box.h / 2) : -(box.x + box.w) }
    })

    for (const { index } of keyed.toSorted((a, b) => a.key - b.key)) {
      const line = lines[index]

      if (line !== undefined) {
        directed.push({ ...line, direction: majority })
      }
    }
  }

  const cropWidth = (line: Line) => {
    const { v1, v2 } = vectors(line)
    const ratio = f(f32Norm(v1.x, v1.y) / f32Norm(v2.x, v2.y))

    return Math.max(roundHalfEven(line.direction === 'h' ? 48 / ratio : 48 * ratio), 2)
  }

  return directed
    .map((line, index) => ({ line, index, width: cropWidth(line) }))
    .toSorted((a, b) => a.width - b.width)
    .map((entry) => entry.line)
}

const splitRegion = (
  lines: ReadonlyArray<Line>,
  members: ReadonlyArray<number>,
): Array<ReadonlyArray<number>> => {
  const gamma = 0.5
  const sigma = 2
  const at = (index: number) => lines[index] ?? lines[0]

  if (members.length === 1) {
    return [pySetOrder(members)]
  }

  if (members.length === 2) {
    const [first = 0, second = 0] = members
    const a = at(first)
    const b = at(second)

    if (a === undefined || b === undefined) {
      return [pySetOrder(members)]
    }

    const fs = Math.max(fontSize(a), fontSize(b))

    if (
      lineDistance(a, b) < (1 + gamma) * fs &&
      Math.abs(angleOf(a) - angleOf(b)) < 0.2 * Math.PI
    ) {
      return [pySetOrder(members)]
    }

    return [[first], [second]]
  }

  const all: Array<{ u: number; v: number; weight: number }> = []

  members.forEach((u, i) => {
    for (const v of members.slice(i + 1)) {
      const a = at(u)
      const b = at(v)

      all.push({ u, v, weight: a === undefined || b === undefined ? 0 : lineDistance(a, b) })
    }
  })

  const parent = new Map<number, number>()

  const root = (node: number): number => {
    const up = parent.get(node) ?? node

    return up === node ? node : root(up)
  }

  const tree: Array<{ u: number; v: number; weight: number }> = []

  for (const edge of all.toSorted((a, b) => a.weight - b.weight)) {
    if (root(edge.u) !== root(edge.v)) {
      tree.push(edge)
      parent.set(root(edge.u), root(edge.v))
    }
  }

  const descending = tree.toSorted((a, b) => b.weight - a.weight)
  const weights = descending.map((edge) => edge.weight)

  const fontsize = f32Mean(
    members.map((index) => {
      const line = at(index)

      return line === undefined ? 0 : fontSize(line)
    }),
  )

  const deviation = std(weights)
  const average = mean(weights)
  const stdThreshold = Math.max(0.3 * fontsize + 5, 5)
  const longest = descending[0]
  const b1 = longest === undefined ? undefined : at(longest.u)
  const b2 = longest === undefined ? undefined : at(longest.v)
  const polyDistance = b1 === undefined || b2 === undefined ? 0 : polygonDistance(b1.pts, b2.pts)

  const alignment =
    b1 === undefined || b2 === undefined
      ? 0
      : Math.min(
          Math.abs(centroid(b1).x - centroid(b2).x),
          Math.abs(centroid(b1).y - centroid(b2).y),
        )

  const top = weights[0] ?? 0

  if (
    (top <= average + deviation * sigma || top <= fontsize * (1 + gamma)) &&
    (deviation < stdThreshold || (polyDistance === 0 && alignment < 5))
  ) {
    return [pySetOrder(members)]
  }

  const rest = new Graph(members)

  for (const edge of descending.slice(1)) {
    rest.addEdge(edge.u, edge.v)
  }

  return rest.components().flatMap((component) => splitRegion(lines, component))
}

const blockDirection = (lines: ReadonlyArray<Line>) => {
  let largest = 0
  let aspect = 1

  for (const line of lines) {
    let area = 0

    line.pts.forEach((point, index) => {
      const next = line.pts[(index + 1) % 4] ?? point

      area += point.x * next.y - next.x * point.y
    })

    if (Math.abs(area) / 2 > largest) {
      largest = Math.abs(area) / 2

      const box = aabb(line)

      aspect = box.h > 0 ? box.w / box.h : 1
    }
  }

  return aspect < 1
}

/** merge_bboxes_text_region and textline_merge.dispatch: blocks of lines, each in reading order. */
export const mergeLines = (lines: ReadonlyArray<Line>): ReadonlyArray<Block> => {
  const graph = new Graph(lines.map((_, index) => index))

  lines.forEach((u, i) => {
    lines.forEach((v, j) => {
      if (
        j > i &&
        canMerge(u, v, {
          ...defaults,
          aspectRatioTol: 1.3,
          fontSizeRatioTol: 2,
          charGapTolerance: 1,
          charGapTolerance2: 3,
        })
      ) {
        graph.addEdge(i, j)
      }
    })
  })

  const regions = graph.components().flatMap((component) => splitRegion(lines, component))

  return regions.map((members) => {
    const entries = members.flatMap((index) => {
      const line = lines[index]

      return line === undefined ? [] : [{ index, line }]
    })

    const counts = new Map<Direction, number>()

    for (const { line } of entries) {
      counts.set(line.direction, (counts.get(line.direction) ?? 0) + 1)
    }

    const ranked = [...counts.entries()].toSorted((a, b) => b[1] - a[1])
    let majority: Direction = ranked[0]?.[0] ?? 'h'

    if (ranked.length > 1 && ranked[0]?.[1] === ranked[1]?.[1]) {
      let best = -100

      for (const { line } of entries) {
        const ratio = aspectRatio(line)

        if (ratio > best) {
          best = ratio
          majority = line.direction
        }

        if (1 / ratio > best) {
          best = 1 / ratio
          majority = line.direction
        }
      }
    }

    const ordered = entries
      .toSorted((a, b) =>
        majority === 'h'
          ? centroid(a.line).y - centroid(b.line).y
          : centroid(b.line).x - centroid(a.line).x,
      )
      .map((entry) => entry.line)

    const angle = (mean(ordered.map(angleOf)) * 180) / Math.PI - 90
    const xs = ordered.flatMap((line) => line.pts.map((point) => point.x))
    const ys = ordered.flatMap((line) => line.pts.map((point) => point.y))

    return {
      lines: ordered,
      fontSize: Math.trunc(Math.min(...ordered.map(fontSize))),
      angle: Math.abs(angle) < 3 ? 0 : angle,
      xyxy: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const,
      vertical: blockDirection(ordered),
    }
  })
}

const center = (block: Block) => ({
  x: (block.xyxy[0] + block.xyxy[2]) / 2,
  y: (block.xyxy[1] + block.xyxy[3]) / 2,
})

const simpleSort = (blocks: ReadonlyArray<Block>, rtl: boolean) => {
  const xs = blocks.map((block) => center(block).x)
  const ys = blocks.map((block) => center(block).y)
  const horizontal = blocks.length > 1 && std(xs) > std(ys)
  const sorted: Array<Block> = []

  const flush = (group: ReadonlyArray<Block>, key: (block: Block) => number) =>
    sorted.push(...group.toSorted((a, b) => key(a) - key(b)))

  const across = (block: Block) => (rtl ? -center(block).x : center(block).x)

  const primary = horizontal
    ? blocks.toSorted((a, b) => across(a) - across(b))
    : blocks.toSorted((a, b) => center(a).y - center(b).y)

  let group: Array<Block> = []
  let previous: number | undefined

  for (const block of primary) {
    const value = horizontal ? center(block).x : center(block).y

    if (previous !== undefined && Math.abs(value - previous) > (horizontal ? 20 : 15)) {
      flush(group, horizontal ? (b) => center(b).y : across)
      group = []
    }

    group.push(block)
    previous = value
  }

  if (group.length > 0) {
    flush(group, horizontal ? (b) => center(b).y : across)
  }

  return sorted
}

/** sort_regions: by panel, then within each panel. */
export const sortBlocks = (
  blocks: ReadonlyArray<Block>,
  panels: ReadonlyArray<PanelBox>,
  rtl: boolean,
) => {
  const boxes = panels
    .map((panel) => [panel.x, panel.y, panel.x + panel.width, panel.y + panel.height] as const)
    .toSorted((a, b) => (a[1] === b[1] ? (rtl ? b[0] - a[0] : a[0] - b[0]) : a[1] - b[1]))

  const indexOf = (block: Block) => {
    const { x, y } = center(block)

    const containing = boxes.findIndex(
      ([x1, y1, x2, y2]) => x1 <= x && x <= x2 && y1 <= y && y <= y2,
    )

    if (containing >= 0 || boxes.length === 0) {
      return containing
    }

    const distances = boxes.map(([x1, y1, x2, y2], index) => ({
      d: Math.max(x1 - x, 0, x - x2) ** 2 + Math.max(y1 - y, 0, y - y2) ** 2,
      index,
    }))

    return distances.reduce((best, item) => (item.d < best.d ? item : best)).index
  }

  const grouped = new Map<number, Array<Block>>()

  for (const block of blocks) {
    const index = indexOf(block)

    grouped.set(index, [...(grouped.get(index) ?? []), block])
  }

  return [...grouped.keys()]
    .toSorted((a, b) => a - b)
    .flatMap((index) => simpleSort(grouped.get(index) ?? [], rtl))
}
