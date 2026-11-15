import { roundHalfEven } from './DbBoxes'
import type { RgbImage } from './Images'
import type { Cv } from './OpenCv'
import { mapBytes } from './Bytes'

/**
 * Where lettering goes (wenbu_manga/skia/skia_adapter.py, safe_area.py and upstream's
 * ballon_extractor.py): the balloon around a block or an enlarged box, boxes kept apart from each other,
 * and the largest centred box that keeps its distance from the balloon's edge.
 */

export type Box = readonly [number, number, number, number]

/** A mask the size of a box, 255 inside the balloon. */
export interface Geometry {
  readonly box: Box
  readonly mask: Uint8Array | undefined
}

export interface LetterRegion {
  readonly xyxy: Box
  readonly text: string
  readonly translation: string
  readonly vertical: boolean
  readonly textBox?: Box | undefined
}

const minBalloonAreaRatio = 1.15
const fallbackMinExpand = 1.35
const fallbackMaxExpand = 2.75
const renderBoxGap = 2
const minRenderBox = 4

export const clipBox = (box: Box, width: number, height: number): Box => {
  const x1 = Math.max(0, Math.min(roundHalfEven(box[0]), width - 1))
  const y1 = Math.max(0, Math.min(roundHalfEven(box[1]), height - 1))
  const x2 = Math.max(x1 + 1, Math.min(roundHalfEven(box[2]), width))
  const y2 = Math.max(y1 + 1, Math.min(roundHalfEven(box[3]), height))

  return [x1, y1, x2, y2]
}

const overlaps = (a: Box, b: Box, gap: number) =>
  !(a[2] + gap <= b[0] || b[2] + gap <= a[0] || a[3] + gap <= b[1] || b[3] + gap <= a[1])

const textLength = (text: string) => text.split(/\s+/u).join('').length

const fallbackExpandRatio = (region: LetterRegion) => {
  const source = Math.max(1, textLength(region.text))
  const growth = Math.max(0, (textLength(region.translation) - source) / source)

  return Math.min(fallbackMaxExpand, Math.max(fallbackMinExpand, fallbackMinExpand + growth * 0.45))
}

/** _expand_region_bbox: the block grown by how much longer the translation is, mostly along its lines. */
const expandedBox = (region: LetterRegion, width: number, height: number) => {
  const [x1, y1, x2, y2] = region.xyxy
  const w = Math.max(1, x2 - x1)
  const h = Math.max(1, y2 - y1)
  const cx = x1 + w / 2
  const cy = y1 + h / 2
  const expand = fallbackExpandRatio(region)
  const across = Math.max(1.15, Math.min(expand, 1.55))
  const newW = w * (region.vertical ? across : expand)
  const newH = h * (region.vertical ? expand : across)

  return clipBox([cx - newW / 2, cy - newH / 2, cx + newW / 2, cy + newH / 2], width, height)
}

const balloonEnlargeRatio = (region: LetterRegion) => {
  const w = region.xyxy[2] - region.xyxy[0]
  const h = region.xyxy[3] - region.xyxy[1]

  if (w <= 0 || h <= 0) {
    return fallbackMinExpand
  }

  return Math.min(Math.max(Math.max(w / h, h / w) * 1.5, fallbackMinExpand), 3)
}

/** The larger root of a x² + b x + c, as numpy.roots finds it. */
const largerRoot = (a: number, b: number, c: number) => {
  const discriminant = Math.sqrt(b * b - 4 * a * c)

  return Math.max((-b + discriminant) / (2 * a), (-b - discriminant) / (2 * a))
}

/** enlarge_window: grows the box so its area is `ratio` times larger, keeping its aspect. */
const enlargeWindow = (box: Box, width: number, height: number, ratio: number, aspect: number) => {
  const [x1, y1, x2, y2] = box
  const w = x2 - x1
  const h = y2 - y1

  if (w <= 0 || h <= 0) {
    return [0, 0, 0, 0] as const
  }

  const root = largerRoot(aspect, w + h * aspect, (1 - ratio) * w * h)
  const half = roundHalfEven(root / 2)
  const deltaW = Math.min(x1, width - x2, Math.trunc(half * aspect))
  const delta = Math.min(y1, height - y2, half)
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1)

  return [
    clamp(x1 - deltaW, width),
    clamp(y1 - delta, height),
    clamp(x2 + deltaW, width),
    clamp(y2 + delta, height),
  ] as const
}

