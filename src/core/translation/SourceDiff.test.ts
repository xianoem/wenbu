import { describe, expect, it } from '@effect/vitest'
import type { TextEntry } from '../rpgmaker/TextEntries'
import { diffSources, type StoredSource } from './SourceDiff'

const entry = (index: number, src: string, file = 'Map001.json'): TextEntry => ({
  id: `${file}::/events/1/pages/0/list/${index}/parameters/0`,
  file,
  pointer: `/events/1/pages/0/list/${index}/parameters/0`,
  src,
  dst: '',
  context: 'Show Text',
})

const stored = (
  from: TextEntry,
  translatedText: string | undefined,
  extra: Partial<StoredSource> = {},
): StoredSource => ({
  entryId: from.id,
  file: from.file,
  sourceText: from.src,
  ...(translatedText === undefined ? {} : { translatedText }),
  origin: 'model',
  locked: false,
  applied: true,
  ...extra,
})

const summary = (diff: ReturnType<typeof diffSources>) =>
  diff.lines.map((line) => [line.entry.src, line.change, line.translatedText])

describe('diffSources', () => {
  it('keeps a translation whose text moved when the author inserted a command', () => {
    const before = [entry(0, 'おはよう'), entry(1, 'こんにちは')]
    const after = [entry(0, '新しい行'), entry(1, 'おはよう'), entry(2, 'こんにちは')]

    const diff = diffSources(
      [stored(before[0]!, 'Good morning'), stored(before[1]!, 'Hello')],
      after,
    )

    expect(summary(diff)).toEqual([
      ['新しい行', 'new', undefined],
      ['おはよう', undefined, 'Good morning'],
      ['こんにちは', undefined, 'Hello'],
    ])

    expect(diff.counts).toEqual({ unchanged: 0, moved: 2, changed: 0, added: 1, removed: 0 })
  })

  it('clears a changed model translation but keeps a locked one for review', () => {
    const before = [entry(0, 'おはよう'), entry(1, 'こんにちは')]
    const after = [entry(0, 'おはようございます'), entry(1, 'こんにちは！')]

    const diff = diffSources(
      [stored(before[0]!, 'Good morning'), stored(before[1]!, 'Hello', { locked: true })],
      after,
    )

    expect(summary(diff)).toEqual([
      ['おはようございます', 'changed', undefined],
      ['こんにちは！', 'changed', 'Hello'],
    ])

    expect(diff.lines.map((line) => [line.previousSource, line.previousText])).toEqual([
      ['おはよう', 'Good morning'],
      ['こんにちは', 'Hello'],
    ])

    expect(diff.counts.changed).toBe(2)
  })

  it('finds a reworded line after inserted lines moved it', () => {
    const before = [entry(0, 'おはよう'), entry(1, 'こんにちは')]
    const after = [entry(0, '新しい行'), entry(1, 'おはよう'), entry(2, 'こんにちは！')]

    const diff = diffSources(
      [stored(before[0]!, 'Good morning'), stored(before[1]!, 'Hi there', { locked: true })],
      after,
    )

    expect(summary(diff)).toEqual([
      ['新しい行', 'new', undefined],
      ['おはよう', undefined, 'Good morning'],
      ['こんにちは！', 'changed', 'Hi there'],
    ])

    expect(diff.counts).toEqual({ unchanged: 0, moved: 1, changed: 1, added: 1, removed: 0 })
  })

  it('pairs a reworded line with its old text when a new line is inserted right before it', () => {
    const before = [entry(0, '夜風に当たってのんびりしない？'), entry(1, 'またね')]

    const after = [
      entry(0, 'アップデートで追加された新しいセリフ'),
      entry(1, '夜風に当たってのんびりしない？（修正版）'),
      entry(2, 'またね'),
    ]

    const diff = diffSources(
      [stored(before[0]!, 'Enjoy the breeze?'), stored(before[1]!, 'Bye')],
      after,
    )

    expect(summary(diff)).toEqual([
      ['アップデートで追加された新しいセリフ', 'new', undefined],
      ['夜風に当たってのんびりしない？（修正版）', 'changed', undefined],
      ['またね', undefined, 'Bye'],
    ])

    expect(diff.lines[1]?.previousText).toBe('Enjoy the breeze?')
  })

  it('pairs a reworded line with its old text when the line before it was removed', () => {
    const inserted = entry(0, 'アップデートで追加された新しいセリフ')
    const reworded = entry(1, '夜風に当たってのんびりしない？（修正版）')
    const bye = entry(2, 'またね')

    const diff = diffSources(
      [
        stored(inserted, undefined, { change: 'new' }),
        stored(reworded, undefined, {
          change: 'changed',
          previousSource: '夜風に当たってのんびりしない？',
          previousText: 'Enjoy the breeze?',
        }),
        stored(bye, 'Bye'),
      ],
      [entry(0, '夜風に当たってのんびりしない？'), entry(1, 'またね')],
    )

    expect(summary(diff)).toEqual([
      ['夜風に当たってのんびりしない？', 'changed', 'Enjoy the breeze?'],
      ['またね', undefined, 'Bye'],
    ])

    expect(diff.counts.removed).toBe(1)
  })

  it('gives a line back its old translation when its text goes back to what it was', () => {
    const now = entry(0, 'こんばんは')

    const diff = diffSources(
      [
        stored(now, undefined, {
          change: 'changed',
          previousSource: 'こんにちは',
          previousText: 'Hello',
        }),
      ],
      [entry(0, 'こんにちは')],
    )

    expect(summary(diff)).toEqual([['こんにちは', 'changed', 'Hello']])
    expect(diff.lines[0]?.applied).toBe(false)
  })

  it('drops lines that are gone and leaves unchanged lines as they were', () => {
    const before = [entry(0, 'おはよう'), entry(1, 'さようなら')]

    const diff = diffSources(
      [
        stored(before[0]!, 'Morning!', { origin: 'edited', applied: false }),
        stored(before[1]!, 'Bye'),
      ],
      [before[0]!],
    )

    expect(
      diff.lines.map((line) => [line.change, line.translatedText, line.origin, line.applied]),
    ).toEqual([[undefined, 'Morning!', 'edited', false]])

    expect(diff.counts).toEqual({ unchanged: 1, moved: 0, changed: 0, added: 0, removed: 1 })
  })

  it('prefers a moved line from the same file when the text repeats', () => {
    const map1 = entry(0, 'はい')
    const map2 = entry(0, 'はい', 'Map002.json')

    const diff = diffSources(
      [stored(map1, 'Yes'), stored(map2, 'Sure')],
      [entry(3, 'はい', 'Map002.json'), entry(5, 'はい')],
    )

    expect(summary(diff)).toEqual([
      ['はい', undefined, 'Sure'],
      ['はい', undefined, 'Yes'],
    ])
  })
})
