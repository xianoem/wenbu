import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import {
  alternativesPrompt,
  linesPrompt,
  parseAlternatives,
  parseChat,
  parseLines,
  type PromptLine,
  systemPrompt,
} from './MangaEditorPrompt'

const lines: ReadonlyArray<PromptLine> = [
  { kind: 'dialogue', parts: ['ねえ、聞いてる？'] },
  { kind: 'dialogue', parts: ['明日の試合…', '本当に出るの？'] },
  { kind: 'sfx', parts: ['ドキ'] },
]

describe('MangaEditorPrompt', () => {
  it('numbers the lines, marks bubbles with | and gives earlier lines as context', () => {
    const prompt = linesPrompt(lines, [{ source: 'おはよう', translation: 'Morning.' }])

    expect(prompt).toContain('1. [dialogue] ねえ、聞いてる？')
    expect(prompt).toContain('2. [dialogue] 明日の試合…|本当に出るの？')
    expect(prompt).toContain('3. [sfx] ドキ')
    expect(prompt).toContain('おはよう → Morning.')
  })

  it('reads a JSON reply, even inside a code fence, and splits passages at |', () => {
    const reply = [
      'Here you go:',
      '```json',
      JSON.stringify({
        lines: [
          { n: 1, romaji: 'Nee, kiiteru?', translation: 'Hey, are you listening?' },
          {
            n: 2,
            romaji: 'Ashita no shiai… | hontō ni deru no?',
            translation: "About tomorrow's match… | you're really playing?",
          },
          { n: 3, romaji: 'Doki', translation: 'BA-DUMP' },
        ],
      }),
      '```',
    ].join('\n')

    expect(parseLines(reply, lines)).toEqual(
      Option.some([
        { romaji: ['Nee, kiiteru?'], translation: ['Hey, are you listening?'] },
        {
          romaji: ['Ashita no shiai…', 'hontō ni deru no?'],
          translation: ["About tomorrow's match…", "you're really playing?"],
        },
        { romaji: ['Doki'], translation: ['BA-DUMP'] },
      ]),
    )
  })

  it('drops a kind tag the model copied from the prompt', () => {
    const reply = JSON.stringify({
      lines: [{ n: 1, romaji: '[sfx] Doki', translation: '[sfx] THUMP' }],
    })

    expect(parseLines(reply, [{ kind: 'sfx', parts: ['ドキ'] }])).toEqual(
      Option.some([{ romaji: ['Doki'], translation: ['THUMP'] }]),
    )
  })

  it('rejects a reply that misses a line or splits a passage differently', () => {
    const missing = JSON.stringify({ lines: [{ n: 1, romaji: '', translation: 'Hey.' }] })

    const unsplit = JSON.stringify({
      lines: [
        { n: 1, romaji: '', translation: 'Hey.' },
        { n: 2, romaji: '', translation: 'Tomorrow, really?' },
        { n: 3, romaji: '', translation: 'BA-DUMP' },
      ],
    })

    expect(parseLines(missing, lines)).toEqual(Option.none())
    expect(parseLines(unsplit, lines)).toEqual(Option.none())
    expect(parseLines('not json', lines)).toEqual(Option.none())
  })

  it('keeps romaji whole on the first bubble when its split does not match', () => {
    const reply = JSON.stringify({
      lines: [
        { n: 1, romaji: 'Ashita no shiai hontō ni deru no', translation: 'Tomorrow… | really?' },
      ],
    })

    expect(parseLines(reply, [lines[1] ?? lines[0]!])).toEqual(
      Option.some([
        { romaji: ['Ashita no shiai hontō ni deru no', ''], translation: ['Tomorrow…', 'really?'] },
      ]),
    )
  })

  it('asks for alternatives to one line and keeps those split like it', () => {
    expect(
      alternativesPrompt(lines, 1, "About tomorrow's match… | you're really playing?"),
    ).toContain('line 2')

    const reply = JSON.stringify({
      alternatives: ['Tomorrow… | you mean it?', 'No split here', 'So… | really?'],
    })

    expect(parseAlternatives(reply, 2)).toEqual(
      Option.some(['Tomorrow… | you mean it?', 'So… | really?']),
    )

    expect(parseAlternatives(JSON.stringify({ alternatives: ['No split'] }), 2)).toEqual(
      Option.none(),
    )
  })

  it('reads a chat reply and keeps a suggestion only when it fits its line', () => {
    const fitting = JSON.stringify({
      reply: 'Worried.',
      suggestion: { line: 2, translation: 'So… | really?' },
    })

    expect(parseChat(fitting, [1, 2])).toEqual({
      text: 'Worried.',
      suggestion: { index: 1, translation: 'So… | really?' },
    })

    const unsplit = JSON.stringify({
      reply: 'Worried.',
      suggestion: { line: 2, translation: 'Really?' },
    })

    expect(parseChat(unsplit, [1, 2])).toEqual({ text: 'Worried.' })

    expect(parseChat(JSON.stringify({ reply: 'Fine.', suggestion: null }), [1])).toEqual({
      text: 'Fine.',
    })
  })

  it('keeps a chat reply that is plain prose', () => {
    expect(parseChat('She sounds worried.', [1])).toEqual({ text: 'She sounds worried.' })
  })

  it('puts the series notes in the system prompt', () => {
    expect(systemPrompt('English', 'Keep -chan.')).toContain('Keep -chan.')
    expect(systemPrompt('English', '  ')).not.toContain('this series')
  })
})
