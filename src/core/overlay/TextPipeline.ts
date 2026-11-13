import { Match, Result, Schema } from 'effect'
import {
  type DedupeCharacters,
  type DedupeWholeText,
  type KeepLines,
  StringReplacement,
  type TextPipeline,
  type TextPipelineResult,
  type TextPipelineStep,
  type TextProcessor,
} from '#contract/TranslationOverlay'

const isStringReplacement = Schema.is(StringReplacement)

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemes = (text: string): Array<string> =>
  Array.from(segmenter.segment(text), (segment) => segment.segment)

const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\' }

const decodeEscapes = (value: string) =>
  value.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([nrt0\\]))/gu,
    (_match, point?: string, unicode?: string, hex?: string, simple?: string) => {
      const code = point ?? unicode ?? hex

      return code === undefined
        ? (escapes[simple ?? ''] ?? '')
        : String.fromCodePoint(Number.parseInt(code, 16))
    },
  )

const ruleKey = (rule: (typeof StringReplacement)['Type']['rules'][number]) =>
  rule.escape ? decodeEscapes(rule.key) : rule.key

const regexOf = (key: string) =>
  Result.try({
    try: () => new RegExp(key, 'gu'),
    catch: (error) => `Invalid regular expression: ${String(error)}`,
  })

const stringReplacement = (text: string, processor: (typeof StringReplacement)['Type']) => {
  let result = text

  for (const rule of processor.rules) {
    if (rule.key === '') {
      continue
    }

    const key = ruleKey(rule)
    const value = rule.escape ? decodeEscapes(rule.value) : rule.value

    if (!rule.regex) {
      result = result.split(key).join(value)

      continue
    }

    const regex = regexOf(key)

    if (Result.isFailure(regex)) {
      return Result.fail(regex.failure)
    }

    result = result.replace(regex.success, value)
  }

  return Result.succeed(result)
}

let shiftJisCharacters: ReadonlySet<string> | undefined

// Node has no Shift-JIS encoder, so the encodable characters come from decoding every byte sequence.
const shiftJis = () => {
  if (shiftJisCharacters !== undefined) {
    return shiftJisCharacters
  }

  const decoder = new TextDecoder('shift_jis')
  const characters = new Set<string>()

  const add = (bytes: Array<number>) => {
    const character = decoder.decode(Uint8Array.from(bytes))

    if (character !== '�' && [...character].length === 1) {
      characters.add(character)
    }
  }

  for (let byte = 0; byte <= 0xdf; byte += 1) {
    add([byte])
  }

  for (let lead = 0x81; lead <= 0xfc; lead += 1) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      add([lead, trail])
    }
  }

  shiftJisCharacters = characters

  return characters
}

const removeNonShiftJis = (text: string) => {
  const allowed = shiftJis()

  return graphemes(text)
    .filter((character) => allowed.has(character))
    .join('')
}

const isKeptControl = (code: number) => code === 0x09 || code === 0x0a || code === 0x0d

const removeControlCharacters = (text: string) =>
  graphemes(text)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0

      return isKeptControl(code) || !(code <= 0x1f || (code >= 0x7f && code <= 0xa0))
    })
    .join('')

const keepJapaneseQuotes = (text: string) => {
  const start = text.indexOf('「')
  const end = text.lastIndexOf('」')

  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

const removeBraces = (text: string) =>
  text
    .replace(/\{(\w+)(.*?)\}(.*?)\{\/\1\}/gu, '$3')
    .replace(/\{([^}]*)[:/](.*?)\}/gu, '$1')
    .replace(/\{.*?\}/gu, '')

const keepLines = (text: string, processor: (typeof KeepLines)['Type']) => {
  const lines = text.split(/\r?\n/u)
  const count = Math.max(1, Math.trunc(Math.abs(processor.count)))

  if (lines.length < count) {
    return text
  }

  return (processor.from === 'end' ? lines.slice(-count) : lines.slice(0, count)).join('\n')
}

