/**
 * A port of the lettering's text handling (wenbu_manga/skia/text_processing.py): styled segments,
 * tokens that respect Japanese line-break rules (kinsoku), hyphenation, and the line breaks themselves
 * (a Knuth-style minimum of cubed slack, or greedy), with the balanced mode narrowing the width.
 */

export interface LineBreaking {
  readonly mode: 'balanced' | 'greedy' | 'manual'
  readonly avoidOrphans: boolean
  readonly evenOut: boolean
}

export type Style = 'regular' | 'italic' | 'bold' | 'bold_italic'

const stylePattern = () => /(\*{1,3})(.*?)(\1)/gu

const styleOf = (marker: string): Style => {
  if (marker.length === 3) {
    return 'bold_italic'
  }

  return marker.length === 2 ? 'bold' : 'italic'
}

/** A token that is one styled run, `*word*`, matched from its start like Python's re.match. */
const styledMatch = (token: string) => /^(\*{1,3})(.*?)(\1)/u.exec(token)

const styledContent = (token: string) => styledMatch(token)?.[2] ?? token

export const parseStyledSegments = (text: string): ReadonlyArray<readonly [string, Style]> => {
  const segments: Array<readonly [string, Style]> = []
  let lastEnd = 0

  for (const match of text.matchAll(stylePattern())) {
    const start = match.index

    if (start > lastEnd) {
      segments.push([text.slice(lastEnd, start), 'regular'])
    }

    segments.push([match[2] ?? '', styleOf(match[1] ?? '*')])
    lastEnd = start + match[0].length
  }

  if (lastEnd < text.length) {
    segments.push([text.slice(lastEnd), 'regular'])
  }

  return segments.filter(([segment]) => segment !== '')
}

const pythonSpaces: ReadonlyArray<readonly [number, number]> = [
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
]

/** Python's str.isspace. */
export const isSpace = (character: string) => {
  const code = character.codePointAt(0) ?? 0

  return pythonSpaces.some(([low, high]) => code >= low && code <= high)
}

/** Python's str.split() without arguments: runs of whitespace separate, empty parts are dropped. */
export const splitWords = (text: string) => {
  const words: Array<string> = []
  let current = ''

  for (const character of text) {
    if (isSpace(character)) {
      if (current !== '') {
        words.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }

  return current === '' ? words : [...words, current]
}

const isHangul = (code: number) =>
  (code >= 0xac00 && code <= 0xd7af) ||
  (code >= 0x1100 && code <= 0x11ff) ||
  (code >= 0x3130 && code <= 0x318f)

const cjkRanges: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x3040, 0x309f],
  [0x30a0, 0x30ff],
  [0x31f0, 0x31ff],
  [0xac00, 0xd7af],
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0x3000, 0x303f],
  [0xff00, 0xffef],
]

const isCjk = (code: number) => cjkRanges.some(([low, high]) => code >= low && code <= high)

/** A CJK character that is not Hangul: one that may break on its own. */
const isCjkOnly = (character: string) => {
  const code = character.codePointAt(0) ?? 0

  return isCjk(code) && !isHangul(code)
}

const notAtStart = new Set(
  '、。，．！？）】」』〕〉》，．！？）］｝,.)!?;:…‥ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
)

const notAtEnd = new Set('（【「『〔〈《（［｛([')

const trailingEllipsis = /^(.*?)((\.{2,})[)\]}\u2019\u201d'"]*)$/u
const ellipsisToken = /^(\.{2,})[)\]}\u2019\u201d'"]*$/u

const splitCjkAware = (text: string, detachEllipsis: boolean) => {
  const tokens: Array<string> = []
  let current = ''

  for (const character of text) {
    if (isSpace(character)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
    } else if (isCjkOnly(character)) {
      if (notAtStart.has(character)) {
        if (current !== '') {
          current += character
        } else if (tokens.length > 0) {
          tokens[tokens.length - 1] += character
        } else {
          current = character
        }
      } else if (notAtEnd.has(character)) {
        if (current !== '') {
          tokens.push(current)
        }

        current = character
      } else if (current === '') {
        tokens.push(character)
      } else if (notAtEnd.has([...current].at(-1) ?? '')) {
        tokens.push(current + character)
        current = ''
      } else {
        tokens.push(current, character)
        current = ''
      }
    } else {
      current += character
    }
  }

  if (current !== '') {
    tokens.push(current)
  }

  if (!detachEllipsis) {
    return tokens
  }

  return tokens.flatMap((token) => {
    const match = trailingEllipsis.exec(token)

    return match !== null && (match[1] ?? '') !== '' ? [match[1] ?? '', match[2] ?? ''] : [token]
  })
}

