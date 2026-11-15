import { roundHalfEven, type Point } from './DbBoxes'
import type { PanelFeatures } from './MangaCv'
import type { Cv } from './OpenCv'

/**
 * A port of Kumiko 1.x as manga-image-translator vendors it (utils/panel/lib), from the contours and
 * line segments the helper reads off the page. Python's quirks are kept on purpose: panels compare
 * equal within a tenth of their size, `list.remove` and `list.index` use that equality, `min` and `max`
 * keep the first best, and the sort uses Panel.__lt__.
 */

export interface PanelBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type Dot = readonly [number, number]

class Segment {
  readonly a: Dot
  readonly b: Dot

  constructor(a: Dot, b: Dot) {
    this.a = [Math.trunc(a[0]), Math.trunc(a[1])]
    this.b = [Math.trunc(b[0]), Math.trunc(b[1])]
  }

  equals(other: Segment) {
    const same = (p: Dot, q: Dot) => p[0] === q[0] && p[1] === q[1]

    return (
      (same(this.a, other.a) && same(this.b, other.b)) ||
      (same(this.a, other.b) && same(this.b, other.a))
    )
  }

  dist() {
    return Math.sqrt(this.distX() ** 2 + this.distY() ** 2)
  }

  distX(keepSign = false) {
    const dist = this.b[0] - this.a[0]

    return keepSign ? dist : Math.abs(dist)
  }

  distY(keepSign = false) {
    const dist = this.b[1] - this.a[1]

    return keepSign ? dist : Math.abs(dist)
  }

  left() {
    return Math.min(this.a[0], this.b[0])
  }

  top() {
    return Math.min(this.a[1], this.b[1])
  }

  right() {
    return Math.max(this.a[0], this.b[0])
  }

  bottom() {
    return Math.max(this.a[1], this.b[1])
  }

  center(): Dot {
    return [Math.trunc(this.left() + this.distX() / 2), Math.trunc(this.top() + this.distY() / 2)]
  }

  mayContain(dot: Dot) {
    return (
      dot[0] >= this.left() &&
      dot[0] <= this.right() &&
      dot[1] >= this.top() &&
      dot[1] <= this.bottom()
    )
  }

  angle() {
    return this.distX() === 0 ? Math.PI / 2 : Math.atan(this.distY() / this.distX())
  }

  angleOkWith(other: Segment) {
    const angle = (Math.abs(this.angle() - other.angle()) * 180) / Math.PI

    return angle < 10 || Math.abs(angle - 180) < 10
  }

  projectedPoint(p: Dot): Dot {
    const ab = [this.b[0] - this.a[0], this.b[1] - this.a[1]] as const

    if (ab[0] === 0 && ab[1] === 0) {
      return this.a
    }

    const ap = [p[0] - this.a[0], p[1] - this.a[1]] as const
    const factor = (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])

    return [roundHalfEven(this.a[0] + factor * ab[0]), roundHalfEven(this.a[1] + factor * ab[1])]
  }

  intersect(other: Segment) {
    const gutter = (Math.max(this.dist(), other.dist()) * 5) / 100

    if (!this.angleOkWith(other)) {
      return undefined
    }

    if (
      this.right() < other.left() - gutter ||
      this.left() > other.right() + gutter ||
      this.bottom() < other.top() - gutter ||
      this.top() > other.bottom() + gutter
    ) {
      return undefined
    }

    const distC = new Segment(other.a, this.projectedPoint(other.a)).dist()
    const distD = new Segment(other.b, this.projectedPoint(other.b)).dist()

    if ((distC + distD) / 2 > gutter) {
      return undefined
    }

    const sorted = [this.a, this.b, other.a, other.b].toSorted(
      (p, q) => p[0] + p[1] - (q[0] + q[1]),
    )

    return new Segment(sorted[1] ?? this.a, sorted[2] ?? this.b)
  }

  union(other: Segment) {
    const intersect = this.intersect(other)

    if (intersect === undefined) {
      return undefined
    }

    const dots = [this.a, this.b, other.a, other.b]

    for (const removed of [intersect.a, intersect.b]) {
      const index = dots.findIndex((dot) => dot[0] === removed[0] && dot[1] === removed[1])

      dots.splice(index, 1)
    }

    return new Segment(dots[0] ?? this.a, dots[1] ?? this.b)
  }

  intersectAll(segments: ReadonlyArray<Segment>) {
    const matches: Array<Segment> = []

    for (const segment of segments) {
      const found = this.intersect(segment)

      if (found !== undefined) {
        matches.push(found)
      }
    }

    return unionAll(matches)
  }

  static alongPolygon(polygon: ReadonlyArray<Dot>, start: number, end: number) {
    const at = (index: number) =>
      polygon[((index % polygon.length) + polygon.length) % polygon.length] ?? [0, 0]

    let split = new Segment(at(start), at(end))
    let i = start
    let j = end

    for (;;) {
      i -= 1

      const add = new Segment(at(i), at(i + 1))

      if (!add.angleOkWith(split)) {
        break
      }

      split = new Segment(add.a, split.b)
    }

    for (;;) {
      j += 1

      const add = new Segment(at(j - 1), at(j))

      if (!add.angleOkWith(split)) {
        break
      }

      split = new Segment(split.a, add.b)
    }

    return split
  }
}

