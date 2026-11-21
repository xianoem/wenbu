import type { GameEngine, MessageWindow } from './Library'

export type FitKind = 'message' | 'choice' | 'scroll' | 'help' | 'item' | 'battle'

interface Window {
  readonly width: number
  /** `undefined` for windows that scroll, where only width matters. */
  readonly lines: number | undefined
}

interface EngineWindows {
  readonly fontSize: number
  readonly windows: Record<FitKind, Window>
}

const engines: Partial<Record<GameEngine, EngineWindows>> = {
  'rpg-maker-mv': {
    fontSize: 28,
    windows: {
      message: { width: 780, lines: 4 },
      choice: { width: 780, lines: 1 },
      scroll: { width: 780, lines: undefined },
      help: { width: 780, lines: 2 },
      item: { width: 270, lines: 1 },
      battle: { width: 780, lines: 1 },
    },
  },
  'rpg-maker-mz': {
    fontSize: 26,
    windows: {
      message: { width: 784, lines: 4 },
      choice: { width: 784, lines: 1 },
      scroll: { width: 784, lines: undefined },
      help: { width: 784, lines: 2 },
      item: { width: 288, lines: 1 },
      battle: { width: 784, lines: 1 },
    },
  },
  'rpg-maker-vx-ace': {
    fontSize: 24,
    windows: {
      message: { width: 520, lines: 4 },
      choice: { width: 520, lines: 1 },
      scroll: { width: 520, lines: undefined },
      help: { width: 520, lines: 2 },
      item: { width: 172, lines: 1 },
      battle: { width: 520, lines: 1 },
    },
  },
}

const commandKinds: ReadonlyArray<readonly [string, FitKind]> = [
  [' -> Show Text', 'message'],
  [' -> Show Choices', 'choice'],
  [' -> Scroll Text', 'scroll'],
]

const fieldKinds: ReadonlyArray<readonly [RegExp, FitKind]> = [
  [
    /^(?:Items|Weapons|Armors|Skills|States|Actors|Classes)\.\w+ -> \[\d+\]\.(?:description|profile)$/,
    'help',
  ],
  [/^(?:Items|Weapons|Armors|Skills)\.\w+ -> \[\d+\]\.name$/, 'item'],
  [/^(?:Skills|States)\.\w+ -> \[\d+\]\.message\d$/, 'battle'],
]

export const kindOf = (context: string): FitKind | undefined => {
  for (const [suffix, kind] of commandKinds) {
    if (context.includes(suffix)) {
      return kind
    }
  }

  return fieldKinds.find(([pattern]) => pattern.test(context))?.[1]
}

const iconWidth = 32

const rpgMakerVisible = (part: string) =>
  part
    .replace(/\\[NP]\[\d+\]/gi, 'Harold')
    .replace(/\\V\[\d+\]/gi, '000')
    .replace(/\\G/g, 'G')
    .replace(/\\[CcFf]\[[^\]]*\]/g, '')
    .replace(/\\[{}.|!><^$]/g, '')

// Codes that print a variable or a database value stand in for a name, like RPG Maker's \N[n].
const wolfVisible = (part: string) =>
  part
    .replace(/\\r\[([^,\]]*),[^\]]*\]/gi, '$1')
    .replace(/\\(?:cself|cdb|udb|sdb|sys|self|s|v\d*)\[[^\]]*\]/gi, 'Harold')
    .replace(/\\i\[[^\]]*\]/gi, '　')
    .replace(/\\[A-Za-z]+\[[^\]]*\]/g, '')
    .replace(/\\[A-Za-z]+[+-]?|\\[.|!^<>-]/g, '')

export const visibleText = (text: string, engine?: GameEngine) =>
  // `\\` draws one backslash, so codes are only looked for between them.
  text
    .split('\\\\')
    .map((part) => (engine === 'wolf-rpg' ? wolfVisible(part) : rpgMakerVisible(part)))
    .join('\\')

const fullWidth = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-ヿ]/

const narrow = /[il.,:;!|'`I1()[\]{} ]/

const wide = /[mwMW@%]/

const widthOf = (character: string, fontSize: number) => {
  if (fullWidth.test(character)) {
    return fontSize
  }

  if (narrow.test(character)) {
    return fontSize * 0.3
  }

  if (wide.test(character)) {
    return fontSize * 0.85
  }

  if (/[A-Z0-9]/.test(character)) {
    return fontSize * 0.62
  }

  return fontSize * 0.52
}

// WOLF draws its icons as a character, which its visible text already stands in for.
const exactWidth = (line: string, fontSize: number, engine?: GameEngine) => {
  const parts = engine === 'wolf-rpg' ? [line] : line.split(/(\\I\[\d+\])/i)
  let width = 0

  for (const part of parts) {
    if (engine !== 'wolf-rpg' && /^\\I\[\d+\]$/i.test(part)) {
      width += iconWidth
      continue
    }

    for (const character of visibleText(part, engine)) {
      width += widthOf(character, fontSize)
    }
  }

  return width
}

export const measure = (line: string, fontSize: number, engine?: GameEngine) =>
  Math.round(exactWidth(line, fontSize, engine))

export interface FitLine {
  readonly text: string
  readonly width: number
}

export interface Fit {
  readonly kind: FitKind
  readonly status: 'fits' | 'too-long'
  readonly fontSize: number
  readonly maxWidth: number
  readonly maxLines: number | undefined
  readonly lines: ReadonlyArray<FitLine>
  readonly overflowPx: number
  readonly extraLines: number
}

/** WOLF games have no fixed window size, so each game's is measured in ems and drawn at this size. */
const wolfFontSize = 24

/** Ends the place of a message that a name line above it says who speaks. */
export const speakerMark = ', said by '

const unitsOf = (word: string) =>
  word.match(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z]+[+-]?|\\[\s\S]|[\s\S]/g) ?? []

