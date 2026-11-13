import type { GameEngine } from './Library'

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

export const visibleText = (text: string) =>
  // `\\` draws one backslash, so codes are only looked for between them.
  text
    .split('\\\\')
    .map((part) =>
      part
        .replace(/\\[NP]\[\d+\]/gi, 'Harold')
        .replace(/\\V\[\d+\]/gi, '000')
        .replace(/\\G/g, 'G')
        .replace(/\\[CcFf]\[[^\]]*\]/g, '')
        .replace(/\\[{}.|!><^$]/g, ''),
    )
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

export const measure = (line: string, fontSize: number) => {
  let width = 0

  for (const part of line.split(/(\\I\[\d+\])/i)) {
    if (/^\\I\[\d+\]$/i.test(part)) {
      width += iconWidth
      continue
    }

    for (const character of visibleText(part)) {
      width += widthOf(character, fontSize)
    }
  }

  return Math.round(width)
}

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

export const fitOf = (engine: GameEngine, context: string, text: string): Fit | undefined => {
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
