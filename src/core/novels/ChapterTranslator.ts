import { Data, Effect, Option, Schema, Stream } from 'effect'
import { LanguageModel, type Response } from 'effect/ai'
import { type GlossaryTerm, type NovelLanguage, NovelsError, TermKind } from '#contract/Novels'
import { makeMatcher } from '../glossary/GlossaryMatcher'
import type { PresetModel } from '../llm/LlmClient'
import { estimateTokens } from '../translation/Batches'

export interface TranslateInput {
  readonly title: string
  readonly paragraphs: ReadonlyArray<string>
  readonly terms: ReadonlyArray<GlossaryTerm>
  readonly language: NovelLanguage
  readonly targetLanguage: string
}

interface FoundTerm {
  readonly original: string
  readonly translation: string
  readonly kind: TermKind
  readonly gender: 'm' | 'f' | null
}

export type TranslateEvent = Data.TaggedEnum<{
  Title: { readonly text: string }
  Paragraph: { readonly index: number; readonly text: string }
  NewTerm: FoundTerm
  Spent: { readonly costUsd: number }
}>

export const TranslateEvent = Data.taggedEnum<TranslateEvent>()

export type ReplyLine = Data.TaggedEnum<{
  Line: { readonly key: string; readonly text: string }
  Term: FoundTerm
}>

export const ReplyLine = Data.taggedEnum<ReplyLine>()

type Piece = ReplyLine | TranslateEvent

const chunkBudget = 1800

const languageNames: Record<NovelLanguage, string> = {
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
}