const unionAll = (input: ReadonlyArray<Segment>) => {
  let segments = [...input]
  let merged = true
  let result: Array<Segment> = []

  while (merged) {
    merged = false
    result = []

    const used: Array<Segment> = []

    segments.forEach((s1, i) => {
      for (const s2 of segments.slice(i + 1)) {
        if (used.some((segment) => segment.equals(s2))) {
          continue
        }

        const s3 = s1.union(s2)

        if (s3 !== undefined) {
          merged = true
          result.push(s3)
          used.push(s1, s2)

          break
        }
      }

      if (!used.some((segment) => segment.equals(s1))) {
        result.push(s1)
      }
    })

    segments = result
  }

  return result
}

interface Page {
  readonly width: number
  readonly height: number
  readonly rtl: boolean
  readonly smallRatio: number
  readonly segments: ReadonlyArray<Segment>
  panels: Array<Panel>
}

/** cv::boundingRect for integer points: the width and height count both edges. */
const boundingRect = (points: ReadonlyArray<Dot>) => {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)

  return [x, y, Math.max(...xs) - x + 1, Math.max(...ys) - y + 1] as const
}

class Panel {
  x: number
  y: number
  r: number
  b: number
  splittable: boolean
  readonly page: Page | undefined
  readonly polygon: ReadonlyArray<Dot> | undefined
  private segmentsCache: ReadonlyArray<Segment> | undefined

  constructor(
    page: Page | undefined,
    xywh: readonly [number, number, number, number] | undefined,
    polygon?: ReadonlyArray<Dot>,
    splittable = true,
  ) {
    const box = xywh ?? boundingRect(polygon ?? [])

    this.page = page
    this.x = box[0]
    this.y = box[1]
    this.r = box[0] + box[2]
    this.b = box[1] + box[3]
    this.polygon = polygon
    this.splittable = splittable
  }

  static fromXyrb(page: Page | undefined, x: number, y: number, r: number, b: number) {
    return new Panel(page, [x, y, r - x, b - y])
  }

  get pageOf(): Page {
    if (this.page === undefined) {
      throw new Error('This panel has no page.')
    }

    return this.page
  }

  w() {
    return this.r - this.x
  }

  h() {
    return this.b - this.y
  }

  wt() {
    return this.w() / 10
  }

  ht() {
    return this.h() / 10
  }

  key() {
    return `${this.x}x${this.y}-${this.r}x${this.b}`
  }

  diagonal() {
    return new Segment([this.x, this.y], [this.r, this.b])
  }

  equals(other: Panel) {
    return (
      Math.abs(this.x - other.x) < this.wt() &&
      Math.abs(this.y - other.y) < this.ht() &&
      Math.abs(this.r - other.r) < this.wt() &&
      Math.abs(this.b - other.b) < this.ht()
    )
  }

  lessThan(other: Panel) {
    if (other.y >= this.b - this.ht() && other.y >= this.y - this.ht()) {
      return true
    }

    if (this.y >= other.b - this.ht() && this.y >= other.y - this.ht()) {
      return false
    }

    if (other.x >= this.r - this.wt() && other.x >= this.x - this.wt()) {
      return !this.pageOf.rtl
    }

    if (this.x >= other.r - this.wt() && this.x >= other.x - this.wt()) {
      return this.pageOf.rtl
    }

    return true
  }

