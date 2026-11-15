import { Effect, FileSystem } from 'effect'
import { MangaError } from '#contract/Manga'

/**
 * The plugin's text filters after reading (manga_translator.py, _run_textline_merge): unpaired brackets
 * are dropped and mismatched ones fixed, then a block is skipped when nothing in it is worth translating
 * or when langid says it is already in the target language.
 */

const bracketPairs: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['【', '】'],
  ['{', '}'],
  ['〔', '〕'],
  ['〈', '〉'],
  ['「', '」'],
  ['＂', '＂'],
  ["'", "'"],
  ['“', '\u201d'],
  ['《', '》'],
  ['『', '』'],
  ['"', '"'],
  ['〝', '〞'],
  ['﹁', '﹂'],
  ['﹃', '﹄'],
  ['⸂', '⸃'],
  ['⸄', '⸅'],
  ['⸉', '⸊'],
  ['⸌', '⸍'],
  ['⸜', '⸝'],
  ['⸠', '⸡'],
  ['‹', '›'],
  ['«', '»'],
  ['＜', '＞'],
  ['<', '>'],
])

const rightBrackets: ReadonlySet<string> = new Set(bracketPairs.values())

const pythonSpace =
  '\\t-\\r\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'

const pythonEdges = new RegExp(`^[${pythonSpace}]+|[${pythonSpace}]+$`, 'gu')

/** Python's str.strip(), whose whitespace is not JavaScript's \s: no U+FEFF, but U+001C to U+001F and U+0085. */
const pythonStrip = (text: string) => text.replace(pythonEdges, '')

/** The bracket repair: unpaired brackets go, a closing bracket of the wrong kind is replaced. */
export const fixBrackets = (text: string) => {
  const characters = [...pythonStrip(text)]

  const hasBrackets = characters.some(
    (character) => bracketPairs.has(character) || rightBrackets.has(character),
  )

  if (!hasBrackets) {
    return pythonStrip(characters.join(''))
  }

  const skip = new Set<number>()
  const open: Array<number> = []

  characters.forEach((character, index) => {
    if (bracketPairs.has(character)) {
      open.push(index)
    } else if (rightBrackets.has(character)) {
      if (open.length > 0) {
        open.pop()
      } else {
        skip.add(index)
      }
    }
  })

  for (const index of open) {
    skip.add(index)
  }

  const stack: Array<string> = []
  const result: Array<string> = []

  characters.forEach((character, index) => {
    if (skip.has(index)) {
      return
    }

    const closing = bracketPairs.get(character)

    if (closing !== undefined) {
      stack.push(character)
      result.push(character)
    } else if (rightBrackets.has(character)) {
      const left = stack.pop()

      if (left !== undefined) {
        result.push(bracketPairs.get(left) ?? character)
      }
    } else {
      result.push(character)
    }
  })

  return pythonStrip(result.join(''))
}

/** Python's str.isdigit beyond decimal digits: superscripts, circled and parenthesised numbers. */
const otherDigits =
  /[²³¹፩-፱᧚⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}]/u

const asciiPunctuation = /[!-/:-@[-`{-~]/u

const whitespace = /[ \t\n\r\0\p{Zs}]/u

/** is_valuable_char: not punctuation, control, whitespace or a digit. */
const isValuableCharacter = (character: string) =>
  !asciiPunctuation.test(character) &&
  !/\p{P}/u.test(character) &&
  !/[\p{Cc}\p{Cf}]/u.test(character) &&
  !whitespace.test(character) &&
  !/\p{Nd}/u.test(character) &&
  !otherDigits.test(character)

export const isValuableText = (text: string) =>
  [...text].some((character) => isValuableCharacter(character))

/** The langid codes langcodes.tag_distance puts at 0 from each Wenbu target language. */
const sameLanguage: Readonly<Record<string, string>> = {
  ENG: 'en',
  JPN: 'ja',
  KOR: 'ko',
  FRA: 'fr',
  DEU: 'de',
  ITA: 'it',
  POL: 'pl',
  RUS: 'ru',
  UKR: 'uk',
  NLD: 'nl',
  HUN: 'hu',
  THA: 'th',
  IND: 'id',
  FIL: 'tl',
  ARA: 'ar',
  SRP: 'sr',
  HRV: 'hr',
}

export interface LanguageId {
  readonly classify: (text: string) => string
}

/** py3langid's naive Bayes classifier over byte n-grams, read from the exported model file. */
export const languageIdFrom = (bytes: Uint8Array): LanguageId => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const classes = view.getUint32(0, true)
  const features = view.getUint32(4, true)
  const states = view.getUint32(8, true)
  const outputs = view.getUint32(12, true)
  let offset = 16
  const names: Array<string> = []

  for (let index = 0; index < classes; index += 1) {
    names.push(String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0).replace(/\0/gu, ''))
    offset += 2
  }

  const floats = (count: number) => {
    const values = new Float32Array(count)

    for (let index = 0; index < count; index += 1) {
      values[index] = view.getFloat32(offset + index * 4, true)
    }

    offset += count * 4

    return values
  }

  const classPriors = floats(classes)
  const featureWeights = floats(features * classes)
  const nextMove = new Uint16Array(states * 256)

  for (let index = 0; index < states * 256; index += 1) {
    nextMove[index] = view.getUint16(offset + index * 2, true)
  }

  offset += states * 512

  const words = (count: number) => {
    const values = new Uint32Array(count)

    for (let index = 0; index < count; index += 1) {
      values[index] = view.getUint32(offset + index * 4, true)
    }

    offset += count * 4

    return values
  }

  const outputStart = words(states + 1)
  const outputFeatures = words(outputs)
  const encoder = new TextEncoder()

  return {
    classify: (text) => {
      const counts = new Map<number, number>()
      let state = 0

      for (const byte of encoder.encode(text)) {
        state = nextMove[(state << 8) + byte] ?? 0

        for (
          let index = outputStart[state] ?? 0;
          index < (outputStart[state + 1] ?? 0);
          index += 1
        ) {
          const feature = outputFeatures[index] ?? 0

          counts.set(feature, (counts.get(feature) ?? 0) + 1)
        }
      }

      let best = 0
      let bestScore = Number.NEGATIVE_INFINITY

      for (let language = 0; language < classes; language += 1) {
        let score = 0

        for (const [feature, count] of counts) {
          score += count * (featureWeights[feature * classes + language] ?? 0)
        }

        score = Math.fround(Math.fround(score) + (classPriors[language] ?? 0))

        if (score > bestScore) {
          best = language
          bestScore = score
        }
      }

      return names[best] ?? ''
    },
  }
}

export const loadLanguageId = Effect.fn('TextFilter.loadLanguageId')(function* (file: string) {
  const fs = yield* FileSystem.FileSystem

  const bytes = yield* fs.readFile(file).pipe(
    Effect.mapError(
      () =>
        new MangaError({
          reason: 'failed',
          message: `The language model ${file} could not be read.`,
        }),
    ),
  )

  return languageIdFrom(bytes)
})

/** The text a block keeps after the plugin's filters, or undefined when the block is dropped. */
export const filteredText = (text: string, target: string, languageId: LanguageId) => {
  const fixed = fixBrackets(text)

  if (!isValuableText(fixed)) {
    return undefined
  }

  const same = sameLanguage[target]

  return same !== undefined && languageId.classify(fixed) === same ? undefined : fixed
}
