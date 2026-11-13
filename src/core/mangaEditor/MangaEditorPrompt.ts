import { Option, Predicate, Schema } from 'effect'
import { type BlockKind, passageSeparator } from '#contract/MangaEditor'

export interface PromptLine {
  readonly kind: BlockKind
  readonly parts: ReadonlyArray<string>
}

export interface ContextLine {
  readonly source: string
  readonly translation: string
}

const notesBlock = (notes: string) =>
  notes.trim() === ''
    ? ''
    : `\nWhat the translator wants you to know about this series:\n${notes.trim()}\n`

export const systemPrompt = (
  language: string,
  notes: string,
) => `You translate Japanese manga into natural, native-level ${language} for a published release.
${notesBlock(notes)}
For each numbered line, give the Hepburn romaji of the Japanese and the ${language} translation.

- The lines are one page in reading order. Keep each speaker's voice and the scene's tone.
- Write what a native ${language} speaker would say in that moment, not a word-for-word rendering.
- A line may run across several speech bubbles, marked with |. Keep exactly as many | in the translation and the romaji, splitting where the bubbles split.
- [sfx] lines are sound effects: give a short ${language} sound effect in capitals.
- Keep names as they are. Translate only what is written; add no notes.

Reply with JSON only, in this shape:
{"lines": [{"n": 1, "romaji": "…", "translation": "…"}]}`

const numbered = (lines: ReadonlyArray<PromptLine>) =>
  lines
    .map((line, index) => `${index + 1}. [${line.kind}] ${line.parts.join(passageSeparator)}`)
    .join('\n')

const contextBlock = (context: ReadonlyArray<ContextLine>) =>
  context.length === 0
    ? ''
    : `Earlier in this chapter, for context only:\n${context
        .map((line) => `${line.source} → ${line.translation}`)
        .join('\n')}\n\n`

export const linesPrompt = (
  lines: ReadonlyArray<PromptLine>,
  context: ReadonlyArray<ContextLine>,
) => `${contextBlock(context)}Translate these lines:\n${numbered(lines)}`

export const alternativesPrompt = (
  lines: ReadonlyArray<PromptLine>,
  index: number,
  current: string,
) => `This page, in reading order:
${numbered(lines)}

The current translation of line ${index + 1} is: ${current}

Give three different natural translations of line ${index + 1}, each with the same number of | as the line.
Reply with JSON only: {"alternatives": ["…", "…", "…"]}`

export const chatContext = (
  lines: ReadonlyArray<PromptLine>,
  translations: ReadonlyArray<string>,
  attached: number | undefined,
) => `This page, in reading order (Japanese → current translation):
${lines
  .map(
    (line, index) =>
      `${index + 1}. [${line.kind}] ${line.parts.join(passageSeparator)} → ${translations[index] || '(not translated)'}`,
  )
  .join('\n')}${attached === undefined ? '' : `\n\nThe user is asking about line ${attached + 1}.`}`

export const chatSystemPrompt = (
  language: string,
  notes: string,
) => `You help a translator turn Japanese manga into natural, native-level ${language}.
Talk with them about the page: meaning, tone, who is speaking, wordplay, and better ways to say a line.
${notesBlock(notes)}
Reply with JSON only: {"reply": "…", "suggestion": {"line": 1, "translation": "…"} or null}
- "reply" is your answer, short and plain.
- Give a suggestion only when the user wants a new translation or your answer clearly calls for one. Keep as many | as the line has.`

const LinesReply = Schema.Struct({
  lines: Schema.Array(
    Schema.Struct({ n: Schema.Int, romaji: Schema.String, translation: Schema.String }),
  ),
})

const AlternativesReply = Schema.Struct({ alternatives: Schema.Array(Schema.String) })

const ChatJson = Schema.Struct({
  reply: Schema.String,
  suggestion: Schema.optional(
    Schema.NullOr(Schema.Struct({ line: Schema.Int, translation: Schema.String })),
  ),
})

const jsonOf = (reply: string) => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')

  return start === -1 || end < start ? '' : reply.slice(start, end + 1)
}

const decodeLines = Schema.decodeUnknownOption(Schema.fromJsonString(LinesReply))

const decodeAlternatives = Schema.decodeUnknownOption(Schema.fromJsonString(AlternativesReply))

const decodeChat = Schema.decodeUnknownOption(Schema.fromJsonString(ChatJson))

const kindTag = /^\s*\[(?:dialogue|thought|narration|sfx|sign)\]\s*/i

export const splitParts = (text: string) =>
  text
    .replace(kindTag, '')
    .split(passageSeparator)
    .map((part) => part.trim())

const partsCount = (text: string) => text.split(passageSeparator).length

export interface LineReply {
  readonly romaji: ReadonlyArray<string>
  readonly translation: ReadonlyArray<string>
}

export const parseLines = (
  reply: string,
  lines: ReadonlyArray<PromptLine>,
): Option.Option<ReadonlyArray<LineReply>> =>
  Option.flatMap(decodeLines(jsonOf(reply)), ({ lines: answered }) => {
    const byNumber = new Map(answered.map((line) => [line.n, line]))
    const parsed: Array<LineReply> = []

    for (const [index, line] of lines.entries()) {
      const answer = byNumber.get(index + 1)
      const count = line.parts.length

      if (answer === undefined || answer.translation.trim() === '') {
        return Option.none()
      }

      if (partsCount(answer.translation) !== count) {
        return Option.none()
      }

      const romaji =
        partsCount(answer.romaji) === count
          ? splitParts(answer.romaji)
          : [answer.romaji.trim(), ...Array.from({ length: count - 1 }, () => '')]

      parsed.push({ romaji, translation: splitParts(answer.translation) })
    }

    return Option.some(parsed)
  })

export const parseAlternatives = (
  reply: string,
  count: number,
): Option.Option<ReadonlyArray<string>> =>
  Option.flatMap(decodeAlternatives(jsonOf(reply)), ({ alternatives }) => {
    const usable = alternatives
      .map((alternative) => alternative.trim())
      .filter((alternative) => alternative !== '' && partsCount(alternative) === count)

    return usable.length === 0 ? Option.none() : Option.some(usable)
  })

export interface ChatAnswer {
  readonly text: string
  readonly suggestion?: { readonly index: number; readonly translation: string }
}

export const parseChat = (reply: string, counts: ReadonlyArray<number>): ChatAnswer =>
  Option.match(decodeChat(jsonOf(reply)), {
    onNone: () => ({ text: reply.trim() }),
    onSome: ({ reply: text, suggestion }) => {
      const index = suggestion === null || suggestion === undefined ? -1 : suggestion.line - 1
      const count = counts[index]

      const fits =
        Predicate.isNotNullish(suggestion) &&
        count !== undefined &&
        suggestion.translation.trim() !== '' &&
        partsCount(suggestion.translation) === count

      return fits
        ? { text: text.trim(), suggestion: { index, translation: suggestion.translation.trim() } }
        : { text: text.trim() }
    },
  })