const splitToWidth = (word: string, fits: (text: string) => boolean) => {
  const pieces: Array<string> = []
  let current = ''

  for (const unit of unitsOf(word)) {
    if (current !== '' && !fits(current + unit)) {
      pieces.push(current)
      current = unit
      continue
    }

    current += unit
  }

  return current === '' ? pieces : [...pieces, current]
}

const wrapToWidth = (line: string, maxWidth: number, engine: GameEngine) => {
  const fits = (text: string) => exactWidth(text, wolfFontSize, engine) <= maxWidth
  const lines: Array<string> = []
  let current = ''

  for (const word of line.trim().split(/\s+/)) {
    if (word === '') {
      continue
    }

    const candidate = current === '' ? word : `${current} ${word}`

    if (fits(candidate)) {
      current = candidate
      continue
    }

    if (current !== '') {
      lines.push(current)
    }

    const pieces = fits(word) ? [word] : splitToWidth(word, fits)

    lines.push(...pieces.slice(0, -1))
    current = pieces.at(-1) ?? ''
  }

  return current === '' ? lines : [...lines, current]
}

const nonEmptyLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const maxLinesOf = (window: MessageWindow, named: boolean) =>
  Math.max(1, window.lines - (named ? 1 : 0))

/**
 * Lays a translated message out in a measured window: its own line breaks are kept while they
 * fit, otherwise it becomes one paragraph, which takes the fewest lines.
 */
export const wrapMessage = (text: string, window: MessageWindow, named: boolean) => {
  const maxWidth = window.width * wolfFontSize
  const wrap = (line: string) => wrapToWidth(line, maxWidth, 'wolf-rpg')
  const kept = nonEmptyLines(text).flatMap((line) => wrap(line))

  if (kept.length <= maxLinesOf(window, named)) {
    return kept
  }

  return wrap(nonEmptyLines(text).join(' '))
}

const percentile = (sorted: ReadonlyArray<number>, share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0

const fewestMessages = 50

/**
 * Measures a game's message window from its original messages, which their authors broke to fit
 * it. The widest lines can be mistakes, so a high percentile stands in for the edge.
 */
export const messageWindowOf = (
  messages: ReadonlyArray<{ readonly body: string; readonly named: boolean }>,
  engine: GameEngine,
): MessageWindow | undefined => {
  if (messages.length < fewestMessages) {
    return undefined
  }

  const widths = messages
    .flatMap((message) => nonEmptyLines(message.body))
    .map((line) => exactWidth(line, wolfFontSize, engine) / wolfFontSize)
    .toSorted((left, right) => left - right)

  const lines = messages
    .map((message) => nonEmptyLines(message.body).length + (message.named ? 1 : 0))
    .toSorted((left, right) => left - right)

  return {
    width: Math.floor(percentile(widths, 0.99) * 2) / 2,
    lines: percentile(lines, 0.995),
  }
}

const wolfFit = (context: string, text: string, window: MessageWindow | undefined) => {
  if (kindOf(context) !== 'message' || window === undefined) {
    return undefined
  }

  const named = context.includes(speakerMark)
  const maxLines = maxLinesOf(window, named)
  const maxWidth = Math.round(window.width * wolfFontSize)

  const lines = wrapMessage(text, window, named).map((line) => ({
    text: line,
    width: measure(line, wolfFontSize, 'wolf-rpg'),
  }))

  const overflowPx = Math.max(0, ...lines.map((line) => line.width - maxWidth))
  const extraLines = Math.max(0, lines.length - maxLines)

  return {
    kind: 'message',
    status: overflowPx > 0 || extraLines > 0 ? 'too-long' : 'fits',
    fontSize: wolfFontSize,
    maxWidth,
    maxLines,
    lines,
    overflowPx,
    extraLines,
  } satisfies Fit
}

export const fitOf = (
  engine: GameEngine,
  context: string,
  text: string,
  measured?: MessageWindow,
): Fit | undefined => {
  if (engine === 'wolf-rpg') {
    return wolfFit(context, text, measured)
  }

  const kind = kindOf(context)
  const metrics = engines[engine]

  if (kind === undefined || metrics === undefined) {
    return undefined
  }

  const window = metrics.windows[kind]

  const lines = text
    .split('\n')
    .map((line) => ({ text: line, width: measure(line, metrics.fontSize) }))

  const overflowPx = Math.max(0, ...lines.map((line) => line.width - window.width))
  const extraLines = window.lines === undefined ? 0 : Math.max(0, lines.length - window.lines)

  return {
    kind,
    status: overflowPx > 0 || extraLines > 0 ? 'too-long' : 'fits',
    fontSize: metrics.fontSize,
    maxWidth: window.width,
    maxLines: window.lines,
    lines,
    overflowPx,
    extraLines,
  }
}

export const characterBudget = (fit: Fit) => Math.floor(fit.maxWidth / (fit.fontSize * 0.52))
