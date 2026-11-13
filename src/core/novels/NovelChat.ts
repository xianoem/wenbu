import { Effect, Predicate, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import type {
  FlagFinding,
  GlossaryTerm,
  NovelAnswer,
  NovelCharacter,
  NovelInsight,
} from '#contract/Novels'
import type { ContentFlag } from './NovelDigests'
import type { StoredDigest, TextHit } from './NovelInsightStore'

export interface BookChapter {
  readonly number: number
  readonly title: string
  readonly titleTranslated: string | null
}

export interface NovelBook {
  readonly title: string
  readonly originalTitle: string
  readonly ongoing: boolean
  readonly chapters: ReadonlyArray<BookChapter>
  readonly digests: ReadonlyArray<StoredDigest>
  readonly terms: ReadonlyArray<GlossaryTerm>
  readonly flags: ReadonlyArray<ContentFlag>
  readonly fetched: number
  readonly readingChapter: number | null
  readonly search: (
    words: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<TextHit & { readonly translation: string | null }>>
}

const MAX_DIGESTS = 40

const MAX_HITS = 30

const MAX_MENTIONS = 40

export const knownUpTo = (
  chapters: ReadonlyArray<{ readonly number: number }>,
  digests: ReadonlyArray<StoredDigest>,
) => {
  const made = new Set(digests.map((digest) => digest.number))
  let last = 0

  for (const chapter of chapters) {
    if (!made.has(chapter.number)) {
      break
    }

    last = chapter.number
  }

  return last
}

export const coverageOf = (book: NovelBook) => {
  const total = book.chapters.length
  const known = knownUpTo(book.chapters, book.digests)
  const ongoing = book.ongoing ? ' (the novel is ongoing)' : ''

  if (book.digests.length === 0) {
    return `No chapter digests yet; searched the text of ${book.fetched} of ${total} chapters${ongoing}.`
  }

  if (known === book.chapters.at(-1)?.number) {
    return `Checked all ${total} chapters${ongoing}.`
  }

  if (known > 0 && book.digests.length === book.chapters.findIndex((c) => c.number === known) + 1) {
    return `Checked chapters 1 to ${known} of ${total}${ongoing}.`
  }

  return `Checked ${book.digests.length} of ${total} chapters${ongoing}.`
}

export const flagFindings = (
  flags: ReadonlyArray<ContentFlag>,
  digests: ReadonlyArray<StoredDigest>,
): ReadonlyArray<FlagFinding> =>
  flags.map((flag) => {
    const found = digests.flatMap((digest) =>
      digest.flags
        .filter((entry) => entry.id === flag.id)
        .map((entry) => ({ number: digest.number, note: entry.note })),
    )

    return {
      id: flag.id,
      label: flag.label,
      chapters: [...new Set(found.map((entry) => entry.number))],
      note: found[0]?.note ?? null,
    }
  })

export const charactersOf = (
  terms: ReadonlyArray<GlossaryTerm>,
  digests: ReadonlyArray<StoredDigest>,
  readingChapter: number | null,
): ReadonlyArray<NovelCharacter> => {
  const visible = digests.filter(
    (digest) => readingChapter === null || digest.number <= readingChapter,
  )

  return terms
    .filter((term) => term.kind === 'character' && !term.suggested)
    .map((term) => {
      const present = visible.filter((digest) => digest.characters.includes(term.original))

      const seen = [
        ...term.chapters,
        ...digests
          .filter((digest) => digest.characters.includes(term.original))
          .map((digest) => digest.number),
      ]

      return {
        original: term.original,
        translation: term.translation,
        gender: term.gender,
        note: term.note,
        firstChapter: seen.length === 0 ? null : Math.min(...seen),
        mentions: present.length,
      }
    })
    .filter(
      (character) =>
        readingChapter === null ||
        character.firstChapter === null ||
        character.firstChapter <= readingChapter,
    )
    .toSorted((a, b) => b.mentions - a.mentions || a.translation.localeCompare(b.translation))
}

export const insightOf = (
  book: NovelBook,
  readable: number,
  answers: ReadonlyArray<NovelAnswer>,
): NovelInsight => ({
  chapters: book.chapters.length,
  digested: book.digests.length,
  knownUpTo: knownUpTo(book.chapters, book.digests),
  readable,
  readingChapter: book.readingChapter,
  ongoing: book.ongoing,
  flags: flagFindings(book.flags, book.digests),
  characters: charactersOf(book.terms, book.digests, book.readingChapter),
  answers,
  digestCostUsd: book.digests.reduce((sum, digest) => sum + (digest.cost_usd ?? 0), 0),
})

const CITATION = /\s*\[((?:ch\.?\s*\d+\s*[,，;]?\s*)+)\]/gi

export const citationsOf = (text: string, chapters: ReadonlyArray<{ readonly number: number }>) => {
  const valid = new Set(chapters.map((chapter) => chapter.number))

  const cited = [...text.matchAll(CITATION)].flatMap((match) =>
    [...(match[1] ?? '').matchAll(/\d+/g)].map((number) => Number(number[0])),
  )

  return {
    chapters: [...new Set(cited)].filter((number) => valid.has(number)).toSorted((a, b) => a - b),
    text: text.replace(CITATION, '').trim(),
  }
}

export const chatPrompt = (
  book: NovelBook,
  targetLanguage: string,
  spoilers: boolean,
  kind: NovelAnswer['kind'],
) => {
  const reading =
    book.readingChapter === null
      ? 'The reader has not started reading yet.'
      : `The reader is at chapter ${book.readingChapter}.`

  const spoilerRule = spoilers
    ? 'Spoilers are allowed: answer about any chapter.'
    : `Plot questions are answered without spoilers: say nothing that happens after chapter ${book.readingChapter ?? 0}, and say so when the answer lies further on. Content questions ("is there NTR?", "does the heroine die?") are asked to avoid content, so answer them directly: yes or no, roughly where, and how central it is, without plot details unless asked.`

  return [
    `You talk with a reader of the novel "${book.title}" (${book.originalTitle}) about the novel. Answer in ${targetLanguage}, briefly and directly.`,
    'Everything you say about the novel must come from the tools: chapter digests, the chapter text and the glossary. Never use what you may remember about the novel. If the tools do not show something, say that it was not found in the chapters checked; never claim that it is absent from the novel.',
    'The text is in its original language. Search it with words in that language, such as names as the glossary writes them, and try several words.',
    'After a sentence that relies on a chapter, cite it in square brackets like [ch12] or [ch3, ch40].',
    'Write plain text: short paragraphs, and lines starting with "- " for lists. No headings, tables or bold.',
    '',
    reading,
    spoilerRule,
    `What the tools can see: ${coverageOf(book)}`,
    ...(kind === 'recap'
      ? [
          '',
          `The reader is coming back to the novel. Write a "previously" recap of 120 to 200 words of the story up to chapter ${book.readingChapter ?? 0}, weighted to the last few chapters, naming the characters as the glossary translates them. Nothing after that chapter.`,
        ]
      : []),
  ].join('\n')
}

const OptionalParameter = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema))