  area() {
    return this.w() * this.h()
  }

  isSmall(extraRatio = 1) {
    const page = this.pageOf

    return (
      this.w() < page.width * page.smallRatio * extraRatio ||
      this.h() < page.height * page.smallRatio * extraRatio
    )
  }

  isVerySmall() {
    return this.isSmall(1 / 10)
  }

  overlapPanel(other: Panel) {
    if (this.x > other.r || other.x > this.r || this.y > other.b || other.y > this.b) {
      return undefined
    }

    const x = Math.max(this.x, other.x)
    const y = Math.max(this.y, other.y)
    const r = Math.min(this.r, other.r)
    const b = Math.min(this.b, other.b)

    return new Panel(this.page, [x, y, r - x, b - y])
  }

  overlaps(other: Panel) {
    const overlap = this.overlapPanel(other)

    if (overlap === undefined) {
      return false
    }

    const smallest = Math.min(this.area(), other.area())

    return smallest === 0 || overlap.area() / smallest > 0.1
  }

  contains(other: Panel) {
    const overlap = this.overlapPanel(other)

    if (overlap === undefined) {
      return false
    }

    return overlap.area() / other.area() > 0.5
  }

  sameRow(other: Panel) {
    const [above = this, below = other] = [this, other].toSorted((p, q) => p.y - q.y)

    if (below.y > above.b) {
      return false
    }

    if (below.b < above.b) {
      return true
    }

    const minHeight = Math.min(above.h(), below.h())

    return minHeight === 0 || (Math.min(above.b, below.b) - below.y) / minHeight >= 1 / 3
  }

  sameCol(other: Panel) {
    const [left = this, right = other] = [this, other].toSorted((p, q) => p.x - q.x)

    if (right.x > left.r) {
      return false
    }

    if (right.r < left.r) {
      return true
    }

    const minWidth = Math.min(left.w(), right.w())

    return minWidth === 0 || (Math.min(left.r, right.r) - right.x) / minWidth >= 1 / 3
  }

  findTopPanel() {
    return firstMax(
      this.pageOf.panels.filter((p) => p.b <= this.y && p.sameCol(this)),
      (p) => p.b,
    )
  }

  findBottomPanel() {
    return firstMin(
      this.pageOf.panels.filter((p) => p.y >= this.b && p.sameCol(this)),
      (p) => p.y,
    )
  }

  findAllLeftPanels() {
    return this.pageOf.panels.filter((p) => p.r <= this.x && p.sameRow(this))
  }

  findLeftPanel() {
    return firstMax(this.findAllLeftPanels(), (p) => p.r)
  }

  findAllRightPanels() {
    return this.pageOf.panels.filter((p) => p.x >= this.r && p.sameRow(this))
  }

  findRightPanel() {
    return firstMin(this.findAllRightPanels(), (p) => p.x)
  }

  findNeighbourPanel(direction: Edge) {
    if (direction === 'x') {
      return this.findLeftPanel()
    }

    if (direction === 'y') {
      return this.findTopPanel()
    }

    return direction === 'r' ? this.findRightPanel() : this.findBottomPanel()
  }

  groupWith(other: Panel) {
    const x = Math.min(this.x, other.x)
    const y = Math.min(this.y, other.y)

    return new Panel(this.page, [
      x,
      y,
      Math.max(this.r, other.r) - x,
      Math.max(this.b, other.b) - y,
    ])
  }

  merge(other: Panel) {
    const possible: Array<Panel> = [this]

    if (other.x < this.x) {
      possible.push(Panel.fromXyrb(this.page, other.x, this.y, this.r, this.b))
    }

    if (other.r > this.r) {
      for (const pp of possible.slice()) {
        possible.push(Panel.fromXyrb(this.page, pp.x, pp.y, other.r, pp.b))
      }
    }

    if (other.y < this.y) {
      for (const pp of possible.slice()) {
        possible.push(Panel.fromXyrb(this.page, pp.x, other.y, pp.r, pp.b))
      }
    }

    if (other.b > this.b) {
      for (const pp of possible.slice()) {
        possible.push(Panel.fromXyrb(this.page, pp.x, pp.y, pp.r, other.b))
      }
    }

    const others = this.pageOf.panels.filter((p) => !pyIn(p, [this, other]))
    const allowed = possible.filter((p) => !p.bumpsInto(others))

    return firstMax(allowed, (p) => p.area()) ?? this
  }