/** tokenize_styled_text: tokens, with styled ones wrapped in their markers. */
export const tokenizeStyledText = (
  text: string,
  detachEllipsis: boolean,
): ReadonlyArray<readonly [string, boolean]> => {
  const tokens: Array<readonly [string, boolean]> = []
  let lastEnd = 0

  for (const match of text.matchAll(stylePattern())) {
    const start = match.index

    if (start > lastEnd) {
      for (const word of splitCjkAware(text.slice(lastEnd, start), detachEllipsis)) {
        tokens.push([word, false])
      }
    }

    const marker = match[1] ?? '*'
    const content = match[2] ?? ''

    for (const word of content === '' ? [] : splitCjkAware(content, detachEllipsis)) {
      tokens.push([`${marker}${word}${marker}`, true])
    }

    lastEnd = start + match[0].length
  }

  if (lastEnd < text.length) {
    for (const word of splitCjkAware(text.slice(lastEnd), detachEllipsis)) {
      tokens.push([word, false])
    }
  }

  return tokens
}

/** Python's \w and \W in str patterns: letters, numbers and the underscore. */
const word = '[\\p{L}\\p{N}_]'
const nonWord = '[^\\p{L}\\p{N}_]'

export const hyphenatedWord = new RegExp(`^(${nonWord}*)((?:${word}|-)+)(${nonWord}*)$`, 'u')

const splitWithHyphen = (base: ReadonlyArray<string>, index: number) => {
  const before = index > 0 ? (base[index - 1] ?? '') : ''
  const at = base[index] ?? ''
  let left: string
  let right: string

  if (at === '-') {
    left = base.slice(0, index + 1).join('')
    right = base.slice(index + 1).join('')
  } else if (before === '-') {
    left = base.slice(0, index).join('')
    right = base.slice(index).join('')
  } else {
    left = `${base.slice(0, index).join('')}-`
    right = base.slice(index).join('')
  }

  if (left.endsWith('-') && right.startsWith('-')) {
    right = right.slice(1)
  }

  return [left, right] as const
}

/** try_hyphenate_word: the split nearest the middle whose halves both fit. */
export const tryHyphenateWord = (
  text: string,
  minLength: number,
  fits: (part: string) => boolean,
): ReadonlyArray<string> | undefined => {
  const match = hyphenatedWord.exec(text)

  if (match === null) {
    return undefined
  }

  const leading = match[1] ?? ''
  const core = [...(match[2] ?? '')]
  const trailing = match[3] ?? ''

  if (core.length < minLength) {
    return undefined
  }

  const middle = Math.floor(core.length / 2)

  if (core.includes('-')) {
    const positions = core
      .flatMap((character, index) => (character === '-' ? [index] : []))
      .toSorted((a, b) => Math.abs(a - middle) - Math.abs(b - middle))

    for (const position of positions) {
      if (position <= 0 || position >= core.length - 1) {
        continue
      }

      const left = leading + core.slice(0, position + 1).join('')
      const right = core.slice(position + 1).join('') + trailing

      if (fits(left) && fits(right)) {
        return [left, right]
      }
    }
  }

  const candidates: Array<number> = []

  for (let distance = 0; distance < Math.max(middle, core.length - middle); distance += 1) {
    const leftIndex = middle - distance
    const rightIndex = middle + distance

    if (leftIndex >= 2 && leftIndex < core.length - 2) {
      candidates.push(leftIndex)
    }

    if (rightIndex >= 2 && rightIndex < core.length - 2 && rightIndex !== leftIndex) {
      candidates.push(rightIndex)
    }
  }

  for (const index of candidates) {
    const [leftPart, rightPart] = splitWithHyphen(core, index)
    const left = leading + leftPart
    const right = rightPart + trailing

    if (fits(left) && fits(right)) {
      return [left, right]
    }
  }

  return undefined
}

const isCjkToken = (token: string) => {
  const content = [...styledContent(token)]

  return content.length > 0 && content.every((character) => isCjkOnly(character))
}

const needsSpaceBetween = (left: string, right: string, detachEllipsis: boolean) => {
  if (isCjkToken(left) && isCjkToken(right)) {
    return false
  }

  return !(detachEllipsis && ellipsisToken.test(styledContent(right)))
}

export const joinTokens = (tokens: ReadonlyArray<string>, detachEllipsis: boolean) =>
  tokens.reduce((line, token, index) => {
    if (index === 0) {
      return token
    }

    return needsSpaceBetween(tokens[index - 1] ?? '', token, detachEllipsis)
      ? `${line} ${token}`
      : line + token
  }, '')

