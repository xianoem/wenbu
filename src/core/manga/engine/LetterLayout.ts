import type { LineMetrics } from './LetterFonts'
import {
  evenedBreaks,
  hyphenatedWord,
  joinTokens,
  splitWords,
  tokenizeStyledText,
  tryHyphenateWord,
  type BreakOptions,
} from './LineBreaking'

/**
 * The lettering's layout search (wenbu_manga/skia/layout_engine.py): a binary search over font sizes
 * for the largest one whose broken lines fit the box, narrowed when lines would cross the balloon's edge.
 */

export interface Measure {
  /** The visual width of a line with style markers at a font size, as shape_line measures it. */
  readonly width: (line: string, size: number) => number
  readonly metrics: (size: number) => LineMetrics
}

export interface LayoutLine {
  readonly textWithMarkers: string
  readonly width: number
}

export interface Layout {
  readonly fontSize: number
  readonly lines: ReadonlyArray<LayoutLine>
  readonly metrics: LineMetrics
  readonly maxLineWidth: number
  readonly lineHeight: number
}

export interface LayoutOptions {
  readonly minFontSize: number
  readonly maxFontSize: number
  readonly lineSpacing: number
  readonly hyphenate: boolean
  readonly hyphenationMinWordLength: number
  readonly forceFit: boolean
  readonly breaks: BreakOptions
}

const trailingPunctuation = /^[,.;:!?…]+$/u
const closers = /^[)\]}\u2019\u201d'"]+$/u
const ellipsisToken = /^(\.{2,})[)\]}\u2019\u201d'"]*$/u
const styled = /^(\*{1,3})(.*?)(\1)/u

const glueTrailingPunctuation = (tokens: ReadonlyArray<string>, detach: boolean) => {
  const glued: Array<string> = []

  for (const token of tokens) {
    const content = styled.exec(token)?.[2] ?? token

    if (detach && ellipsisToken.test(content)) {
      glued.push(token)
    } else if (glued.length > 0 && (trailingPunctuation.test(content) || closers.test(content))) {
      glued[glued.length - 1] += token
    } else {
      glued.push(token)
    }
  }

  return glued
}

const fitAt = (
  size: number,
  text: string,
  maxWidth: number,
  maxHeight: number,
  measure: Measure,
  options: LayoutOptions,
  forceFit: boolean,
): Omit<Layout, 'fontSize'> | undefined => {
  const metrics = measure.metrics(size)
  let lineHeight = (-metrics.ascent + metrics.descent + metrics.leading) * options.lineSpacing

  if (lineHeight <= 0) {
    lineHeight = size * 1.2 * options.lineSpacing
  }

  const settle = (texts: ReadonlyArray<string>) => {
    const lines = texts.map((line) => ({ textWithMarkers: line, width: measure.width(line, size) }))
    const maxLineWidth = Math.max(0, ...lines.map((line) => line.width))
    const height = -metrics.ascent + metrics.descent + (texts.length - 1) * lineHeight

    return forceFit || (maxLineWidth <= maxWidth && height <= maxHeight)
      ? { lines, metrics, maxLineWidth, lineHeight }
      : undefined
  }

  if (text.includes('\n')) {
    return settle(text.split('\n'))
  }

  const detach = options.breaks.detachEllipsis
  const tokens = tokenizeStyledText(text, detach)
  const augmented: Array<string> = []

  for (const [token, isStyled] of tokens) {
    if (!options.hyphenate) {
      augmented.push(token)

      continue
    }

    let marker = ''
    let core = token

    if (isStyled) {
      const match = styled.exec(token)

      if (match === null) {
        augmented.push(token)

        continue
      }

      marker = match[1] ?? ''
      core = match[2] ?? ''
    }

    const word = hyphenatedWord.exec(core)
    const length = [...(word === null ? core : (word[2] ?? ''))].length

    if (length <= options.hyphenationMinWordLength || measure.width(token, size) <= maxWidth) {
      augmented.push(token)

      continue
    }

    const wrap = (part: string) => (marker === '' ? part : `${marker}${part}${marker}`)

    const parts = tryHyphenateWord(
      core,
      options.hyphenationMinWordLength,
      (part) => measure.width(wrap(part), size) <= maxWidth,
    )

    augmented.push(...(parts === undefined ? [token] : parts.map((part) => wrap(part))))
  }

  const words = glueTrailingPunctuation(augmented, detach)
  const width = (line: string) => measure.width(line, size)

  const broken = evenedBreaks(
    words,
    maxWidth,
    width,
    measure.width(' ', size),
    width,
    options.breaks,
  )

  if (broken !== undefined && broken.length > 0) {
    return settle(broken)
  }

  return forceFit ? settle(words.map((word) => joinTokens([word], detach))) : undefined
}

/** _check_collision: whether a line's corners, centred in the box, fall outside the balloon mask. */
const collides = (
  lines: ReadonlyArray<LayoutLine>,
  boxLeft: number,
  boxTop: number,
  mask: { readonly data: Uint8Array; readonly width: number; readonly height: number },
  lineHeight: number,
  maxWidth: number,
  maxHeight: number,
) => {
  let y = boxTop + (maxHeight - lines.length * lineHeight) / 2

  for (const line of lines) {
    const x = boxLeft + (maxWidth - line.width) / 2
    const y1 = Math.trunc(y)
    const y2 = Math.trunc(y + lineHeight)
    const x1 = Math.trunc(x)
    const x2 = Math.trunc(x + line.width)

    for (const [px, py] of [
      [x1, y1],
      [x2, y1],
      [x1, y2],
      [x2, y2],
    ] as const) {
      const cx = Math.max(0, Math.min(px, mask.width - 1))
      const cy = Math.max(0, Math.min(py, mask.height - 1))

      if ((mask.data[cy * mask.width + cx] ?? 0) === 0) {
        return true
      }
    }

    y += lineHeight
  }

  return false
}

/** find_optimal_layout. */
export const optimalLayout = (
  text: string,
  maxWidth: number,
  maxHeight: number,
  measure: Measure,
  options: LayoutOptions,
  balloon:
    | {
        readonly mask: {
          readonly data: Uint8Array
          readonly width: number
          readonly height: number
        }
        readonly left: number
        readonly top: number
      }
    | undefined,
  hasMask: boolean,
): Layout | undefined => {
  const clean = /[\n\r]/u.test(text)
    ? text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
    : splitWords(text).join(' ')

  if (clean === '') {
    return undefined
  }

  let best: Layout | undefined
  let low = options.minFontSize
  let high = options.maxFontSize

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)

    if (middle === 0) {
      break
    }

    let succeeded = false
    let width = maxWidth

    for (let squeeze = 0; squeeze < (hasMask ? 3 : 1); squeeze += 1) {
      const fit = fitAt(middle, clean, width, maxHeight, measure, options, false)

      if (fit === undefined) {
        break
      }

      if (
        balloon !== undefined &&
        collides(
          fit.lines,
          balloon.left,
          balloon.top,
          balloon.mask,
          fit.lineHeight,
          width,
          maxHeight,
        )
      ) {
        width *= 0.9

        continue
      }

      best = { fontSize: middle, ...fit }
      succeeded = true

      break
    }

    if (succeeded) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  if (best !== undefined) {
    return best
  }

  if (!options.forceFit) {
    return undefined
  }

  const fallback = fitAt(options.minFontSize, clean, maxWidth, maxHeight, measure, options, true)

  return fallback === undefined ? undefined : { fontSize: options.minFontSize, ...fallback }
}