const runLengths = (characters: ReadonlyArray<string>) => {
  const lengths: Array<number> = []
  let previous: string | undefined
  let length = 0

  for (const character of [...characters, '\0']) {
    if (character === previous) {
      length += 1

      continue
    }

    if (length > 0) {
      lengths.push(length)
    }

    previous = character
    length = 1
  }

  return lengths
}

const frequencies = <A>(values: ReadonlyArray<A>) => {
  const counts = new Map<A, number>()

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return counts
}

const inferRunRepeatCount = (characters: ReadonlyArray<string>) => {
  const counts = frequencies(runLengths(characters))
  const maximum = Math.max(...counts.values(), 1)

  const candidates = [...counts.entries()]
    .filter(([, count]) => count === maximum)
    .map(([length]) => length)
    .toSorted((left, right) => left - right)

  const preferred = candidates[0] === 1 && candidates.length > 1 ? candidates.slice(1) : candidates

  return preferred[0] ?? 1
}

// Some hooks repeat names twice and dialogue three times in one line, so every common run length counts as one.
const inferMixedRunRepeatCounts = (
  characters: ReadonlyArray<string>,
  primary: number,
): ReadonlySet<number> => {
  if (primary < 2) {
    return new Set()
  }

  const lengths = runLengths(characters)
  const counts = frequencies(lengths)
  const repeated = lengths.filter((length) => length >= 2).reduce((sum, length) => sum + length, 0)
  const primaryCount = counts.get(primary) ?? 0

  if (primaryCount < 4 || repeated / Math.max(1, characters.length) < 0.7) {
    return new Set([primary])
  }

  const supported = [...counts.entries()]
    .filter(
      ([length, count]) =>
        length >= 2 && (length === primary || count >= Math.max(3, Math.ceil(primaryCount * 0.15))),
    )
    .map(([length]) => length)

  return new Set(supported.length >= 2 ? supported : [primary])
}

const dedupeCharacters = (text: string, processor: (typeof DedupeCharacters)['Type']) => {
  const characters = graphemes(text)
  const fixed = processor.repeatCount >= 2
  const repeatCount = fixed ? processor.repeatCount : inferRunRepeatCount(characters)

  if (repeatCount <= 1) {
    return text
  }

  if (!processor.preserveNonRepeated) {
    return Array.from(
      { length: Math.floor(characters.length / repeatCount) },
      (_, index) => characters[index * repeatCount],
    ).join('')
  }

  const mixed = fixed ? new Set([repeatCount]) : inferMixedRunRepeatCounts(characters, repeatCount)
  let result = ''
  let index = 0

  while (index < characters.length) {
    result += characters[index]

    let run = 1

    while (index + run < characters.length && characters[index + run] === characters[index]) {
      run += 1
    }

    if (mixed.has(run)) {
      index += run

      continue
    }

    const group = characters.slice(index, index + repeatCount)

    index += group.length === repeatCount && new Set(group).size === 1 ? repeatCount : 1
  }

  return result
}

const repeatsWhole = (characters: ReadonlyArray<string>, times: number) => {
  const unit = Math.floor(characters.length / times)

  return (
    unit * times === characters.length &&
    characters.every((character, index) => character === characters[index % unit])
  )
}

const dedupeWholeText = (text: string, processor: (typeof DedupeWholeText)['Type']) => {
  const characters = graphemes(text)
  let times = processor.repeatCount

  if (times < 2) {
    times = characters.length

    while (times > 1 && !repeatsWhole(characters, times)) {
      times -= 1
    }
  }

  return characters.slice(0, Math.floor(characters.length / Math.max(1, times))).join('')
}

const sameRun = (characters: ReadonlyArray<string>, length: number) =>
  characters.slice(0, length).every((character, index) => character === characters[length + index])

const dedupeVariableSegments = (text: string) => {
  let remaining = graphemes(text)
  let result = ''

  while (remaining.length > 0) {
    let length = Math.floor(remaining.length / 2)

    while (length > 1 && !sameRun(remaining, length)) {
      length -= 1
    }

    if (length > 1) {
      remaining = remaining.slice(length)

      continue
    }

    result += remaining[0]
    remaining = remaining.slice(1)
  }

  return result
}

