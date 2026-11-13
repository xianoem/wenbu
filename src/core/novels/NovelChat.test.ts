import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { GlossaryTerm } from '#contract/Novels'
import { charactersOf, citationsOf, coverageOf, type NovelBook } from './NovelChat'
import { contentFlags } from './NovelDigests'
import type { StoredDigest } from './NovelInsightStore'

const chapters = [1, 2, 3, 4].map((number) => ({
  number,
  title: `第${number}章`,
  titleTranslated: null,
}))

const digest = (number: number, characters: ReadonlyArray<string>): StoredDigest => ({
  number,
  summary: `Chapter ${number}.`,
  characters,
  flags: [],
  cost_usd: null,
})

const term = (original: string, translation: string): GlossaryTerm => ({
  id: original,
  original,
  translation,
  kind: 'character',
  gender: null,
  note: null,
  suggested: false,
  glossary: 'Novel',
  chapters: [],
  origin: 'manual',
  count: 0,
  reading: null,
})

const book = (digests: ReadonlyArray<StoredDigest>, ongoing = true): NovelBook => ({
  title: 'Sword and Candle',
  originalTitle: '劍燭大荒',
  ongoing,
  chapters,
  digests,
  terms: [],
  flags: contentFlags([]),
  fetched: 2,
  readingChapter: 2,
  search: () => Effect.succeed([]),
})

describe('coverageOf', () => {
  it('says how far the digests reach, and that the novel goes on', () => {
    expect(coverageOf(book([digest(1, []), digest(2, [])]))).toBe(
      'Checked chapters 1 to 2 of 4 (the novel is ongoing).',
    )

    expect(
      coverageOf(
        book(
          chapters.map((chapter) => digest(chapter.number, [])),
          false,
        ),
      ),
    ).toBe('Checked all 4 chapters.')

    expect(coverageOf(book([digest(1, []), digest(3, [])]))).toBe(
      'Checked 2 of 4 chapters (the novel is ongoing).',
    )

    expect(coverageOf(book([]))).toBe(
      'No chapter digests yet; searched the text of 2 of 4 chapters (the novel is ongoing).',
    )
  })
})

describe('citationsOf', () => {
  it('takes the chapters out of the text and keeps the ones the novel has', () => {
    expect(citationsOf('He dies. [ch3]\nShe mourns [ch3, ch4, ch99].', chapters)).toEqual({
      text: 'He dies.\nShe mourns.',
      chapters: [3, 4],
    })
  })
})

describe('charactersOf', () => {
  it('lists only characters met up to the reading position, most mentioned first', () => {
    const terms = [
      term('丁松言', 'Ding Songyan'),
      term('林雅', 'Lin Ya'),
      term('白衣', 'Bai Yi'),
      term('老人', 'Old Man'),
    ]

    const digests = [
      digest(1, ['丁松言']),
      digest(2, ['丁松言', '林雅']),
      digest(3, ['白衣', '林雅']),
    ]

    expect(
      charactersOf(terms, digests, 2).map((character) => [
        character.translation,
        character.firstChapter,
        character.mentions,
      ]),
    ).toEqual([
      ['Ding Songyan', 1, 2],
      ['Lin Ya', 2, 1],
      ['Old Man', null, 0],
    ])
  })
})