const withMats = <A>(use: (track: <M extends { delete: () => void }>(mat: M) => M) => A) => {
  const mats: Array<{ delete: () => void }> = []

  const result = use((mat) => {
    mats.push(mat)

    return mat
  })

  for (const mat of mats) {
    mat.delete()
  }

  return result
}

/** extract_ballon_region: the balloon around a block, found from the edges around it. */
const balloonRegion = (cv: Cv, page: RgbImage, region: LetterRegion) =>
  withMats((track) => {
    const rx = Math.trunc(region.xyxy[0])
    const ry = Math.trunc(region.xyxy[1])
    const rw = Math.trunc(region.xyxy[2]) - rx
    const rh = Math.trunc(region.xyxy[3]) - ry
    const ratio = balloonEnlargeRatio(region)

    const [x1, y1, x2, y2] =
      ratio > 1
        ? enlargeWindow([rx, ry, rx + rw, ry + rh], page.width, page.height, ratio, rh / rw)
        : ([rx, ry, rx + rw, ry + rh] as const)

    const full = track(cv.matFromArray(page.height, page.width, cv.CV_8UC3, page.data))
    const crop = track(full.roi(new cv.Rect(x1, y1, x2 - x1, y2 - y1)).clone())
    const oriH = crop.rows
    const oriW = crop.cols
    let scale = 1

    if (oriH > 300 && oriW > 300) {
      scale = 0.6
    } else if (oriH < 120 || oriW < 120) {
      scale = 1.4
    }

    const image = track(new cv.Mat())

    if (scale === 1) {
      crop.copyTo(image)
    } else {
      cv.resize(
        crop,
        image,
        new cv.Size(Math.trunc(oriW * scale), Math.trunc(oriH * scale)),
        0,
        0,
        cv.INTER_AREA,
      )
    }

    const h = image.rows
    const w = image.cols
    const area = h * w
    const blurred = track(new cv.Mat())

    // The plugin passes cv2.BORDER_DEFAULT where sigmaX goes, so the blur's sigma is 4.
    cv.GaussianBlur(image, blurred, new cv.Size(3, 3), cv.BORDER_DEFAULT, 0, cv.BORDER_DEFAULT)

    const edges = track(new cv.Mat())

    cv.Canny(blurred, edges, 70, 140, 3, true)

    cv.rectangle(
      edges,
      new cv.Point(0, 0),
      new cv.Point(w - 1, h - 1),
      new cv.Scalar(255, 255, 255),
      1,
      cv.LINE_8,
    )

    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())

    cv.findContours(edges, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE)

    let balloon = track(new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(0)))
    let smallest = Number.POSITIVE_INFINITY
    const mask = track(cv.Mat.zeros(h, w, cv.CV_8UC1))
    const seed = new cv.Point(Math.trunc(w / 2), Math.trunc(h / 2))
    const tolerance = new cv.Scalar(10, 10, 10)

    for (let index = 0; index < contours.size(); index += 1) {
      const rect = cv.boundingRect(contours.get(index))

      if (rect.width * rect.height < area * 0.4) {
        continue
      }

      cv.drawContours(mask, contours, index, new cv.Scalar(255), 2)

      const copy = track(mask.clone())

      cv.rectangle(
        mask,
        new cv.Point(0, 0),
        new cv.Point(w - 1, h - 1),
        new cv.Scalar(255, 255, 255),
        1,
        cv.LINE_8,
      )

      const filled = cv.floodFill(
        copy,
        track(new cv.Mat()),
        seed,
        new cv.Scalar(127),
        new cv.Rect(),
        tolerance,
        tolerance,
        4,
      )

      if (filled <= area * 0.3) {
        cv.drawContours(mask, contours, index, new cv.Scalar(0), 2)
      }

      if (filled < smallest && filled > area * 0.3) {
        smallest = filled
        balloon = copy
      }
    }

    // numpy's uint8 subtraction wraps around, which keeps the outline apart from the filled inside.
    const inverted = track(
      cv.matFromArray(
        h,
        w,
        cv.CV_8UC1,
        mapBytes(balloon.data, (value) => (127 - value) & 255),
      ),
    )

    const kernel = track(cv.Mat.ones(3, 3, cv.CV_8U))
    const dilated = track(new cv.Mat())

    cv.dilate(inverted, dilated, kernel, new cv.Point(-1, -1), 1)

    const balloonArea = cv.floodFill(
      dilated,
      track(new cv.Mat()),
      seed,
      new cv.Scalar(30),
      new cv.Rect(),
      tolerance,
      tolerance,
      4,
    )

    const thirty = track(
      cv.matFromArray(
        h,
        w,
        cv.CV_8UC1,
        mapBytes(dilated.data, (value) => (30 - value) & 255),
      ),
    )

    const binary = track(new cv.Mat())

    cv.threshold(thirty, binary, 1, 255, cv.THRESH_BINARY)
    cv.bitwise_not(binary, binary)

    const boxKernel = Math.trunc(Math.sqrt(balloonArea) / 30)

    if (boxKernel > 1) {
      const square = track(cv.Mat.ones(boxKernel, boxKernel, cv.CV_8U))

      cv.dilate(binary, binary, square, new cv.Point(-1, -1), 1)
      cv.erode(binary, binary, square, new cv.Point(-1, -1), 1)
    }

    const result = track(new cv.Mat())

    if (scale === 1) {
      binary.copyTo(result)
    } else {
      cv.resize(binary, result, new cv.Size(oriW, oriH), 0, 0, cv.INTER_LINEAR)
    }

    return {
      mask: Uint8Array.from(result.data),
      width: oriW,
      height: oriH,
      box: [x1, y1, x2, y2] as const,
    }
  })