const WordsParameter = Schema.Union([Schema.Array(Schema.String), Schema.String])

const ChapterNumber = Schema.Union([Schema.Number, Schema.NumberFromString])

const failureMode = 'return' as const

const Lines = Schema.Array(Schema.String)

const Coverage = Tool.make('coverage', {
  failureMode,
  description:
    'The novel, how many chapters it has, which ones have digests and text, where the reader is, and its main characters.',
  success: Schema.Struct({ about: Lines, characters: Lines }),
})

const ChapterDigests = Tool.make('chapter_digests', {
  failureMode,
  description: `Digests of a range of chapters, at most ${MAX_DIGESTS} at a time: what happens, who is present and any content flags.`,
  parameters: Schema.Struct({ from: ChapterNumber, to: OptionalParameter(ChapterNumber) }),
  success: Lines,
})

const SearchText = Tool.make('search_text', {
  failureMode,
  description:
    "Paragraphs of the novel's original text that contain any of the words, in chapter order, with their translation when there is one. Search in the original language; give several words at once.",
  parameters: Schema.Struct({ words: WordsParameter }),
  success: Lines,
})

const Character = Tool.make('character', {
  failureMode,
  description:
    'A character by name, in the original or translated: the glossary entry, the chapters whose digests mention them, and those digests.',
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({
    glossary: Lines,
    chapters: Schema.Array(Schema.Number),
    digests: Lines,
  }),
})