  isClose(other: Panel) {
    const c1x = this.x + this.w() / 2
    const c1y = this.y + this.h() / 2
    const c2x = other.x + other.w() / 2
    const c2y = other.y + other.h() / 2

    return (
      Math.abs(c1x - c2x) <= (this.w() + other.w()) * 0.75 &&
      Math.abs(c1y - c2y) <= (this.h() + other.h()) * 0.75
    )
  }

  bumpsInto(others: ReadonlyArray<Panel>) {
    return others.some((other) => !pyEquals(other, this) && this.overlaps(other))
  }

  containsSegment(segment: Segment) {
    return this.overlaps(
      Panel.fromXyrb(undefined, segment.left(), segment.top(), segment.right(), segment.bottom()),
    )
  }

  getSegments() {
    this.segmentsCache ??= this.pageOf.segments.filter((segment) => this.containsSegment(segment))

    return this.segmentsCache
  }

  split() {
    if (!this.splittable) {
      return undefined
    }

    const split = this.cachedSplit()

    if (split === undefined) {
      this.splittable = false
    }

    return split
  }

  private cachedSplit() {
    if (this.polygon === undefined || this.isSmall(2)) {
      return undefined
    }

    const minHops = 3
    const maxDistX = Math.trunc(this.w() / 3)
    const maxDistY = Math.trunc(this.h() / 3)
    const maxDiagonal = Math.sqrt(maxDistX ** 2 + maxDistY ** 2)
    const dotsAlongLinesDist = maxDiagonal / 5
    const minDistBetweenDotsX = maxDistX / 10
    const minDistBetweenDotsY = maxDistY / 10
    let original: Array<Dot> = [...this.polygon]
    let polygon: Array<Dot> = []

    for (let i = 0; i < original.length; i += 1) {
      const j = (i + 1) % original.length
      const dot1 = original[i] ?? [0, 0]
      const dot2 = original[j] ?? [0, 0]
      const seg = new Segment(dot1, dot2)

      if (seg.distX() < minDistBetweenDotsX && seg.distY() < minDistBetweenDotsY) {
        original[j] = seg.center()

        continue
      }

      polygon.push(dot1)

      const addDots: Array<Dot> = []

      if (seg.dist() < dotsAlongLinesDist * 2) {
        continue
      }

      original.forEach((dot3, k) => {
        if (Math.abs(k - i) < minHops) {
          return
        }

        const projected = seg.projectedPoint(dot3)

        if (!seg.mayContain(projected)) {
          return
        }

        const project = new Segment(dot3, projected)

        if (project.distX() > maxDistX || project.distY() > maxDistY) {
          return
        }

        addDots.push(projected)
      })

      const alphaX = Math.acos(seg.distX(true) / seg.dist())
      const alphaY = Math.asin(seg.distY(true) / seg.dist())
      const distX = Math.trunc(Math.cos(alphaX) * dotsAlongLinesDist)
      const distY = Math.trunc(Math.sin(alphaY) * dotsAlongLinesDist)

      addDots.push([dot1[0] + distX, dot1[1] + distY], [dot2[0] - distX, dot2[1] - distY])

      for (const dot of addDots.toSorted(
        (p, q) => new Segment(dot1, p).dist() - new Segment(dot1, q).dist(),
      )) {
        polygon.push(dot)
      }
    }

    original = [...polygon]
    polygon = []

    for (let i = 0; i < original.length; i += 1) {
      const j = (i + 1) % original.length
      const dot1 = original[i] ?? [0, 0]
      const seg = new Segment(dot1, original[j] ?? [0, 0])

      if (seg.distX() < minDistBetweenDotsX && seg.distY() < minDistBetweenDotsY) {
        original[j] = seg.center()

        continue
      }

      polygon.push(dot1)
    }

    const nearby: Array<readonly [number, number]> = []

    for (let i = 0; i < polygon.length - minHops; i += 1) {
      for (let j = i + minHops; j < polygon.length; j += 1) {
        const seg = new Segment(polygon[i] ?? [0, 0], polygon[j] ?? [0, 0])

        if (seg.distX() <= maxDistX && seg.distY() <= maxDistY) {
          nearby.push([i, j])
        }
      }
    }

    if (nearby.length === 0) {
      return undefined
    }

    const splits: Array<Split> = []

    for (const [first, last] of nearby) {
      const poly1Length = polygon.length - last + first
      const poly2Length = last - first

      if (Math.min(poly1Length, poly2Length) <= 2) {
        continue
      }

      const poly1 = polygon.filter((_, i) => i <= first || i > last)
      const poly2 = polygon.filter((_, i) => i > first && i <= last)
      const panel1 = new Panel(this.page, undefined, poly1)
      const panel2 = new Panel(this.page, undefined, poly2)

      if (panel1.isSmall() || panel2.isSmall()) {
        continue
      }

      if (pyEquals(panel1, this) || pyEquals(panel2, this)) {
        continue
      }

      if (panel1.overlaps(panel2)) {
        continue
      }

      const split = new Split(this, panel1, panel2, Segment.alongPolygon(polygon, first, last))

      if (!splits.some((existing) => existing.segment.equals(split.segment))) {
        splits.push(split)
      }
    }

    return firstMax(
      splits.filter((split) => split.coverage() > 0.5),
      (split) => split.coveredDist,
    )
  }
}