export const chunksOf = (paragraphs: ReadonlyArray<string>, budget: number) => {
  const chunks: Array<Array<number>> = []
  let current: Array<number> = []
  let tokens = 0

  for (const [index, paragraph] of paragraphs.entries()) {
    const cost = estimateTokens(paragraph)

    if (current.length > 0 && tokens + cost > budget) {
      chunks.push(current)
      current = []
      tokens = 0
    }

    current.push(index)
    tokens += cost
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

const isTermKind = Schema.is(TermKind)

export const parseLine = (line: string): Option.Option<ReplyLine> => {
  const term = /^\+\|([^|]+)\|([^|]+)\|([^|]+)\|?\s*([mf-]?)\s*$/.exec(line.trim())

  if (term !== null) {
    const [, original = '', translation = '', kind = '', gender = ''] = term
    const kindOf = kind.trim()

    return Option.some(
      ReplyLine.Term({
        original: original.trim(),
        translation: translation.trim(),
        kind: isTermKind(kindOf) ? kindOf : 'other',
        gender: gender === 'm' || gender === 'f' ? gender : null,
      }),
    )
  }

  const numbered = /^(\d+|T)\s*\|(.*)$/.exec(line.trim())
  const text = numbered?.[2]?.trim() ?? ''

  return numbered === null || text === ''
    ? Option.none()
    : Option.some(ReplyLine.Line({ key: numbered[1] ?? '', text }))
}

const termLine = (term: GlossaryTerm) =>
  `${term.original} → ${term.translation}${term.gender === null ? '' : ` (${term.gender})`}`

const systemPrompt = (input: TranslateInput) =>
  [
    `You translate ${languageNames[input.language]} web novels into natural, readable ${input.targetLanguage}.`,
    'Keep the tone, the voices of the characters and the story’s world. Restructure sentences when the literal order reads badly.',
    'Write narration in the past tense. Translate titles and forms of address into their meaning, such as “Senior Brother”.',
    'Follow the glossary exactly: write each term the way it gives, and use the gender it marks with (m) or (f).',
    'Answer with the same numbered lines, one per line, as `number|translation`, and nothing else. Line T is the chapter title.',
    'After the last line, list names and terms that are not in the glossary and that a reader would want kept consistent, as `+|original|translation|kind|gender`, where kind is one of character, place, sect, technique, item, concept or other, and gender is m, f or -.',
  ].join('\n')

const userPrompt = (
  lines: ReadonlyArray<readonly [string, string]>,
  terms: ReadonlyArray<GlossaryTerm>,
  strict: boolean,
) =>
  [
    terms.length === 0 ? '' : `Glossary (use exactly):\n${terms.map(termLine).join('\n')}`,
    strict
      ? 'These lines were left out or missed a glossary term before. You must use every glossary term exactly as written.'
      : '',
    lines.map(([key, text]) => `${key}|${text}`).join('\n'),
  ]
    .filter((part) => part !== '')
    .join('\n\n')

const followsGlossary = (translated: string, terms: ReadonlyArray<GlossaryTerm>) =>
  terms.every((term) => translated.toLowerCase().includes(term.translation.toLowerCase()))

const linesOf = (text: string) =>
  text.split('\n').flatMap((line) => Option.toArray(parseLine(line)))

export const translateChapter = (
  model: PresetModel,
  input: TranslateInput,
): Stream.Stream<TranslateEvent, NovelsError> => {
  const matcher = makeMatcher(
    input.terms.map((term) => ({ id: term.id, patterns: [term.original] })),
  )

  const termsById = new Map(input.terms.map((term) => [term.id, term]))

  const termsIn = (text: string) => [
    ...new Set(
      matcher
        .find(text)
        .flatMap((match) => Option.toArray(Option.fromNullishOr(termsById.get(match.id)))),
    ),
  ]

  const spend = (usage: Response.FinishPart['usage']) =>
    Effect.map(
      model.spend(
        {
          inputTokens: usage.inputTokens.total ?? 0,
          outputTokens: usage.outputTokens.total ?? 0,
        },
        usage.inputTokens.cacheRead ?? 0,
      ),
      (cost) => TranslateEvent.Spent({ costUsd: cost ?? 0 }),
    )

  const ask = (lines: ReadonlyArray<readonly [string, string]>, strict: boolean) => {
    const terms = termsIn(lines.map(([, text]) => text).join('\n'))
    let pending = ''

    const prompt = [
      { role: 'system' as const, content: systemPrompt(input) },
      { role: 'user' as const, content: userPrompt(lines, terms, strict) },
    ]

    return LanguageModel.streamText({ prompt }).pipe(
      Stream.provide(model.layer),
      Stream.mapError((error) => new NovelsError({ reason: 'llm', message: error.message })),
      Stream.mapEffect((part): Effect.Effect<ReadonlyArray<Piece>> => {
        if (part.type === 'text-delta') {
          const text = pending + part.delta
          const end = text.lastIndexOf('\n')

          pending = text.slice(end + 1)

          return Effect.succeed(end === -1 ? [] : linesOf(text.slice(0, end)))
        }

        if (part.type === 'finish') {
          const last = linesOf(pending)

          pending = ''

          return Effect.map(spend(part.usage), (spent) => [...last, spent])
        }

        return Effect.succeed([])
      }),
      Stream.flatMap((pieces) => Stream.fromIterable(pieces)),
      Stream.timeout('3 minutes'),
    )
  }

  const translateChunk = (indices: ReadonlyArray<number>, first: boolean) =>
    Stream.unwrap(
      Effect.sync(() => {
        const keyed = indices.map((index, position) => [String(position + 1), index] as const)
        const indexOf = new Map(keyed)
        const done = new Map<number, string>()

        const toEvents = (piece: Piece): ReadonlyArray<TranslateEvent> => {
          if (ReplyLine.$is('Term')(piece)) {
            return [TranslateEvent.NewTerm(piece)]
          }

          if (!ReplyLine.$is('Line')(piece)) {
            return [piece]
          }

          if (piece.key === 'T') {
            return first ? [TranslateEvent.Title({ text: piece.text })] : []
          }

          const index = indexOf.get(piece.key)

          if (index === undefined) {
            return []
          }

          done.set(index, piece.text)

          return [TranslateEvent.Paragraph({ index, text: piece.text })]
        }

        const retry = Stream.unwrap(
          Effect.sync(() => {
            const again = keyed.filter(([, index]) => {
              const text = done.get(index)

              return (
                text === undefined || !followsGlossary(text, termsIn(input.paragraphs[index] ?? ''))
              )
            })

            if (again.length === 0) {
              return Stream.empty
            }

            return ask(
              again.map(([key, index]) => [key, input.paragraphs[index] ?? ''] as const),
              true,
            ).pipe(Stream.flatMap((piece) => Stream.fromIterable(toEvents(piece))))
          }),
        )

        const lines: ReadonlyArray<readonly [string, string]> = [
          ...(first ? [['T', input.title] as const] : []),
          ...keyed.map(([key, index]) => [key, input.paragraphs[index] ?? ''] as const),
        ]

        return ask(lines, false).pipe(
          Stream.flatMap((piece) => Stream.fromIterable(toEvents(piece))),
          Stream.concat(retry),
        )
      }),
    )

  return Stream.fromIterable(chunksOf(input.paragraphs, chunkBudget).entries()).pipe(
    Stream.flatMap(([position, indices]) => translateChunk(indices, position === 0), {
      concurrency: 1,
    }),
  )
}
