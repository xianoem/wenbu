import { Option } from 'effect'

export interface FoundCode {
  readonly code: string
  readonly releasedOn: Option.Option<string>
}

const productCode = /(?<![A-Za-z0-9])(RJ|VJ|BJ)(\d{8}|\d{6})(?!\d)/gi

/** Some sharing sites name a work by its release date and its RJ number with a G. */
const datedCode = /(?<!\d)(\d{2})(\d{2})(\d{2})-G(\d{8}|\d{6})(?!\d)/g

export const codesIn = (name: string): ReadonlyArray<FoundCode> => {
  const plain = [...name.matchAll(productCode)].map((match) => ({
    at: match.index,
    code: `${(match[1] ?? '').toUpperCase()}${match[2] ?? ''}`,
    releasedOn: Option.none<string>(),
  }))

  const dated = [...name.matchAll(datedCode)].map((match) => ({
    at: match.index,
    code: `RJ${match[4] ?? ''}`,
    releasedOn: Option.some(`20${match[1]}-${match[2]}-${match[3]}`),
  }))

  return [...plain, ...dated]
    .toSorted((a, b) => a.at - b.at)
    .map(({ code, releasedOn }) => ({ code, releasedOn }))
}

export const firstCode = (names: ReadonlyArray<string>): Option.Option<FoundCode> =>
  Option.fromNullishOr(names.flatMap((name) => codesIn(name))[0])

const genericSegments = new Set([
  'games',
  'game',
  'h',
  'downloads',
  'download',
  'desktop',
  'program files',
  'program files (x86)',
  'www',
  'data',
  'bin',
  'release',
])

const noiseWords = new Set([
  'eng',
  'english',
  'en',
  'enpatch',
  'patch',
  'patched',
  'decensored',
  'uncensored',
  'full',
  'final',
  'pc',
  'win',
  'bugfix',
  'complete',
  'copy',
  'mtl',
])

const noise = [
  productCode,
  datedCode,
  /\[\d{6}\]/g,
  /\bv(?:er(?:sion)?)?[ ._]?\d+(?:[._]\d+)*[a-z]?\b/gi,
  /\bdemo\s*\d*\b/gi,
  /\b[\w-]+\.(?:com|net|org|to|io)\b/gi,
  /\.(?:part\d+\.)?(?:rar|zip|7z|url|exe)$/gi,
]

export const cleanTitle = (name: string) => {
  const stripped = noise.reduce(
    (text, pattern) => text.replaceAll(pattern, ' '),
    name.normalize('NFKC').replaceAll('_', ' '),
  )

  return stripped
    .replaceAll(/\s[-–]\s|^[-–\s]+|[-–\s]+$/g, ' ')
    .replaceAll(/[()[\]]\s*[()[\]]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !noiseWords.has(word.toLowerCase()))
    .join(' ')
    .replace(/^[\s\-–_.,:;]+|[\s\-–_.,:;([]+$/g, '')
    .trim()
}

const hasLetters = (text: string) => /[\p{L}]{2,}/u.test(text)

const isGeneric = (segment: string) =>
  /^[a-z]:$/i.test(segment) || genericSegments.has(segment.toLowerCase())

export const titlesFor = (folderPath: string, limit = 3): ReadonlyArray<string> => {
  const segments = folderPath.split(/[\\/]+/).filter((segment) => segment !== '')
  const titles: Array<string> = []

  for (const segment of segments.toReversed()) {
    if (isGeneric(segment) || titles.length >= limit) {
      break
    }

    const title = cleanTitle(segment)

    if (hasLetters(title) && !titles.some((seen) => seen.toLowerCase() === title.toLowerCase())) {
      titles.push(title)
    }
  }

  return titles
}

export const pathNames = (folderPath: string): ReadonlyArray<string> =>
  folderPath
    .split(/[\\/]+/)
    .filter((segment) => segment !== '')
    .toReversed()

export const codeInInput = (input: string): Option.Option<string> =>
  Option.map(Option.fromNullishOr(codesIn(input.trim())[0]), (found) => found.code)

const shortcutTarget = /^URL=(.*)$/im

export const shortcutUrl = (text: string) =>
  Option.fromNullishOr(shortcutTarget.exec(text)?.[1]?.trim())
