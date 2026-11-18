import { describe, expect, it } from '@effect/vitest'
import type { GameGlossaryEntry } from '#contract/GameGlossary'
import type { RpgData } from '../rpgmaker/RpgData'
import type { TextEntry } from '../rpgmaker/TextEntries'
import {
  candidateNames,
  collectMaterial,
  lineCounts,
  provisionalGlossary,
  speakerIndex,
  splitBySpeaker,
} from './GlossaryMaterial'

const command = (code: number, parameters: Array<RpgData>) => ({ code, parameters })

const pointer = (index: number) => `/events/1/pages/0/list/${index}/parameters/0`

const material = () => {
  const collector = collectMaterial()

  collector.add('Actors.json', [
    null,
    { id: 1, name: 'リナ', nickname: '', profile: '明るい少女', faceName: 'Actor1', faceIndex: 0 },
  ])

  collector.add('Items.json', [null, { name: '回復薬' }, { name: '' }, { name: '回復薬' }])
  collector.add('MapInfos.json', [null, { name: '灯火の森' }])

  collector.add('Map001.json', {
    displayName: '虚ろ村',
    events: [
      null,
      {
        pages: [
          {
            list: [
              command(101, ['Actor1', 0, 0, 2]),
              command(401, ['回復薬をちょうだい']),
              command(101, ['People1', 3, 0, 2, '村長']),
              command(401, ['灯火の森へ行け']),
              command(101, ['Evil', 1, 0, 2]),
              command(401, ['……']),
            ],
          },
        ],
      },
    ],
  })

  return collector.material()
}

const entry = (index: number, src: string): TextEntry => ({
  id: `Map001.json::${pointer(index)}`,
  file: 'Map001.json',
  pointer: pointer(index),
  src,
  dst: '',
  context: 'Map001.json -> Show Text',
})

const entries = [entry(1, '回復薬をちょうだい'), entry(3, '灯火の森へ行け'), entry(5, '……')]

const glossaryEntry = (
  fields: Partial<GameGlossaryEntry> & Pick<GameGlossaryEntry, 'id' | 'original'>,
): GameGlossaryEntry => ({
  kind: 'character',
  translation: fields.original,
  note: '',
  speakers: [],
  lines: 0,
  ...fields,
})

describe('collectMaterial', () => {
  it('keeps each line’s speaker, the party and the database names', () => {
    const found = material()

    expect(found.speakers.get(entries[0]?.id ?? '')).toEqual({ face: 'Actor1:0' })
    expect(found.speakers.get(entries[1]?.id ?? '')).toEqual({ name: '村長', face: 'People1:3' })

    expect(found.actors).toEqual([
      { id: 1, name: 'リナ', nickname: '', profile: '明るい少女', face: 'Actor1:0' },
    ])

    expect(found.names).toEqual([
      { kind: 'item', name: '回復薬' },
      { kind: 'place', name: '灯火の森' },
      { kind: 'place', name: '虚ろ村' },
    ])
  })
})

describe('candidateNames', () => {
  it('puts the names the dialogue mentions first', () => {
    expect(candidateNames(material(), [entry(3, '灯火の森へ行け')], 2)).toEqual([
      { kind: 'place', name: '灯火の森' },
      { kind: 'item', name: '回復薬' },
    ])
  })
})

describe('speakerIndex', () => {
  it('finds the character by the keys it claims, its name, or its actor’s face', () => {
    const index = speakerIndex(material(), [
      glossaryEntry({ id: 'lina', original: 'リナ', translation: 'Lina' }),
      glossaryEntry({ id: 'chief', original: '村長', translation: 'Village Chief' }),
      glossaryEntry({
        id: 'villain',
        original: '黒衣の男',
        translation: 'Man in Black',
        speakers: ['face:Evil:1'],
      }),
    ])

    expect(entries.map((line) => index.resolve(line.id)?.label)).toEqual([
      'Lina',
      'Village Chief',
      'Man in Black',
    ])
  })

  it('falls back to the name box when no character claims it', () => {
    const index = speakerIndex(material(), [])

    expect(entries.map((line) => index.resolve(line.id))).toEqual([
      { label: 'リナ' },
      { label: '村長' },
      undefined,
    ])
  })
})

describe('splitBySpeaker', () => {
  it('translates a shared line once per speaker', () => {
    const labels = new Map([
      ['a', 'Lina'],
      ['b', 'Kai'],
      ['c', 'Lina'],
    ])

    const items = [{ id: 'a', src: 'ありがとう', context: '', entryIds: ['a', 'b', 'c'] }]

    expect(splitBySpeaker(items, (id) => labels.get(id))).toEqual([
      { id: 'a', src: 'ありがとう', context: '', entryIds: ['a', 'c'] },
      { id: 'b', src: 'ありがとう', context: '', entryIds: ['b'] },
    ])
  })
})

describe('provisionalGlossary', () => {
  it('stands in for the glossary before it is prepared', () => {
    const glossary = provisionalGlossary(material(), entries)

    expect(glossary.map((found) => [found.kind, found.original, found.speakers])).toEqual([
      ['character', 'リナ', ['actor:1', 'name:リナ', 'face:Actor1:0']],
      ['character', '村長', ['name:村長']],
      ['character', '', ['face:Evil:1']],
      ['item', '回復薬', []],
      ['place', '灯火の森', []],
      ['place', '虚ろ村', []],
    ])

    expect(glossary.every((found) => found.translation.length >= 3)).toBe(true)
  })
})

describe('lineCounts', () => {
  it('counts the lines a character says or that name an entry', () => {
    const glossary = [
      glossaryEntry({ id: 'lina', original: 'リナ' }),
      glossaryEntry({ id: 'potion', original: '回復薬', kind: 'item' }),
    ]

    expect(lineCounts(glossary, entries, speakerIndex(material(), glossary))).toEqual(
      new Map([
        ['lina', 1],
        ['potion', 1],
      ]),
    )
  })
})
