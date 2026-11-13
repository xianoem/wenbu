import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import {
  DedupeCharacters,
  DedupeVariableSegments,
  DedupeWholeText,
  defaultTextPipeline,
  KeepJapaneseQuotes,
  KeepLines,
  RecoverGrowingPrefix,
  RecoverShrinkingSuffix,
  RemoveAngleTags,
  RemoveAsciiPunctuation,
  RemoveBraces,
  RemoveControlCharacters,
  RemoveLatinLetters,
  RemoveLineBreaks,
  RemoveNonShiftJis,
  RemoveNumbers,
  StringReplacement,
  TextPipeline,
  type TextProcessor,
} from '#contract/TranslationOverlay'
import { applyTextPipeline, pipelineProblems } from './TextPipeline'

const run = (text: string, ...processors: Array<TextProcessor>) =>
  applyTextPipeline(text, { processors })

const on = { enabled: true }

const replace = (...rules: (typeof StringReplacement)['Type']['rules']) =>
  StringReplacement.make({ id: 'replace', ...on, rules })

const rule = (
  id: string,
  key: string,
  value: string,
  options: { regex?: boolean; escape?: boolean } = {},
) => ({
  id,
  key,
  value,
  regex: options.regex ?? false,
  escape: options.escape ?? false,
})

const defaults = (text: string) => applyTextPipeline(text, defaultTextPipeline).text

describe('TextPipeline', () => {
  it('lists every processor in order with the two LunaTranslator defaults on', () => {
    const ids = defaultTextPipeline.processors.map((processor) => processor.id)

    expect(Schema.is(TextPipeline)(defaultTextPipeline)).toBe(true)
    expect(new Set(ids).size).toBe(16)

    expect(
      defaultTextPipeline.processors
        .filter((processor) => processor.enabled)
        .map((processor) => processor.id),
    ).toEqual(['dedupe-characters', 'dedupe-whole-text'])
  })

  it('applies processors in order and skips disabled ones', () => {
    const result = run(
      'A1B2',
      RemoveNumbers.make({ id: 'numbers', enabled: false }),
      RemoveLatinLetters.make({ id: 'letters', ...on }),
      RemoveNumbers.make({ id: 'numbers-2', ...on }),
    )

    expect(result.text).toBe('')
    expect(result.steps.map((step) => step.processorId)).toEqual(['letters', 'numbers-2'])
  })

  it('replaces literal, escaped and regular-expression keys', () => {
    const result = run(
      'foo\\n123',
      replace(
        rule('literal', 'foo', 'bar'),
        rule('escaped', '\\\\n', '\\n', { escape: true }),
        rule('regex', '\\d+', 'N', { regex: true }),
      ),
    )

    expect(result.text).toBe('bar\nN')
  })

  it('leaves the text alone when a regular expression does not compile', () => {
    const result = run('abc', replace(rule('bad', '[', '', { regex: true })))

    expect(result.text).toBe('abc')
    expect(result.steps[0]?.error).toContain('Invalid regular expression')
  })

  it('finds broken regular expressions before a pipeline is saved, even when disabled', () => {
    const problems = pipelineProblems({
      processors: [
        StringReplacement.make({
          id: 'replace',
          enabled: false,
          rules: [rule('bad', '[', '', { regex: true })],
        }),
      ],
    })

    expect(problems.map((problem) => problem.ruleId)).toEqual(['bad'])
  })

  it('removes characters outside Shift-JIS, control codes, punctuation, numbers and Latin', () => {
    const result = run(
      '日😀A1!\u0001\n',
      RemoveNonShiftJis.make({ id: 'sjis', ...on }),
      RemoveControlCharacters.make({ id: 'control', ...on }),
      RemoveAsciiPunctuation.make({ id: 'punctuation', ...on }),
      RemoveNumbers.make({ id: 'numbers', ...on }),
      RemoveLatinLetters.make({ id: 'letters', ...on }),
    )

    expect(result.text).toBe('日\n')
  })

  it('keeps quoted Japanese and strips brace and angle markup', () => {
    const result = run(
      'name「<b>{恵麻/えま}さん</b>」tail',
      KeepJapaneseQuotes.make({ id: 'quotes', ...on }),
      RemoveBraces.make({ id: 'braces', ...on }),
      RemoveAngleTags.make({ id: 'angles', ...on }),
    )

    expect(result.text).toBe('「恵麻さん」')
  })

  it('keeps the last lines and joins line breaks', () => {
    const kept = run(
      'one\ntwo\nthree',
      KeepLines.make({ id: 'lines', ...on, count: 2, from: 'end' }),
    )

    const joined = run(kept.text, RemoveLineBreaks.make({ id: 'breaks', ...on }))

    expect([kept.text, joined.text]).toEqual(['two\nthree', 'two three'])
  })

  it('collapses repeated characters with an inferred or fixed count', () => {
    const inferred = run(
      '響響響くくくA。',
      DedupeCharacters.make({ id: 'dedupe', ...on, repeatCount: 1, preserveNonRepeated: true }),
    )

    const fixed = run(
      'AAAABBBBCCCC',
      DedupeCharacters.make({ id: 'dedupe', ...on, repeatCount: 4, preserveNonRepeated: false }),
    )

    expect([inferred.text, fixed.text]).toEqual(['響くA。', 'ABC'])
  })

  it('collapses text repeated as a whole', () => {
    const result = run(
      '台詞。台詞。台詞。',
      DedupeWholeText.make({ id: 'whole', ...on, repeatCount: 1 }),
    )

    expect(result.text).toBe('台詞。')
  })

  it('collapses repeated segments of different lengths', () => {
    const result = run('abcabcabcXYdefdef', DedupeVariableSegments.make({ id: 'segments', ...on }))

    expect(result.text).toBe('abcXYdef')
  })

  it('recovers text redrawn as shrinking suffixes', () => {
    const result = run('ABCDBCDCDD', RecoverShrinkingSuffix.make({ id: 'shrinking', ...on }))

    expect(result.text).toBe('ABCD')
  })

  it('recovers text redrawn as growing prefixes, line by line', () => {
    const result = run('AABABCABCD\nXXYXYZ', RecoverGrowingPrefix.make({ id: 'growing', ...on }))

    expect(result.text).toBe('ABCD\nXYZ')
  })

  it('repairs the glyph repeats GetTextExtentPoint32A hooks emit, with the defaults', () => {
    expect(defaults('響響響くくく。。。響響響くくく。。。')).toBe('響く。')

    expect(defaults('響響響くくく始始始業業業ベベベルルルののの音音音。。。')).toBe(
      '響く始業ベルの音。',
    )
  })

  it('repairs doubled speaker names and tripled dialogue without flattening natural doubles', () => {
    const raw =
      '小小山山内内　　孝孝「「「そそそれれれじじじゃゃゃあああ、、、行行行きききままましししょょょうううかかか。。。新新新発発発田田田さささんんん」」」'

    expect(defaults(raw)).toBe('小山内　孝「それじゃあ、行きましょうか。新発田さん」')
    expect(defaults('これはいい話です。')).toBe('これはいい話です。')

    expect(defaults(raw.replace('行行行', 'いいいいいい行行行'))).toBe(
      '小山内　孝「それじゃあ、いい行きましょうか。新発田さん」',
    )
  })
})
