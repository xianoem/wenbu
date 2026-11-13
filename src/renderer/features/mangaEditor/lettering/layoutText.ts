import type { BreakMode } from '#contract/MangaEditor'

export interface TextFont {
  readonly measure: (text: string, size: number) => number
  readonly ascent: number
  readonly descent: number
  readonly gap: number
}

export interface LayoutRequest {
  readonly text: string
  readonly width: number
  readonly height: number
  readonly size?: number
  readonly shrinkTo?: number
  readonly minSize: number
  readonly maxSize: number
  readonly leading: number
  readonly breakMode: BreakMode
  readonly avoidOrphans: boolean
  readonly hyphenate: boolean
  readonly uppercase: boolean
}

export interface TextLayout {
  readonly size: number
  readonly lines: ReadonlyArray<string>
  readonly lineHeight: number
  readonly height: number
  readonly ascent: number
  readonly fits: boolean
}

const padding = 0.02

const hyphenationMinLength = 8

const hyphenPenalty = 1000

const badnessExponent = 3

interface Measured {
  readonly words: ReadonlyArray<string>
  readonly widths: ReadonlyArray<number>
  readonly space: number
}

const joined = (words: ReadonlyArray<string>) => words.join(' ')

const hyphenated = (word: string, fits: (part: string) => boolean): ReadonlyArray<string> => {
  const found = /^(\W*)([\w-]+)(\W*)$/u.exec(word)
  const lead = found?.[1] ?? ''
  const core = found?.[2] ?? ''
  const trail = found?.[3] ?? ''

  if (found === null || core.length < hyphenationMinLength) {
    return [word]
  }

  const middle = Math.floor(core.length / 2)
  const candidates: Array<number> = []

  for (let distance = 0; distance < Math.max(middle, core.length - middle); distance++) {
    for (const at of [middle - distance, middle + distance]) {
      if (at >= 2 && at < core.length - 2 && !candidates.includes(at)) {
        candidates.push(at)
      }
    }
  }

  for (const at of candidates) {
    const left = `${lead}${core.slice(0, at)}${core[at - 1] === '-' ? '' : '-'}`
    const right = `${core.slice(at)}${trail}`

    if (fits(left) && fits(right)) {
      return [left, right]
    }
  }

  return [word]
}

const greedy = ({ words, widths, space }: Measured, width: number) => {
  const lines: Array<Array<string>> = []
  let used = 0

  for (const [index, word] of words.entries()) {
    const wordWidth = widths[index] ?? 0
    const current = lines.at(-1)

    if (current !== undefined && used + space + wordWidth <= width) {
      current.push(word)
      used += space + wordWidth
    } else {
      lines.push([word])
      used = wordWidth
    }
  }

  return lines.map(joined)
}

const balanced = ({ words, widths, space }: Measured, width: number, avoidOrphans: boolean) => {
  const count = words.length
  const cost = Array.from({ length: count + 1 }, () => Number.POSITIVE_INFINITY)
  const from = Array.from({ length: count + 1 }, () => 0)
  const orphan = avoidOrphans ? width ** badnessExponent : 0

  cost[0] = 0

  for (let end = 1; end <= count; end++) {
    let used = 0

    for (let start = end - 1; start >= 0; start--) {
      used += (widths[start] ?? 0) + (start < end - 1 ? space : 0)

      if (used > width && start < end - 1) {
        break
      }

      const hyphen = words[end - 1]?.endsWith('-') === true ? hyphenPenalty : 0
      const lonely = end === count && start === end - 1 && start > 0 ? orphan : 0

      const total =
        (cost[start] ?? 0) + Math.max(0, width - used) ** badnessExponent + hyphen + lonely

      if (total < (cost[end] ?? Number.POSITIVE_INFINITY)) {
        cost[end] = total
        from[end] = start
      }
    }
  }

  const lines: Array<string> = []

  for (let end = count; end > 0; end = from[end] ?? 0) {
    lines.unshift(joined(words.slice(from[end] ?? 0, end)))
  }

  return lines
}

const widestOf = (lines: ReadonlyArray<string>, font: TextFont, size: number) =>
  Math.max(0, ...lines.map((line) => font.measure(line, size)))

const evened = (
  measured: Measured,
  width: number,
  avoidOrphans: boolean,
  lineWidth: (lines: ReadonlyArray<string>) => number,
) => {
  const lines = balanced(measured, width, avoidOrphans)
  let low = 0
  let high = width
  let best = lines

  if (lines.length < 2) {
    return lines
  }

  for (let step = 0; step < 10; step++) {
    const tried = (low + high) / 2
    const attempt = balanced(measured, tried, avoidOrphans)

    if (attempt.length === lines.length && lineWidth(attempt) <= tried) {
      best = attempt
      high = tried
    } else {
      low = tried
    }
  }

  return best
}

const linesAt = (
  font: TextFont,
  request: LayoutRequest,
  text: string,
  size: number,
  width: number,
) => {
  if (request.breakMode === 'manual') {
    return text.split('\n').map((line) => line.split(/\s+/u).filter(Boolean).join(' '))
  }

  const fits = (part: string) => font.measure(part, size) <= width

  const words = text
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((word) => (request.hyphenate && !fits(word) ? hyphenated(word, fits) : [word]))

  const measured = {
    words,
    widths: words.map((word) => font.measure(word, size)),
    space: font.measure(' ', size),
  }

  if (request.breakMode === 'greedy') {
    return greedy(measured, width)
  }

  return evened(measured, width, request.avoidOrphans, (lines) => widestOf(lines, font, size))
}

const shapeAt = (
  font: TextFont,
  request: LayoutRequest,
  text: string,
  size: number,
  box: { readonly width: number; readonly height: number },
): TextLayout => {
  const lines = linesAt(font, request, text, size, box.width)
  const lineHeight = (font.ascent + font.descent + font.gap) * size * request.leading
  const height = (font.ascent + font.descent) * size + (lines.length - 1) * lineHeight
  const fits = widestOf(lines, font, size) <= box.width && height <= box.height

  return { size, lines, lineHeight, height, ascent: font.ascent * size, fits }
}

const largestFitting = (low: number, high: number, shape: (size: number) => TextLayout) => {
  let best = shape(low)

  for (let from = low, to = high; from <= to;) {
    const middle = Math.floor((from + to) / 2)
    const attempt = shape(middle)

    if (attempt.fits) {
      best = attempt
      from = middle + 1
    } else {
      to = middle - 1
    }
  }

  return best
}

export const layoutText = (font: TextFont, request: LayoutRequest): TextLayout => {
  const width = request.width * (1 - 2 * padding)
  const height = request.height * (1 - 2 * padding)
  const normalized = request.text.replaceAll('—', '-')
  const text = request.uppercase ? normalized.toUpperCase() : normalized

  const shape = (size: number) => shapeAt(font, request, text, size, { width, height })

  if (request.size === undefined) {
    return largestFitting(request.minSize, request.maxSize, shape)
  }

  const fixed = shape(request.size)

  if (fixed.fits || request.shrinkTo === undefined || request.shrinkTo >= request.size) {
    return fixed
  }

  return largestFitting(Math.ceil(request.shrinkTo), request.size - 1, shape)
}