/** _extract_balloon_render_geometry: the balloon's box and mask, when the balloon is clearly larger than the block. */
const balloonGeometry = (cv: Cv, page: RgbImage, region: LetterRegion): Geometry | undefined => {
  const found = balloonRegion(cv, page, region)

  if (!found.mask.some((value) => value > 0)) {
    return undefined
  }

  const box = clipBox(found.box, page.width, page.height)
  const [x1, y1, x2, y2] = box
  const [rx1, ry1, rx2, ry2] = region.xyxy.map((edge) => Math.trunc(edge))
  const regionArea = Math.max(1, ((rx2 ?? 0) - (rx1 ?? 0)) * ((ry2 ?? 0) - (ry1 ?? 0)))

  if (Math.max(1, (x2 - x1) * (y2 - y1)) < regionArea * minBalloonAreaRatio) {
    return undefined
  }

  let mask = found.mask

  if (found.height !== y2 - y1 || found.width !== x2 - x1) {
    mask = withMats((track) => {
      const source = track(cv.matFromArray(found.height, found.width, cv.CV_8UC1, found.mask))
      const target = track(new cv.Mat())

      cv.resize(source, target, new cv.Size(x2 - x1, y2 - y1), 0, 0, cv.INTER_NEAREST)

      return Uint8Array.from(target.data)
    })
  }

  return { box, mask: mapBytes(mask, (value) => (value > 0 ? 255 : 0)) }
}

/** _resolve_render_geometry: a box the editor moved, else the balloon, else the enlarged block. */
export const renderGeometry = (cv: Cv, page: RgbImage, region: LetterRegion): Geometry => {
  if (region.textBox !== undefined) {
    return { box: clipBox(region.textBox, page.width, page.height), mask: undefined }
  }

  const balloon = balloonGeometry(cv, page, region)

  if (balloon !== undefined) {
    return balloon
  }

  const box = expandedBox(region, page.width, page.height)

  return { box, mask: new Uint8Array((box[2] - box[0]) * (box[3] - box[1])).fill(255) }
}

