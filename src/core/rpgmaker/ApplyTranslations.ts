import { Predicate } from 'effect'
import type { TranslationSettings } from '#contract/GameTranslation'
import { getAt, type RpgData, setAt } from './RpgData'
import type { TextEntry } from './TextEntries'

type Formatting = TranslationSettings['formatting']

export type ApplySkipReason = 'source-mismatch' | 'broken-formatting' | 'missing-location'

export interface ApplyResult {
  readonly written: number
  readonly unchanged: number
  readonly skipped: ReadonlyArray<{
    readonly entryId: string
    readonly reason: ApplySkipReason
    readonly details?: ReadonlyArray<string>
  }>
}

const controlCodePattern = /\\[A-Z]+\[[^\]]+\]|\\[A-Z]/g

const placeholderPattern = /%\d+|\{[A-Za-z0-9_]+\}/g

const uniqueMatches = (text: string, pattern: RegExp) => [...new Set(text.match(pattern) ?? [])]

const hardSplit = (line: string, maxLength: number) =>
  Array.from({ length: Math.ceil(line.length / maxLength) }, (_, index) =>
    line.slice(index * maxLength, (index + 1) * maxLength),
  )

const wrapAtWhitespace = (line: string, maxLength: number) => {
  const lines: Array<string> = []
  let current = ''

  const startWith = (word: string) => {
    if (word.length > maxLength && word.trim() !== '') {
      lines.push(...hardSplit(word, maxLength))
      current = ''

      return
    }

    current = word.trimStart()
  }

  for (const word of line.split(/(\s+)/)) {
    if (word === '') {
      continue
    }

    if (current === '') {
      startWith(word)
      continue
    }

    if ((current + word).trimEnd().length <= maxLength) {
      current += word
      continue
    }

    lines.push(current.trimEnd())
    startWith(word)
  }

  if (current !== '') {
    lines.push(current.trimEnd())
  }

  return lines
}

export const wrapLines = (text: string, formatting: Formatting) => {
  if (formatting.maxLineLength === undefined || formatting.maxLineLength <= 0) {
    return text
  }

  const maxLength = formatting.maxLineLength

  return text
    .split('\n')
    .flatMap((line) => {
      if (line.length <= maxLength) {
        return [line]
      }

      return wrapAtWhitespace(line, maxLength)
    })
    .join('\n')
}

export const formattingProblems = (source: string, translated: string, formatting: Formatting) => [
  ...(formatting.preserveControlCodes
    ? uniqueMatches(source, controlCodePattern)
        .filter((code) => !translated.includes(code))
        .map((code) => `missing-control-code:${code}`)
    : []),
  ...(formatting.preservePlaceholders
    ? uniqueMatches(source, placeholderPattern)
        .filter((placeholder) => !translated.includes(placeholder))
        .map((placeholder) => `missing-placeholder:${placeholder}`)
    : []),
  ...(formatting.preserveLineBreaks && source.split('\n').length > translated.split('\n').length
    ? ['missing-line-breaks']
    : []),
]

const distributeLines = (text: string, slots: number) => {
  if (slots <= 1) {
    return [text]
  }

  const lines = text.split('\n')

  return [
    ...Array.from({ length: slots - 1 }, (_, index) => lines[index] ?? ''),
    lines.slice(slots - 1).join('\n'),
  ]
}

export const applyTranslations = (
  data: RpgData,
  entries: ReadonlyArray<TextEntry>,
  settings: TranslationSettings,
): ApplyResult => {
  const skipped: Array<ApplyResult['skipped'][number]> = []
  let written = 0
  let unchanged = 0

  for (const entry of entries) {
    if (entry.dst === '') {
      continue
    }

    if (entry.dst === entry.src) {
      unchanged++
      continue
    }

    const pointers = [entry.pointer, ...(entry.extraPointers ?? [])]
    const current = pointers.map((pointer) => getAt(data, pointer))

    if (!current.every(Predicate.isString)) {
      skipped.push({ entryId: entry.id, reason: 'missing-location' })
      continue
    }

    if (current.join('\n') !== entry.src) {
      skipped.push({ entryId: entry.id, reason: 'source-mismatch' })
      continue
    }

    const lines = distributeLines(wrapLines(entry.dst, settings.formatting), pointers.length)
    const problems = formattingProblems(entry.src, lines.join('\n'), settings.formatting)

    if (problems.length > 0 && settings.formatting.rejectBrokenFormatting) {
      skipped.push({ entryId: entry.id, reason: 'broken-formatting', details: problems })
      continue
    }

    if (pointers.every((pointer, index) => setAt(data, pointer, lines[index] ?? ''))) {
      written++
    } else {
      skipped.push({ entryId: entry.id, reason: 'missing-location' })
    }
  }

  return { written, unchanged, skipped }
}