class Split {
  readonly subpanels: readonly [Panel, Panel]
  readonly segment: Segment
  readonly coveredDist: number

  constructor(panel: Panel, first: Panel, second: Panel, segment: Segment) {
    this.subpanels = [first, second]
    this.segment = segment

    this.coveredDist = segment
      .intersectAll(panel.getSegments())
      .reduce((total, matching) => total + matching.dist(), 0)
  }

  coverage() {
    const dist = this.segment.dist()

    return dist === 0 ? 0 : this.coveredDist / dist
  }
}

type Edge = 'x' | 'y' | 'r' | 'b'

const firstMax = <A>(items: ReadonlyArray<A>, key: (item: A) => number) =>
  items.reduce<A | undefined>(
    (best, item) => (best === undefined || key(item) > key(best) ? item : best),
    undefined,
  )

const firstMin = <A>(items: ReadonlyArray<A>, key: (item: A) => number) =>
  items.reduce<A | undefined>(
    (best, item) => (best === undefined || key(item) < key(best) ? item : best),
    undefined,
  )

/** Python's `==` on panels: identity first, then the left operand's fuzzy __eq__. */
const pyEquals = (item: Panel, value: Panel) => item === value || item.equals(value)

const pyIn = (value: Panel, list: ReadonlyArray<Panel>) =>
  list.some((item) => pyEquals(item, value))

/** Wenbu's TolerantPanels.remove: drops the first equal panel, if there is one. */
const pyRemove = (list: Array<Panel>, value: Panel) => {
  const index = list.findIndex((item) => pyEquals(item, value))

  if (index >= 0) {
    list.splice(index, 1)
  }
}

const pyIndex = (list: ReadonlyArray<Panel>, value: Panel) =>
  list.findIndex((item) => pyEquals(item, value))

/** CPython's list.sort (TimSort) with Panel.__lt__ as the only comparison: V8's sort is a port of it. */
const pySort = (list: ReadonlyArray<Panel>) => list.toSorted((p, q) => (p.lessThan(q) ? -1 : 1))