const cropMask = (mask: Uint8Array | undefined, from: Box, to: Box) => {
  if (mask === undefined) {
    return undefined
  }

  const w = to[2] - to[0]
  const h = to[3] - to[1]

  if (w <= 0 || h <= 0) {
    return undefined
  }

  const ix1 = Math.max(from[0], to[0])
  const iy1 = Math.max(from[1], to[1])
  const ix2 = Math.min(from[2], to[2])
  const iy2 = Math.min(from[3], to[3])

  if (ix2 <= ix1 || iy2 <= iy1) {
    return new Uint8Array(w * h).fill(255)
  }

  const cropped = new Uint8Array(w * h)
  const fromW = from[2] - from[0]

  for (let y = iy1; y < iy2; y += 1) {
    for (let x = ix1; x < ix2; x += 1) {
      cropped[(y - to[1]) * w + x - to[0]] = mask[(y - from[1]) * fromW + x - from[0]] ?? 0
    }
  }

  return cropped
}

const sameBox = (a: Box, b: Box) => a.every((edge, index) => edge === b[index])

/** _constrain_render_geometries: overlapping boxes are split halfway between their blocks' centres. */
export const constrainGeometries = (
  regions: ReadonlyArray<LetterRegion>,
  geometries: ReadonlyArray<Geometry>,
): ReadonlyArray<Geometry> => {
  if (geometries.length < 2) {
    return geometries
  }

  const boxes: Array<Box> = geometries.map(({ box }) => box)

  const centres = regions.map(
    ({ xyxy }) => [(xyxy[0] + xyxy[2]) / 2, (xyxy[1] + xyxy[3]) / 2] as const,
  )

  const safe = (box: Box, fallback: Box) =>
    box[2] - box[0] >= minRenderBox && box[3] - box[1] >= minRenderBox ? box : fallback

  for (let round = 0; round < 3; round += 1) {
    let changed = false

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i] ?? [0, 0, 0, 0]
        const b = boxes[j] ?? [0, 0, 0, 0]

        if (!overlaps(a, b, renderBoxGap)) {
          continue
        }

        const [cix = 0, ciy = 0] = centres[i] ?? []
        const [cjx = 0, cjy = 0] = centres[j] ?? []
        let nextA: Box
        let nextB: Box

        if (Math.abs(cix - cjx) >= Math.abs(ciy - cjy)) {
          const split = roundHalfEven((cix + cjx) / 2)

          if (cix <= cjx) {
            nextA = [a[0], a[1], Math.min(a[2], split - renderBoxGap), a[3]]
            nextB = [Math.max(b[0], split + renderBoxGap), b[1], b[2], b[3]]
          } else {
            nextA = [Math.max(a[0], split + renderBoxGap), a[1], a[2], a[3]]
            nextB = [b[0], b[1], Math.min(b[2], split - renderBoxGap), b[3]]
          }
        } else {
          const split = roundHalfEven((ciy + cjy) / 2)

          if (ciy <= cjy) {
            nextA = [a[0], a[1], a[2], Math.min(a[3], split - renderBoxGap)]
            nextB = [b[0], Math.max(b[1], split + renderBoxGap), b[2], b[3]]
          } else {
            nextA = [a[0], Math.max(a[1], split + renderBoxGap), a[2], a[3]]
            nextB = [b[0], b[1], b[2], Math.min(b[3], split - renderBoxGap)]
          }
        }

        nextA = safe(nextA, a)
        nextB = safe(nextB, b)

        if (!sameBox(nextA, a) || !sameBox(nextB, b)) {
          boxes[i] = nextA
          boxes[j] = nextB
          changed = true
        }
      }
    }

    if (!changed) {
      break
    }
  }

  return geometries.map((geometry, index) => {
    const box = boxes[index] ?? geometry.box

    return sameBox(box, geometry.box)
      ? geometry
      : { box, mask: cropMask(geometry.mask, geometry.box, box) }
  })
}

