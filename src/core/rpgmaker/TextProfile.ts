import { Predicate } from 'effect'
import type { TextProfile } from '#contract/Library'
import type { TextLocation } from './TextLocations'

const visibleText = (text: string) =>
  text.replace(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\./g, '').replace(/\s+/g, '')

const readingSpeed: Record<string, number> = {
  Japanese: 500,
  Chinese: 500,
  Korean: 600,
  English: 1000,
}

const languageOf = (text: string) => {
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0
  const kana = count(/[぀-ヿ]/g)
  const han = count(/[㐀-鿿]/g)
  const hangul = count(/[가-힯]/g)
  const latin = count(/[A-Za-z]/g)
  const cjk = kana + han + hangul

  if (cjk < latin) {
    return 'English'
  }

  if (hangul >= kana + han) {
    return 'Korean'
  }

  return kana >= han * 0.05 ? 'Japanese' : 'Chinese'
}

export const textProfile = (locations: ReadonlyArray<TextLocation>): TextProfile | undefined => {
  const dialogue = locations
    .filter((location) => location.dialogue === true)
    .map((location) => (Predicate.isString(location.value) ? visibleText(location.value) : ''))
    .join('')

  if (dialogue === '') {
    return undefined
  }

  const language = languageOf(dialogue)
  const characters = [...dialogue].length

  return {
    language,
    dialogueCharacters: characters,
    readingMinutes: Math.max(1, Math.round(characters / (readingSpeed[language] ?? 1000))),
  }
}