export interface BreakOptions {
  readonly style: LineBreaking
  readonly badnessExponent: number
  readonly hyphenPenalty: number
  readonly detachEllipsis: boolean
}

const greedyBreaks = (
  tokens: ReadonlyArray<string>,
  widths: ReadonlyArray<number>,
  maxWidth: number,
  spaceWidth: number,
  detachEllipsis: boolean,
) => {
  const lines: Array<Array<string>> = []
  let width = 0

  for (const [index, token] of tokens.entries()) {
    const tokenWidth = widths[index] ?? 0
    const last = lines.at(-1)

    if (last !== undefined) {
      const gap = needsSpaceBetween(last.at(-1) ?? '', token, detachEllipsis) ? spaceWidth : 0

      if (width + gap + tokenWidth <= maxWidth) {
        last.push(token)
        width += gap + tokenWidth

        continue
      }
    }

    if (tokenWidth > maxWidth) {
      return undefined
    }

    lines.push([token])
    width = tokenWidth
  }

  return lines.map((line) => joinTokens(line, detachEllipsis))
}

const endsWithHyphen = (token: string) =>
  token.endsWith('-') || (styledMatch(token)?.[2] ?? '').endsWith('-')

/** find_optimal_breaks_dp: the breaks with the least total cubed slack, plus the penalties. */
export const optimalBreaks = (
  tokens: ReadonlyArray<string>,
  maxWidth: number,
  tokenWidth: (token: string) => number,
  spaceWidth: number,
  options: BreakOptions,
): ReadonlyArray<string> | undefined => {
  if (tokens.length === 0) {
    return []
  }

  const widths = tokens.map((token) => tokenWidth(token))

  if (options.style.mode === 'greedy') {
    return greedyBreaks(tokens, widths, maxWidth, spaceWidth, options.detachEllipsis)
  }

  const orphanPenalty = options.style.avoidOrphans ? maxWidth ** options.badnessExponent : 0
  const count = tokens.length
  const cost = Array.from({ length: count + 1 }, () => Number.POSITIVE_INFINITY)
  const path = Array.from({ length: count + 1 }, () => 0)

  cost[0] = 0

  for (let end = 1; end <= count; end += 1) {
    let lineWidth = 0

    for (let start = end - 1; start >= 0; start -= 1) {
      if (
        start < end - 1 &&
        needsSpaceBetween(tokens[start] ?? '', tokens[start + 1] ?? '', options.detachEllipsis)
      ) {
        lineWidth += spaceWidth
      }

      lineWidth += widths[start] ?? 0

      if (lineWidth > maxWidth) {
        break
      }

      let badness = (maxWidth - lineWidth) ** options.badnessExponent

      if (endsWithHyphen(tokens[end - 1] ?? '')) {
        badness += options.hyphenPenalty
      }

      if (end === count && start === end - 1 && start > 0) {
        badness += orphanPenalty
      }

      const total = (cost[start] ?? Number.POSITIVE_INFINITY) + badness

      if (total < (cost[end] ?? Number.POSITIVE_INFINITY)) {
        cost[end] = total
        path[end] = start
      }
    }
  }

  if (!Number.isFinite(cost[count] ?? Number.POSITIVE_INFINITY)) {
    return undefined
  }

  const lines: Array<string> = []

  for (let end = count; end > 0; end = path[end] ?? 0) {
    lines.unshift(joinTokens(tokens.slice(path[end] ?? 0, end), options.detachEllipsis))
  }

  return lines
}

/** evened_breaks: in balanced mode, the narrowest width that keeps the same number of lines. */
export const evenedBreaks = (
  tokens: ReadonlyArray<string>,
  maxWidth: number,
  tokenWidth: (token: string) => number,
  spaceWidth: number,
  lineWidth: (line: string) => number,
  options: BreakOptions,
) => {
  const lines = optimalBreaks(tokens, maxWidth, tokenWidth, spaceWidth, options)

  if (
    lines === undefined ||
    lines.length < 2 ||
    options.style.mode !== 'balanced' ||
    !options.style.evenOut
  ) {
    return lines
  }

  let low = 0
  let high = maxWidth
  let best = lines

  for (let step = 0; step < 10; step += 1) {
    const width = (low + high) / 2
    const tried = optimalBreaks(tokens, width, tokenWidth, spaceWidth, options)

    if (
      tried !== undefined &&
      tried.length === lines.length &&
      Math.max(...tried.map((line) => lineWidth(line))) <= width
    ) {
      best = tried
      high = width
    } else {
      low = width
    }
  }

  return best
}
