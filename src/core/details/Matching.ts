import { Option } from 'effect'

export interface FolderHints {
  readonly titles: ReadonlyArray<string>
  readonly pathNames: ReadonlyArray<string>
  readonly releasedOn: Option.Option<string>
  readonly rpgMaker: boolean
}

export interface CandidateFacts {
  readonly titles: ReadonlyArray<string>
  readonly circle: string
  readonly releasedOn: Option.Option<string>
  readonly workType: string
  readonly genreIds: ReadonlyArray<number>
}

export interface Reason {
  readonly text: string
  readonly agrees: boolean
}

export interface Scored {
  readonly score: number
  readonly reasons: ReadonlyArray<Reason>
}

const rpgMakerGenre = 510

const katakanaToHiragana = (text: string) =>
  text.replaceAll(/[ァ-ヶ]/g, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) - 0x60),
  )

const withoutDecorations = (text: string) =>
  text.replaceAll(/【[^】]*】|〔[^〕]*〕|\[[^\]]*\]/g, ' ')

export const normalize = (text: string) =>
  katakanaToHiragana(withoutDecorations(text.normalize('NFKC')).toLowerCase()).replaceAll(
    /[^\p{L}\p{N}]+/gu,
    '',
  )

const bigrams = (text: string) => {
  const counts = new Map<string, number>()

  for (let index = 0; index < text.length - 1; index++) {
    const pair = text.slice(index, index + 2)

    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }

  return counts
}

const dice = (a: string, b: string) => {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0
  }

  const left = bigrams(a)
  const right = bigrams(b)
  let shared = 0

  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0)
  }

  return (2 * shared) / (a.length - 1 + (b.length - 1))
}

export const similarity = (a: string, b: string) => {
  const left = normalize(a)
  const right = normalize(b)

  if (left === '' || right === '') {
    return 0
  }

  if (left === right) {
    return 1
  }

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]

  const contained =
    shorter.length >= 4 && longer.includes(shorter)
      ? 0.8 + 0.2 * (shorter.length / longer.length)
      : 0

  return Math.max(dice(left, right), contained)
}

const bestTitle = (hints: FolderHints, candidate: CandidateFacts) =>
  Math.max(
    0,
    ...hints.titles.flatMap((mine) => candidate.titles.map((theirs) => similarity(mine, theirs))),
  )

const circleInPath = (hints: FolderHints, circle: string) => {
  const wanted = normalize(circle)

  return wanted.length >= 3 && hints.pathNames.some((name) => normalize(name).includes(wanted))
}

export const scoreCandidate = (hints: FolderHints, candidate: CandidateFacts): Scored => {
  const title = bestTitle(hints, candidate)

  const reasons: Array<Reason> = [
    { text: `Title ${Math.round(title * 100)}% similar`, agrees: title >= 0.75 },
  ]

  let bonus = 0

  if (circleInPath(hints, candidate.circle)) {
    bonus += 6
    reasons.push({ text: 'Circle in the folder path', agrees: true })
  }

  if (Option.isSome(hints.releasedOn) && Option.isSome(candidate.releasedOn)) {
    const same = hints.releasedOn.value === candidate.releasedOn.value

    bonus += same ? 8 : -10

    reasons.push({
      text: same ? "Released on the folder's date" : "Not released on the folder's date",
      agrees: same,
    })
  }

  if (hints.rpgMaker) {
    const madeWith = candidate.genreIds.includes(rpgMakerGenre) || candidate.workType === 'RPG'

    bonus += madeWith ? 3 : 0

    reasons.push({
      text: madeWith ? 'RPG Maker game' : 'Not listed as RPG Maker',
      agrees: madeWith,
    })
  }

  const score = Math.round(title * 100) + (title >= 0.5 ? bonus : 0)

  return { score: Math.max(0, Math.min(99, score)), reasons }
}

const autoLinkScore = 90

const autoLinkLead = 15

export const confidentPick = <A extends { readonly score: number }>(
  ranked: ReadonlyArray<A>,
): Option.Option<A> => {
  const [first, second] = ranked.toSorted((a, b) => b.score - a.score)

  if (first === undefined || first.score < autoLinkScore) {
    return Option.none()
  }

  return second !== undefined && first.score - second.score < autoLinkLead
    ? Option.none()
    : Option.some(first)
}