const groupSmallPanels = (cv: Cv, page: Page) => {
  const small = page.panels.filter((p) => p.isSmall())
  const groups = new Map<string, { panel: Panel; id: number }>()
  let groupId = 0

  small.forEach((p1, i) => {
    for (const p2 of small.slice(i + 1)) {
      if (pyEquals(p1, p2) || !p1.isClose(p2)) {
        continue
      }

      const g1 = groups.get(p1.key())
      const g2 = groups.get(p2.key())

      if (g1 === undefined && g2 === undefined) {
        groupId += 1
        groups.set(p1.key(), { panel: p1, id: groupId })
        groups.set(p2.key(), { panel: p2, id: groupId })
      } else if (g1 !== undefined && g2 === undefined) {
        groups.set(p2.key(), { panel: p2, id: g1.id })
      } else if (g2 !== undefined && g1 === undefined) {
        groups.set(p1.key(), { panel: p1, id: g2.id })
      } else if (g1 !== undefined && g2 !== undefined && g1.id !== g2.id) {
        // Python re-reads groups[p2] on every step, so entries after p2 keep their old group.
        for (const entry of groups.values()) {
          if (entry.id === g2.id) {
            entry.id = g1.id
          }
        }
      }
    }
  })

  const grouped = new Map<number, Array<Panel>>()

  for (const { panel, id } of groups.values()) {
    grouped.set(id, [...(grouped.get(id) ?? []), panel])
  }

  for (const members of grouped.values()) {
    const points = members.flatMap((member) => member.polygon ?? [])
    const mat = cv.matFromArray(points.length, 1, cv.CV_32SC2, points.flat())
    const hull = new cv.Mat()

    cv.convexHull(mat, hull, false, true)

    const hullPoints: Array<Dot> = []

    for (let index = 0; index < hull.rows; index += 1) {
      hullPoints.push([hull.data32S[index * 2] ?? 0, hull.data32S[index * 2 + 1] ?? 0])
    }

    mat.delete()
    hull.delete()
    page.panels.push(new Panel(page, undefined, hullPoints, false))

    for (const member of members) {
      pyRemove(page.panels, member)
    }
  }
}

const splitPanels = (page: Page) => {
  let didSplit = true

  while (didSplit) {
    didSplit = false

    for (const panel of page.panels.toSorted((p, q) => q.area() - p.area())) {
      const split = panel.split()

      if (split !== undefined) {
        didSplit = true
        pyRemove(page.panels, panel)
        page.panels.push(...split.subpanels)

        break
      }
    }
  }
}

const mergePanels = (page: Page) => {
  const toRemove: Array<Panel> = []

  page.panels.forEach((original, i) => {
    let p1 = original

    for (let p2 of page.panels.slice(i + 1)) {
      if (p1.contains(p2)) {
        toRemove.push(p2)
        p1 = p1.merge(p2)
      } else if (p2.contains(p1)) {
        toRemove.push(p1)
        p2 = p2.merge(p1)
      }
    }
  })

  const unique = new Map<string, Panel>()

  for (const panel of toRemove) {
    if (!unique.has(panel.key())) {
      unique.set(panel.key(), panel)
    }
  }

  for (const panel of unique.values()) {
    pyRemove(page.panels, panel)
  }
}

const deoverlapPanels = (page: Page) => {
  for (const p1 of page.panels) {
    for (const p2 of page.panels) {
      if (pyEquals(p1, p2)) {
        continue
      }

      const overlap = p1.overlapPanel(p2)

      if (overlap === undefined) {
        continue
      }

      if (overlap.w() < overlap.h() && p1.r === overlap.r) {
        p1.r = overlap.x
        p2.x = overlap.r

        continue
      }

      if (overlap.w() > overlap.h() && p1.b === overlap.b) {
        p1.b = overlap.y
        p2.y = overlap.b
      }
    }
  }
}

const actualGutters = (page: Page) => {
  const gutterX: Array<number> = []
  const gutterY: Array<number> = []

  for (const p of page.panels) {
    const left = p.findLeftPanel()

    if (left !== undefined) {
      gutterX.push(p.x - left.r)
    }

    const top = p.findTopPanel()

    if (top !== undefined) {
      gutterY.push(p.y - top.b)
    }
  }

  const x = gutterX.length === 0 ? 1 : Math.min(...gutterX)
  const y = gutterY.length === 0 ? 1 : Math.min(...gutterY)

  return { x, y, r: -x, b: -y }
}

const opposite: Record<Edge, Edge> = { x: 'r', r: 'x', y: 'b', b: 'y' }

const expandPanels = (page: Page) => {
  const gutters = actualGutters(page)

  for (const p of page.panels) {
    for (const d of ['x', 'y', 'r', 'b'] as const) {
      const neighbour = p.findNeighbourPanel(d)
      let newCoord: number

      if (neighbour !== undefined) {
        newCoord = neighbour[opposite[d]] + gutters[d]
      } else {
        const extreme =
          d === 'x' || d === 'y'
            ? firstMin(page.panels, (panel) => panel[d])
            : firstMax(page.panels, (panel) => panel[d])

        newCoord = extreme?.[d] ?? -1
      }

      if (
        newCoord !== -1 &&
        (((d === 'r' || d === 'b') && newCoord > p[d]) ||
          ((d === 'x' || d === 'y') && newCoord < p[d]))
      ) {
        p[d] = newCoord
      }
    }
  }
}

