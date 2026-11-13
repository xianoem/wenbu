import type { NovelLanguage } from '#contract/Novels'
import { fold } from './GlossaryMatcher'

export interface TermCandidate {
  readonly text: string
  readonly count: number
  readonly chapters: ReadonlyArray<number>
  readonly contexts: ReadonlyArray<string>
}

const maxCandidates = 300

const han = /[㐀-鿿豈-﫿]+/g

const commonWords = new Set(
  [
    '他们',
    '她们',
    '我们',
    '你们',
    '什么',
    '一个',
    '自己',
    '没有',
    '已经',
    '这个',
    '那个',
    '不是',
    '就是',
    '可以',
    '知道',
    '时候',
    '起来',
    '出来',
    '一下',
    '一声',
    '之后',
    '之前',
    '现在',
    '如此',
    '这样',
    '那样',
    '然后',
    '但是',
    '因为',
    '所以',
    '只是',
    '还是',
    '一些',
    '这些',
    '那些',
    '怎么',
    '为什么',
    '的话',
    '不过',
    '一般',
    '一样',
    '东西',
    '事情',
    '地方',
    '这里',
    '那里',
    '哪里',
    '当然',
    '虽然',
    '如果',
    '只要',
    '于是',
    '一边',
    '一直',
    '一起',
    '不知',
    '不会',
    '不能',
    '不要',
    '这么',
    '那么',
    '似乎',
    '仿佛',
    '甚至',
    '终于',
  ].map(fold),
)

const functionEdge =
  /^[的了着是在和与也就都而又被把让给向从对]|[的了着是在和与也就都而又被把让给向从对地得]$/