const ContentFlags = Tool.make('content_flags', {
  failureMode,
  description:
    'The content flags checked in every digest, such as NTR or a love interest dying, with the chapters each was found in.',
  success: Lines,
})

export const NovelToolkit = Toolkit.make(
  Coverage,
  ChapterDigests,
  SearchText,
  Character,
  ContentFlags,
)

export const novelToolLabels: Record<string, string> = {
  coverage: 'Checking what Wenbu has read',
  chapter_digests: 'Reading chapter digests',
  search_text: 'Searching the text',
  character: 'Looking up a character',
  content_flags: 'Checking content flags',
}

const wordsOf = (words: ReadonlyArray<string> | string) =>
  (Predicate.isString(words) ? words.split(/[,，、]/) : words)
    .map((word) => word.trim())
    .filter((word) => word !== '')

const digestLine = (book: NovelBook, digest: StoredDigest) => {
  const chapter = book.chapters.find((entry) => entry.number === digest.number)
  const title = chapter?.titleTranslated ?? chapter?.title ?? ''
  const flags = digest.flags.map((flag) => `${flag.id} (${flag.note})`).join(', ')

  return [
    `ch${digest.number} ${title}: ${digest.summary}`,
    digest.characters.length === 0 ? '' : ` Present: ${digest.characters.join(', ')}.`,
    flags === '' ? '' : ` Flags: ${flags}.`,
  ].join('')
}

const termLine = (term: GlossaryTerm) =>
  [
    `${term.original} = ${term.translation}`,
    term.gender === null ? '' : ` (${term.gender === 'm' ? 'male' : 'female'})`,
    term.note === null ? '' : `: ${term.note}`,
  ].join('')

export const novelHandlers = (book: NovelBook) =>
  NovelToolkit.toLayer({
    coverage: () =>
      Effect.sync(() => ({
        about: [
          `${book.title} (${book.originalTitle}), ${book.chapters.length} chapters, ${book.ongoing ? 'ongoing' : 'finished'}.`,
          coverageOf(book),
          book.readingChapter === null
            ? 'The reader has not started.'
            : `The reader is at chapter ${book.readingChapter}.`,
        ],
        characters: charactersOf(book.terms, book.digests, null)
          .slice(0, 20)
          .map((character) => `${character.original} = ${character.translation}`),
      })),
    chapter_digests: ({ from, to }) =>
      Effect.sync(() => {
        const last = Math.min(to ?? from + MAX_DIGESTS - 1, from + MAX_DIGESTS - 1)

        const found = book.digests.filter(
          (digest) => digest.number >= from && digest.number <= last,
        )

        return found.length === 0
          ? [`No digests for chapters ${from} to ${last}. ${coverageOf(book)}`]
          : found.map((digest) => digestLine(book, digest))
      }),
    search_text: ({ words }) =>
      Effect.map(book.search(wordsOf(words)), (hits) =>
        hits.length === 0
          ? [`Not found in the text of the ${book.fetched} chapters Wenbu has.`]
          : hits
              .slice(0, MAX_HITS)
              .map(
                (hit) =>
                  `ch${hit.number} ¶${hit.paragraph + 1}: ${hit.body}${hit.translation === null ? '' : ` | ${hit.translation}`}`,
              ),
      ),
    character: ({ name }) =>
      Effect.sync(() => {
        const needle = name.trim().toLowerCase()

        const terms = book.terms.filter(
          (term) =>
            term.original.includes(name.trim()) || term.translation.toLowerCase().includes(needle),
        )

        const originals = new Set([...terms.map((term) => term.original), name.trim()])

        const present = book.digests.filter((digest) =>
          digest.characters.some((character) => originals.has(character)),
        )

        return {
          glossary: terms.map((term) => termLine(term)),
          chapters: present.map((digest) => digest.number),
          digests: present.slice(0, MAX_MENTIONS).map((digest) => digestLine(book, digest)),
        }
      }),
    content_flags: () =>
      Effect.sync(() => [
        coverageOf(book),
        ...flagFindings(book.flags, book.digests).map((flag) =>
          flag.chapters.length === 0
            ? `${flag.id} (${flag.label}): not found in the chapters checked`
            : `${flag.id} (${flag.label}): found in ch${flag.chapters.join(', ch')}; first: ${flag.note ?? ''}`,
        ),
      ]),
  })