/**
 * calculate_centroid_expansion_box: the largest box centred on the balloon's middle whose pixels stay
 * `padding` away from its edge, as x, y, width and height inside the mask; undefined when there is none.
 */
export const safeArea = (
  cv: Cv,
  mask: Uint8Array,
  width: number,
  height: number,
  padding: number,
) =>
  withMats((track) => {
    if (!mask.some((value) => value > 0)) {
      return undefined
    }

    const padded = track(cv.Mat.zeros(height + 2, width + 2, cv.CV_8UC1))

    for (let y = 0; y < height; y += 1) {
      padded.data.set(mask.subarray(y * width, (y + 1) * width), (y + 1) * (width + 2) + 1)
    }

    const distances = track(new cv.Mat())

    cv.distanceTransform(padded, distances, cv.DIST_L2, cv.DIST_MASK_PRECISE)

    const distance = (x: number, y: number) => distances.data32F[(y + 1) * (width + 2) + x + 1] ?? 0
    const safe = new Uint8Array(width * height)
    let m00 = 0
    let m10 = 0
    let m01 = 0
    let maxValue = Number.NEGATIVE_INFINITY
    let maxX = 0
    let maxY = 0

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = distance(x, y)

        if (value > maxValue) {
          maxValue = value
          maxX = x
          maxY = y
        }

        if (value >= padding) {
          safe[y * width + x] = 255
          m00 += 255
          m10 += 255 * x
          m01 += 255 * y
        }
      }
    }

    if (m00 === 0) {
      return undefined
    }

    let centreX = m10 / m00
    let centreY = m01 / m00
    const clampedX = Math.max(0, Math.min(roundHalfEven(centreX), width - 1))
    const clampedY = Math.max(0, Math.min(roundHalfEven(centreY), height - 1))

    if (distance(clampedX, clampedY) < maxValue * 0.7) {
      centreX = maxX
      centreY = maxY
    }

    let cx = roundHalfEven(centreX)
    let cy = roundHalfEven(centreY)

    if (cy < 0 || cy >= height || cx < 0 || cx >= width || safe[cy * width + cx] !== 255) {
      let best = Number.POSITIVE_INFINITY

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (safe[y * width + x] === 255) {
            const d = Math.sqrt((y - centreY) ** 2 + (x - centreX) ** 2)

            if (d < best) {
              best = d
              cx = x
              cy = y
            }
          }
        }
      }

      centreX = cx
      centreY = cy
    }

    const at = (x: number, y: number) => safe[y * width + x] ?? 0
    let left = 0
    let right = width - cx
    let up = 0
    let down = height - cy

    for (let x = cx - 1; x >= 0; x -= 1) {
      if (at(x, cy) === 0) {
        left = x

        break
      }
    }

    for (let x = cx; x < width; x += 1) {
      if (at(x, cy) === 0) {
        right = x - cx

        break
      }
    }

    for (let y = cy - 1; y >= 0; y -= 1) {
      if (at(cx, y) === 0) {
        up = y

        break
      }
    }

    for (let y = cy; y < height; y += 1) {
      if (at(cx, y) === 0) {
        down = y - cy

        break
      }
    }

    const minWidth = Math.min(cx - left, right)
    const minHeight = Math.min(cy - up, down)
    const safeWidth = 2 * Math.max(0, minWidth > 1 ? minWidth - 1 : minWidth)
    const safeHeight = 2 * Math.max(0, minHeight > 1 ? minHeight - 1 : minHeight)

    if (safeWidth <= 0 || safeHeight <= 0) {
      return undefined
    }

    const boxX = roundHalfEven(centreX - safeWidth / 2)
    const boxY = roundHalfEven(centreY - safeHeight / 2)

    if (boxX < 0 || boxY < 0 || boxX + safeWidth > width || boxY + safeHeight > height) {
      return undefined
    }

    return [boxX, boxY, safeWidth, safeHeight] as const
  })