const groupBigPanels = (page: Page) => {
  let grouped = true

  while (grouped) {
    grouped = false

    for (const [i, p1] of page.panels.entries()) {
      for (const p2 of page.panels.slice(i + 1)) {
        const p3 = p1.groupWith(p2)
        const others = page.panels.filter((p) => !pyIn(p, [p1, p2]))

        if (p3.bumpsInto(others)) {
          continue
        }

        const crossing = page.segments.some(
          (segment) => p3.containsSegment(segment) && segment.dist() > p3.diagonal().dist() / 5,
        )

        if (crossing) {
          continue
        }

        page.panels.push(p3)
        pyRemove(page.panels, p1)
        pyRemove(page.panels, p2)
        grouped = true

        break
      }

      if (grouped) {
        break
      }
    }
  }
}

const fixPanelsNumbering = (page: Page) => {
  let changes = 1

  while (changes > 0) {
    changes = 0

    for (const [i, p] of page.panels.entries()) {
      const before = [
        p.findTopPanel(),
        ...(page.rtl ? p.findAllRightPanels() : p.findAllLeftPanels()),
      ]

      for (const neighbour of before) {
        if (neighbour === undefined) {
          continue
        }

        const position = pyIndex(page.panels, neighbour)

        if (i < position) {
          changes += 1

          const [moved] = page.panels.splice(i, 1)

          if (moved !== undefined) {
            page.panels.splice(position, 0, moved)
          }

          break
        }
      }

      if (changes > 0) {
        break
      }
    }
  }
}

/** Kumiko's Page: panels in reading order, as x, y, width, height. */
export const findPanels = (
  cv: Cv,
  width: number,
  height: number,
  features: PanelFeatures,
  rtl: boolean,
): ReadonlyArray<PanelBox> => {
  const smallRatio = 1 / 10
  let minDist = Math.min(width, height) * smallRatio
  let segments: Array<Segment> | undefined

  while (segments === undefined || segments.length > 500) {
    segments = []

    for (let index = 0; index + 3 < features.segments.length; index += 4) {
      const x0 = roundHalfEven(features.segments[index] ?? 0)
      const y0 = roundHalfEven(features.segments[index + 1] ?? 0)
      const x1 = roundHalfEven(features.segments[index + 2] ?? 0)
      const y1 = roundHalfEven(features.segments[index + 3] ?? 0)

      if (Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2) >= minDist) {
        segments.push(new Segment([x0, y0], [x1, y1]))
      }
    }

    if (features.segments.length === 0) {
      break
    }

    minDist *= 1.1
  }

  const page: Page = { width, height, rtl, smallRatio, segments: unionAll(segments), panels: [] }

  for (const contour of features.contours) {
    const mat = cv.matFromArray(
      contour.length,
      1,
      cv.CV_32SC2,
      contour.flatMap((point: Point) => [point.x, point.y]),
    )

    const approx = new cv.Mat()

    cv.approxPolyDP(mat, approx, 0.001 * cv.arcLength(mat, true), true)

    const polygon: Array<Dot> = []

    for (let index = 0; index < approx.rows; index += 1) {
      polygon.push([approx.data32S[index * 2] ?? 0, approx.data32S[index * 2 + 1] ?? 0])
    }

    mat.delete()
    approx.delete()

    const panel = new Panel(page, undefined, polygon)

    if (!panel.isVerySmall()) {
      page.panels.push(panel)
    }
  }

  groupSmallPanels(cv, page)
  splitPanels(page)
  page.panels = page.panels.filter((p) => !p.isSmall())
  mergePanels(page)
  deoverlapPanels(page)
  page.panels = page.panels.filter((p) => !p.isSmall())
  page.panels = pySort(page.panels)
  expandPanels(page)

  if (page.panels.length === 0) {
    page.panels.push(new Panel(page, [0, 0, width, height]))
  }

  groupBigPanels(page)
  fixPanelsNumbering(page)

  return page.panels.map((p) => ({ x: p.x, y: p.y, width: p.w(), height: p.h() }))
}
