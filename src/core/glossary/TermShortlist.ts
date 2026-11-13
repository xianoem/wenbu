import { Effect, Schema } from 'effect'
import { TermKind } from '#contract/Novels'
import type { TermCandidate } from './TermScan'

export interface Verdict {
  readonly translation: string
  readonly kind: TermKind
  readonly gender: 'm' | 'f' | null
  readonly reading: string | null
}

export interface CheckedTerm extends Verdict {
  readonly candidate: TermCandidate
}

const isTermKind = Schema.is(TermKind)

export const shortlistPrompt = (candidates: ReadonlyArray<TermCandidate>, targetLanguage: string) =>
  [
    `These strings repeat often in a web novel. Decide which are names or terms a ${targetLanguage} reader would want translated the same way every time: people, places, sects, techniques, items, ranks and other coined terms.`,
    'Drop ordinary words, phrases and fragments of sentences.',
    'Answer one line per number: `number|keep|translation|kind|gender|reading` or `number|drop`.',
    'Kind is one of character, place, sect, technique, item, concept, other. Gender is m or f for characters, else -. Reading is how the original is read aloud: pinyin with tone marks, romaji or romanized Korean.',
    '',
    ...candidates.map(
      (candidate, index) =>
        `${index + 1}|${candidate.text}|${candidate.contexts.join(' / ').replaceAll('|', ' ')}`,
    ),
  ].join('\n')

export const parseVerdicts = (reply: string) => {
  const verdicts = new Map<number, Verdict>()

  for (const line of reply.split('\n')) {
    const match =
      /^\s*(\d+)\s*\|\s*keep\s*\|([^|]+)\|([^|]+)\|?\s*([mf-]?)\s*(?:\|([^|]*))?$/i.exec(line)

    if (match === null) {
      continue
    }

    const [, number = '', translation = '', kind = '', gender = '', reading = ''] = match
    const kindOf = kind.trim().toLowerCase()

    verdicts.set(Number(number), {
      translation: translation.trim(),
      kind: isTermKind(kindOf) ? kindOf : 'other',
      gender: gender === 'm' || gender === 'f' ? gender : null,
      reading: reading.trim() === '' ? null : reading.trim(),
    })
  }

  return verdicts
}

export const checkCandidates = Effect.fnUntraced(function* <E>(
  ask: (
    prompt: string,
  ) => Effect.Effect<{ readonly text: string; readonly costUsd: number | null }, E>,
  candidates: ReadonlyArray<TermCandidate>,
  targetLanguage: string,
  batchSize = 100,
  onBatch: (checked: number) => Effect.Effect<void> = () => Effect.void,
) {
  const terms: Array<CheckedTerm> = []
  let costUsd = 0

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize)
    const reply = yield* ask(shortlistPrompt(batch, targetLanguage))

    costUsd += reply.costUsd ?? 0

    for (const [number, verdict] of parseVerdicts(reply.text)) {
      const candidate = batch[number - 1]

      if (candidate !== undefined && verdict.translation !== '') {
        terms.push({ ...verdict, candidate })
      }
    }

    yield* onBatch(Math.min(candidates.length, start + batchSize))
  }

  return { terms, costUsd }
})
