import { builtInFlags } from '#contract/Novels'

export interface ContentFlag {
  readonly id: string
  readonly label: string
}

export interface DigestChapter {
  readonly number: number
  readonly title: string
  readonly paragraphs: ReadonlyArray<string>
}

export interface ParsedDigest {
  readonly number: number
  readonly summary: string
  readonly characters: ReadonlyArray<string>
  readonly flags: ReadonlyArray<{ readonly id: string; readonly note: string }>
}

export const DIGEST_BATCH = 10

const BATCH_CHARACTERS = 60_000

const CHAPTER_CHARACTERS = 9000

const flagHints: Record<string, string> = {
  betrayal: 'a romantic partner cheats on or betrays the protagonist or another couple',
  ntr: 'a love interest is taken by someone else (netorare)',
  harem: 'the protagonist gathers several romantic partners',
  'love-death': 'a love interest dies',
  'character-death': 'an important named character dies',
  gore: 'torture, mutilation or graphic gore',
  incest: 'romance or sex between relatives',
  'child-abuse': 'abuse of a child',
  'tragic-ending': 'the story ends tragically (only when this chapter is the ending)',
}

export const contentFlags = (custom: ReadonlyArray<string>): ReadonlyArray<ContentFlag> => [
  ...builtInFlags,
  ...custom
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .map((label) => ({ id: label, label })),
]

export const digestBatches = (chapters: ReadonlyArray<DigestChapter>) => {
  const batches: Array<Array<DigestChapter>> = []
  let size = 0

  for (const chapter of chapters) {
    const length = Math.min(CHAPTER_CHARACTERS, chapter.paragraphs.join('').length)
    const last = batches.at(-1)

    if (last === undefined || last.length >= DIGEST_BATCH || size + length > BATCH_CHARACTERS) {
      batches.push([chapter])
      size = length
    } else {
      last.push(chapter)
      size += length
    }
  }

  return batches
}

const clip = (paragraphs: ReadonlyArray<string>) => {
  const kept: Array<string> = []
  let length = 0

  for (const paragraph of paragraphs) {
    if (length + paragraph.length > CHAPTER_CHARACTERS) {
      kept.push('[…]')

      break
    }

    kept.push(paragraph)
    length += paragraph.length
  }

  return kept.join('\n')
}

export const digestPrompt = (
  chapters: ReadonlyArray<DigestChapter>,
  flags: ReadonlyArray<ContentFlag>,
  targetLanguage: string,
) =>
  [
    `Below are chapters of a novel. For each chapter, write a digest in ${targetLanguage} that a reader's assistant can later use to answer questions about the story.`,
    '',
    'Reply with these lines for every chapter, and nothing else:',
    '#<chapter number>',
    'S|<what happens: 60 to 120 words naming who does what, relationships, reveals, deaths and where it happens>',
    'C|<the characters present, by their names exactly as written in the original, separated by ;>',
    'F|<flag id>|<a few words on what happened>',
    '',
    'Write one F line for each flag below that the chapter shows or clearly states, and none otherwise. Be literal: a rumour or a threat is not the thing itself.',
    ...flags.map((flag) => `- ${flag.id}: ${flagHints[flag.id] ?? flag.label}`),
    '',
    ...chapters.flatMap((chapter) => [
      `=== Chapter ${chapter.number}: ${chapter.title}`,
      clip(chapter.paragraphs),
      '',
    ]),
  ].join('\n')

export const parseDigests = (
  reply: string,
  numbers: ReadonlyArray<number>,
  flags: ReadonlyArray<ContentFlag>,
): ReadonlyArray<ParsedDigest> => {
  const wanted = new Set(numbers)
  const known = new Map(flags.map((flag) => [flag.id.toLowerCase(), flag.id]))
  const digests = new Map<number, ParsedDigest>()
  let current: ParsedDigest | undefined

  const finish = () => {
    if (current !== undefined && current.summary !== '') {
      digests.set(current.number, current)
    }
  }

  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#+\s*(?:chapter\s*)?(\d+)/i.exec(line)

    if (heading !== null) {
      finish()

      const number = Number(heading[1])

      current = wanted.has(number) ? { number, summary: '', characters: [], flags: [] } : undefined

      continue
    }

    if (current === undefined) {
      continue
    }

    const [tag = '', ...rest] = line.split('|')
    const value = rest.join('|').trim()

    if (tag.trim().toUpperCase() === 'S') {
      current = { ...current, summary: value }
    }

    if (tag.trim().toUpperCase() === 'C') {
      current = {
        ...current,
        characters: value
          .split(/[;；,，、]/)
          .map((name) => name.trim())
          .filter((name) => name !== ''),
      }
    }

    const id = known.get((rest[0] ?? '').trim().toLowerCase())

    if (tag.trim().toUpperCase() === 'F' && id !== undefined) {
      current = {
        ...current,
        flags: [...current.flags, { id, note: rest.slice(1).join('|').trim() }],
      }
    }
  }

  finish()

  return [...digests.values()]
}