const entropy = (neighbours: ReadonlyMap<string, number>) => {
  let total = 0

  for (const count of neighbours.values()) {
    total += count
  }

  let sum = 0

  for (const count of neighbours.values()) {
    const share = count / total

    sum -= share * Math.log(share)
  }

  return sum
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

const chineseCandidates = (chapters: ReadonlyArray<ReadonlyArray<string>>) => {
  const runs = chapters.flatMap((paragraphs) =>
    paragraphs.flatMap((paragraph) => fold(paragraph).match(han) ?? []),
  )

  const counts = new Map<string, number>()
  let total = 0

  for (const run of runs) {
    for (let start = 0; start < run.length; start++) {
      total += 1

      for (let size = 1; size <= 7 && start + size <= run.length; size++) {
        bump(counts, run.slice(start, start + size))
      }
    }
  }

  const minCount = Math.max(4, Math.ceil(chapters.length / 3))

  const cohesive = [...counts].filter(([text, count]) => {
    if (text.length < 2 || text.length > 6 || count < minCount) {
      return false
    }

    if (commonWords.has(text) || functionEdge.test(text)) {
      return false
    }

    let weakest = Number.POSITIVE_INFINITY
    let loosest = Number.POSITIVE_INFINITY

    for (let split = 1; split < text.length; split++) {
      const left = counts.get(text.slice(0, split)) ?? 1
      const right = counts.get(text.slice(split)) ?? 1

      weakest = Math.min(weakest, Math.log((count * total) / (left * right)))
      loosest = Math.min(loosest, count / Math.min(left, right))
    }

    return weakest >= 3 || loosest >= 0.9
  })

  const wanted = new Set(cohesive.map(([text]) => text))
  const lefts = new Map<string, Map<string, number>>()
  const rights = new Map<string, Map<string, number>>()

  for (const run of runs) {
    for (let start = 0; start < run.length; start++) {
      for (let size = 2; size <= 6 && start + size <= run.length; size++) {
        const text = run.slice(start, start + size)

        if (!wanted.has(text)) {
          continue
        }

        const left = start === 0 ? `^${start}:${lefts.get(text)?.size ?? 0}` : run.charAt(start - 1)

        const right =
          start + size === run.length ? `$${rights.get(text)?.size ?? 0}` : run.charAt(start + size)

        bump(lefts.get(text) ?? lefts.set(text, new Map()).get(text) ?? new Map(), left)
        bump(rights.get(text) ?? rights.set(text, new Map()).get(text) ?? new Map(), right)
      }
    }
  }

  const free = cohesive.filter(
    ([text]) =>
      entropy(lefts.get(text) ?? new Map()) >= 1.2 && entropy(rights.get(text) ?? new Map()) >= 1.2,
  )

  return free
    .filter(
      ([text, count]) =>
        !free.some(
          ([longer, longerCount]) =>
            longer.length > text.length && longer.includes(text) && longerCount >= count * 0.9,
        ),
    )
    .map(([text, count]) => ({ text, count }))
}

const katakana = /[ァ-ヺー]{2,}/g

const kanjiRun = /[一-龯々]{2,4}/g

const japaneseCandidates = (chapters: ReadonlyArray<ReadonlyArray<string>>) => {
  const counts = new Map<string, number>()

  for (const paragraph of chapters.flat()) {
    for (const match of paragraph.match(katakana) ?? []) {
      if (match.replaceAll('ー', '').length >= 2) {
        bump(counts, match)
      }
    }

    for (const match of paragraph.match(kanjiRun) ?? []) {
      bump(counts, match)
    }
  }

  return [...counts].filter(([, count]) => count >= 3).map(([text, count]) => ({ text, count }))
}

const particles = [
  '에게서',
  '으로서',
  '에서',
  '에게',
  '으로',
  '까지',
  '부터',
  '처럼',
  '보다',
  '한테',
  '이라',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '와',
  '과',
  '도',
  '만',
  '로',
  '에',
  '께',
  '야',
  '아',
]

const verbEnding = /[다요고며서네지게]$/

const koreanCandidates = (chapters: ReadonlyArray<ReadonlyArray<string>>) => {
  const counts = new Map<string, number>()
  const endings = new Map<string, Set<string>>()

  for (const paragraph of chapters.flat()) {
    for (const word of paragraph.split(/[^가-힯]+/)) {
      const particle = particles.find(
        (ending) => word.endsWith(ending) && word.length - ending.length >= 2,
      )

      const stem = particle === undefined ? word : word.slice(0, -particle.length)

      if (stem.length < 2 || stem.length > 4 || verbEnding.test(stem)) {
        continue
      }

      bump(counts, stem)
      ;(endings.get(stem) ?? endings.set(stem, new Set()).get(stem))?.add(particle ?? '')
    }
  }

  return [...counts]
    .filter(([, count]) => count >= 3)
    .map(([text, count]) => ({ text, count: count * (endings.get(text)?.size ?? 1) }))
}

const contextsOf = (
  text: string,
  paragraphs: ReadonlyArray<string>,
  folded: ReadonlyArray<string>,
) => {
  const contexts: Array<string> = []
  const needle = fold(text)

  for (const [index, paragraph] of folded.entries()) {
    const at = paragraph.indexOf(needle)

    if (at === -1) {
      continue
    }

    contexts.push((paragraphs[index] ?? '').slice(Math.max(0, at - 14), at + needle.length + 14))

    if (contexts.length === 3) {
      break
    }
  }

  return contexts
}

export const findCandidates = (
  language: NovelLanguage,
  chapters: ReadonlyArray<ReadonlyArray<string>>,
  known: ReadonlyArray<string> = [],
): ReadonlyArray<TermCandidate> => {
  const found = (() => {
    if (language === 'ja') {
      return japaneseCandidates(chapters)
    }

    return language === 'ko' ? koreanCandidates(chapters) : chineseCandidates(chapters)
  })()

  const knownFolded = new Set(known.map(fold))
  const foldedChapters = chapters.map((paragraphs) => paragraphs.map(fold))
  const paragraphs = chapters.flat()
  const foldedParagraphs = foldedChapters.flat()

  return found
    .filter((candidate) => !knownFolded.has(fold(candidate.text)))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, maxCandidates)
    .map((candidate) => {
      const needle = fold(candidate.text)

      const index = foldedParagraphs.findIndex((paragraph) => paragraph.includes(needle))
      const at = foldedParagraphs[index]?.indexOf(needle) ?? -1

      const shown =
        at === -1 ? candidate.text : (paragraphs[index] ?? '').slice(at, at + candidate.text.length)

      return {
        text: shown,
        count: candidate.count,
        chapters: foldedChapters.flatMap((chapter, number) =>
          chapter.some((paragraph) => paragraph.includes(needle)) ? [number + 1] : [],
        ),
        contexts: contextsOf(candidate.text, paragraphs, foldedParagraphs),
      }
    })
}
