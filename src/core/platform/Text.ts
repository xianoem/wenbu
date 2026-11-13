import { Option } from 'effect'

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export const decodeEntities = (text: string) =>
  text.replaceAll(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    }

    if (code.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    }

    return entities[code.toLowerCase()] ?? whole
  })

export const nonEmpty = (value: string | null | undefined) =>
  Option.filter(Option.fromNullishOr(value?.trim()), (text) => text !== '')
