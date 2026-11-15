import type { RgbImage } from './Images'
import type { Cv } from './OpenCv'

/**
 * Text and paper colours of a block, taken from the page: inside the block, Otsu's threshold splits the
 * grey levels and the smaller side is the ink. Paper is what stays after the ink is grown by two pixels.
 * The plugin's rule for colours too close to tell apart (get_font_colors) then applies.
 */

export type Rgb = readonly [number, number, number]

const minimumDifference = 30

const median = (values: Array<number>) => {
  if (values.length === 0) {
    return 0
  }

  values.sort((a, b) => a - b)

  return values[Math.floor(values.length / 2)] ?? 0
}

const medianColour = (rgb: RgbImage, pixels: ReadonlyArray<number>): Rgb => [
  median(pixels.map((p) => rgb.data[p * 3] ?? 0)),
  median(pixels.map((p) => rgb.data[p * 3 + 1] ?? 0)),
  median(pixels.map((p) => rgb.data[p * 3 + 2] ?? 0)),
]

/** CIE76 with lightness weighted by 0.392, on OpenCV's 8-bit Lab, as color_difference computes it. */
const colourDifference = (cv: Cv, a: Rgb, b: Rgb) => {
  const source = cv.matFromArray(1, 2, cv.CV_8UC3, [...a, ...b])
  const lab = new cv.Mat()

  cv.cvtColor(source, lab, cv.COLOR_RGB2Lab)

  const [l1 = 0, a1 = 0, b1 = 0, l2 = 0, a2 = 0, b2 = 0] = lab.data

  source.delete()
  lab.delete()

  const f = Math.fround

  return Math.hypot(f(f(l1 - l2) * f(0.392)), a1 - a2, b1 - b2)
}

export const blockColours = (
  cv: Cv,
  rgb: RgbImage,
  box: readonly [number, number, number, number],
): { readonly fg: Rgb; readonly bg: Rgb } => {
  const x1 = Math.max(0, Math.floor(box[0]))
  const y1 = Math.max(0, Math.floor(box[1]))
  const x2 = Math.min(rgb.width, Math.ceil(box[2]))
  const y2 = Math.min(rgb.height, Math.ceil(box[3]))
  const w = Math.max(0, x2 - x1)
  const h = Math.max(0, y2 - y1)

  if (w === 0 || h === 0) {
    return { fg: [0, 0, 0], bg: [255, 255, 255] }
  }

  const grey = new Uint8Array(w * h)

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = ((y1 + y) * rgb.width + x1 + x) * 3

      grey[y * w + x] = Math.round(
        0.299 * (rgb.data[p] ?? 0) +
          0.587 * (rgb.data[p + 1] ?? 0) +
          0.114 * (rgb.data[p + 2] ?? 0),
      )
    }
  }

  const source = cv.matFromArray(h, w, cv.CV_8UC1, grey)
  const dark = new cv.Mat()

  cv.threshold(source, dark, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)

  const darkCount = cv.countNonZero(dark)
  const ink = new cv.Mat()

  if (darkCount <= (w * h) / 2) {
    dark.copyTo(ink)
  } else {
    cv.bitwise_not(dark, ink)
  }

  const grown = new cv.Mat()
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U)

  cv.dilate(ink, grown, kernel, new cv.Point(-1, -1), 2)

  const inkPixels: Array<number> = []
  const paperPixels: Array<number> = []

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const page = (y1 + y) * rgb.width + x1 + x

      if ((ink.data[y * w + x] ?? 0) > 0) {
        inkPixels.push(page)
      } else if ((grown.data[y * w + x] ?? 0) === 0) {
        paperPixels.push(page)
      }
    }
  }

  for (const mat of [source, dark, ink, grown, kernel]) {
    mat.delete()
  }

  const fg = medianColour(rgb, inkPixels)
  const bg = medianColour(rgb, paperPixels)

  if (colourDifference(cv, fg, bg) >= minimumDifference) {
    return { fg, bg }
  }

  return { fg, bg: (fg[0] + fg[1] + fg[2]) / 3 <= 127 ? [255, 255, 255] : [0, 0, 0] }
}
