import type { PictureStyle, Rgb, ShownLine } from '#contract/Pictures'

export type Measure = (text: string, size: number) => number

export interface FittedLine {
  readonly size: number
  readonly lines: ReadonlyArray<string>
  /** Below 1 when the text had to be squeezed sideways to fit. */
  readonly scaleX: number
}

/** Smaller than this, game lettering stops being readable, so the text is squeezed instead. */
const MIN_SIZE = 10

const MIN_SCALE = 0.5

const LINE_HEIGHT = 1.1

const sizeFor = (measure: Measure, text: string, width: number) =>
  width / Math.max(1, measure(text, 1))

const twoLines = (measure: Measure, text: string) => {
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index)

  if (spaces.length === 0) {
    return undefined
  }

  const splits = spaces.map((at) => [text.slice(0, at), text.slice(at + 1)] as const)

  const widest = (lines: readonly [string, string]) =>
    Math.max(...lines.map((line) => measure(line, 1)))

  return splits.reduce((best, split) => (widest(split) < widest(best) ? split : best))
}

/** Fits a translation into the box its original text filled: same size, then smaller, then two lines, then squeezed. */
export const fitLine = (
  measure: Measure,
  text: string,
  box: { readonly w: number; readonly h: number },
): FittedLine => {
  const base = Math.round(box.h * 0.85)
  const single = Math.min(base, sizeFor(measure, text, box.w))
  const split = twoLines(measure, text)

  const double =
    split === undefined
      ? 0
      : Math.min(box.h / (2 * LINE_HEIGHT), ...split.map((line) => sizeFor(measure, line, box.w)))

  if (split !== undefined && double > single && double >= MIN_SIZE) {
    return { size: Math.floor(double), lines: split, scaleX: 1 }
  }

  if (single >= MIN_SIZE || single >= base) {
    return { size: Math.floor(single), lines: [text], scaleX: 1 }
  }

  const size = Math.min(base, MIN_SIZE)
  const scaleX = box.w / Math.max(1, measure(text, size))

  if (scaleX >= MIN_SCALE) {
    return { size, lines: [text], scaleX }
  }

  return {
    size: Math.max(1, Math.floor(sizeFor(measure, text, box.w / MIN_SCALE))),
    lines: [text],
    scaleX: MIN_SCALE,
  }
}

const MAX_LINES = 4

const widestOf = (measure: Measure, lines: ReadonlyArray<string>) =>
  Math.max(...lines.map((line) => measure(line, 1)))

const spread = (measure: Measure, lines: ReadonlyArray<string>) =>
  lines.reduce((sum, line) => sum + measure(line, 1) ** 2, 0)

/** A narrower widest line wins; between equals, the lines closer in length do. */
const evener = (
  measure: Measure,
  candidate: ReadonlyArray<string>,
  best: ReadonlyArray<string>,
) => {
  const difference = widestOf(measure, candidate) - widestOf(measure, best)

  return difference < 0 || (difference === 0 && spread(measure, candidate) < spread(measure, best))
}

export const balancedLines = (
  measure: Measure,
  text: string,
  count: number,
): ReadonlyArray<string> | undefined => {
  const words = text.split(' ').filter((word) => word !== '')

  if (count === 1) {
    return [words.join(' ')]
  }

  if (words.length < count) {
    return undefined
  }

  let best: ReadonlyArray<string> | undefined

  for (let take = 1; take <= words.length - count + 1; take++) {
    const rest = balancedLines(measure, words.slice(take).join(' '), count - 1)

    if (rest === undefined) {
      continue
    }

    const candidate = [words.slice(0, take).join(' '), ...rest]

    if (best === undefined || evener(measure, candidate, best)) {
      best = candidate
    }
  }

  return best
}

const linesTall = (count: number) => 1 + (count - 1) * LINE_HEIGHT

export const fillLine = (
  measure: Measure,
  text: string,
  box: { readonly w: number; readonly h: number },
): FittedLine => {
  let best: FittedLine = { size: 1, lines: [text], scaleX: 1 }

  for (let count = 1; count <= MAX_LINES; count++) {
    const lines = balancedLines(measure, text, count)

    if (lines === undefined) {
      break
    }

    const size = Math.floor(
      Math.min(box.w / Math.max(1, widestOf(measure, lines)), box.h / linesTall(count)),
    )

    if (size > best.size) {
      best = { size, lines, scaleX: 1 }
    }
  }

  return best
}

export const sizedLine = (
  measure: Measure,
  text: string,
  box: { readonly w: number },
  size: number,
): FittedLine => {
  let closest: ReadonlyArray<string> = [text]

  for (let count = 1; count <= MAX_LINES; count++) {
    const lines = balancedLines(measure, text, count)

    if (lines === undefined) {
      break
    }

    if (widestOf(measure, lines) * size <= box.w) {
      return { size, lines, scaleX: 1 }
    }

    closest = lines
  }

  return {
    size,
    lines: closest,
    scaleX: Math.max(MIN_SCALE, box.w / Math.max(1, widestOf(measure, closest) * size)),
  }
}

export interface Lettered {
  readonly w: number
  readonly h: number
  readonly translation?: string | undefined
  readonly size?: number | undefined
  readonly fillBox?: boolean | undefined
}

export const letteringOf = (measure: Measure, line: Lettered): FittedLine => {
  const text = line.translation?.trim() ?? ''

  if (line.size !== undefined) {
    return sizedLine(measure, text, line, line.size)
  }

  return line.fillBox === true ? fillLine(measure, text, line) : fitLine(measure, text, line)
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const fontOf = (style: PictureStyle, size: number) =>
  `${size}px "${style.font}", "Segoe UI", sans-serif`

const css = (rgb: Rgb) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`

export const measureWith =
  (context: Context2D, style: PictureStyle): Measure =>
  (text, size) => {
    context.font = fontOf(style, size)

    return context.measureText(text).width
  }

export const letterLines = (
  context: Context2D,
  lines: ReadonlyArray<ShownLine>,
  style: PictureStyle,
) => {
  const measure = measureWith(context, style)

  for (const line of lines) {
    const translation = line.translation?.trim() ?? ''

    if (line.keep || translation === '') {
      continue
    }

    const fitted = letteringOf(measure, line)
    const centerX = line.x + line.w / 2
    const centerY = line.y + line.h / 2

    context.save()
    context.font = fontOf(style, fitted.size)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'

    fitted.lines.forEach((text, index) => {
      const offset = (index - (fitted.lines.length - 1) / 2) * fitted.size * LINE_HEIGHT

      context.save()
      context.translate(centerX, centerY + offset)
      context.scale(fitted.scaleX, 1)

      if (line.outline !== undefined) {
        context.lineWidth = Math.max(2, fitted.size * 0.18)
        context.strokeStyle = css(line.outline)
        context.strokeText(text, 0, 0)
      }

      context.fillStyle = css(line.fill ?? [255, 255, 255])
      context.fillText(text, 0, 0)
      context.restore()
    })

    context.restore()
  }
}

export const renderPicture = async (
  cleaned: ImageBitmap,
  lines: ReadonlyArray<ShownLine>,
  style: PictureStyle,
) => {
  const canvas = new OffscreenCanvas(cleaned.width, cleaned.height)
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('The picture could not be drawn.')
  }

  context.drawImage(cleaned, 0, 0)
  letterLines(context, lines, style)

  const blob = await canvas.convertToBlob({ type: 'image/png' })

  return new Uint8Array(await blob.arrayBuffer())
}