const recoverShrinkingSuffix = (text: string) => {
  const characters = graphemes(text)
  const counts = frequencies(characters)

  const byCount = [...counts.keys()].toSorted(
    (left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0),
  )

  const candidates = byCount.map((character) => {
    let last = characters.lastIndexOf(character)
    let length = 1

    while (last - length >= 0) {
      if (characters[last] === characters[last - length]) {
        last -= length
      }

      if (last - length <= 0) {
        break
      }

      length += 1
    }

    return characters.slice(last - length, last + 1).join('')
  })

  return candidates.toSorted((left, right) => right.length - left.length)[0] ?? text
}

const recoverGrowingPrefixLine = (text: string) => {
  const characters = graphemes(text)

  for (let length = characters.length; length >= 2; length -= 1) {
    const candidate = characters.slice(-length)
    const expanded = candidate.flatMap((_, index) => candidate.slice(0, index + 1))

    if (
      expanded.length === characters.length &&
      expanded.every((character, index) => character === characters[index])
    ) {
      return candidate.join('')
    }
  }

  return text
}

const processText = (text: string, processor: TextProcessor): Result.Result<string, string> =>
  Match.valueTags(processor, {
    StringReplacement: (current) => stringReplacement(text, current),
    RemoveNonShiftJis: () => Result.succeed(removeNonShiftJis(text)),
    RemoveControlCharacters: () => Result.succeed(removeControlCharacters(text)),
    RemoveAsciiPunctuation: () =>
      Result.succeed(text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu, '')),
    KeepJapaneseQuotes: () => Result.succeed(keepJapaneseQuotes(text)),
    RemoveBraces: () => Result.succeed(removeBraces(text)),
    KeepLines: (current) => Result.succeed(keepLines(text, current)),
    DedupeCharacters: (current) => Result.succeed(dedupeCharacters(text, current)),
    DedupeWholeText: (current) => Result.succeed(dedupeWholeText(text, current)),
    DedupeVariableSegments: () => Result.succeed(dedupeVariableSegments(text)),
    RecoverShrinkingSuffix: () => Result.succeed(recoverShrinkingSuffix(text)),
    RecoverGrowingPrefix: () =>
      Result.succeed(text.split(/\r?\n/u).map(recoverGrowingPrefixLine).join('\n')),
    RemoveAngleTags: () => Result.succeed(text.replace(/<(.*?)>/gu, '')),
    RemoveLineBreaks: () => Result.succeed(text.split(/\r?\n/u).filter(Boolean).join(' ')),
    RemoveNumbers: () => Result.succeed(text.replace(/[0-9]+/gu, '')),
    RemoveLatinLetters: () => Result.succeed(text.replace(/[a-zA-Z]+/gu, '')),
  })

export const applyTextPipeline = (text: string, pipeline: TextPipeline): TextPipelineResult => {
  let current = text
  const steps: Array<TextPipelineStep> = []

  for (const processor of pipeline.processors) {
    if (!processor.enabled) {
      continue
    }

    const before = current
    const result = processText(current, processor)

    if (Result.isFailure(result)) {
      steps.push({ processorId: processor.id, before, after: before, error: result.failure })

      continue
    }

    current = result.success
    steps.push({ processorId: processor.id, before, after: current })
  }

  return { text: current, steps }
}

export interface PipelineProblem {
  readonly processorId: string
  readonly ruleId: string
  readonly message: string
}

export const pipelineProblems = (pipeline: TextPipeline): ReadonlyArray<PipelineProblem> =>
  pipeline.processors.filter(isStringReplacement).flatMap((processor) =>
    processor.rules.flatMap((rule) => {
      if (!rule.regex || rule.key === '') {
        return []
      }

      const regex = regexOf(ruleKey(rule))

      return Result.isFailure(regex)
        ? [{ processorId: processor.id, ruleId: rule.id, message: regex.failure }]
        : []
    }),
  )
