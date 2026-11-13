import type { HookConfidence } from '#contract/TranslationOverlay'

interface Script {
  readonly language: string
  readonly label: string
  readonly pattern: RegExp
}

const scripts: ReadonlyArray<Script> = [
  { language: 'japanese', label: 'Japanese', pattern: /[぀-ヿ㐀-鿿]/u },
  { language: 'korean', label: 'Korean', pattern: /[가-힯]/u },
  { language: 'chinese', label: 'Chinese', pattern: /[一-鿿]/u },
]

const looksLikePath = /[a-z]:\\|\/[a-z0-9_-]+\/|\.dll|\.exe/i

const looksLikeMemory = /0x[0-9a-f]{6,}|^[\d\s:;,[\]{}().-]+$/i

const isAscii = (text: string) => [...text].every((character) => character.charCodeAt(0) < 128)

export interface HookScore {
  readonly score: number
  readonly confidence: HookConfidence
  readonly reasons: ReadonlyArray<string>
  readonly signal: string
}

const confidenceOf = (score: number): HookConfidence => {
  if (score >= 55) {
    return 'High'
  }

  if (score >= 25) {
    return 'Medium'
  }

  return 'Low'
}

const signalOf = (script: Script | undefined, text: string) => {
  if (script === undefined) {
    return text === '' ? 'No text' : 'Text-like output'
  }

  if (script.pattern.test(text)) {
    return `${script.label} script detected`
  }

  return `No ${script.label} script`
}

export const scoreHook = (
  sourceLanguage: string,
  sample: string,
  updateCount: number,
): HookScore => {
  const text = sample.trim()
  const language = sourceLanguage.toLowerCase()
  const script = scripts.find((candidate) => language.includes(candidate.language))
  const signal = signalOf(script, text)
  const reasons: Array<string> = []
  let score = 0

  const add = (points: number, reason: string) => {
    score += points
    reasons.push(reason)
  }

  if (script?.pattern.test(text) === true) {
    add(45, signal)
  }

  if (text.length >= 8 && text.length <= 120) {
    add(20, 'Dialogue-like length')
  } else if (text.length > 120) {
    add(5, 'Long backlog-like sample')
  }

  if (/[。！？!?」』]/u.test(text)) {
    add(10, 'Dialogue punctuation')
  }

  if (updateCount >= 2 && updateCount <= 80) {
    add(10, 'Stable update rate')
  }

  if (text.length <= 2) {
    add(-35, 'Tiny fragment')
  }

  if (looksLikePath.test(text)) {
    add(-30, 'Path/debug-like output')
  }

  if (looksLikeMemory.test(text)) {
    add(-25, 'Memory-looking output')
  }

  if (script !== undefined && isAscii(text)) {
    add(-20, 'Pure ASCII for CJK source')
  }

  return {
    score,
    confidence: confidenceOf(score),
    reasons: reasons.length === 0 ? ['Observed hook output'] : reasons,
    signal,
  }
}
