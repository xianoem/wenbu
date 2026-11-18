import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { GameGlossaryEntry } from '#contract/GameGlossary'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import type { RpgData } from '../rpgmaker/RpgData'
import { batchPrompt } from './Batches'
import { collectMaterial, speakerIndex } from './GlossaryMaterial'
import { encodeJson } from './TranslationShared'
import {
  glossaryBatchPrompt,
  makeGlossaryRequests,
  parsePreparation,
  preparationPrompt,
} from './GlossaryPrompts'

const command = (code: number, parameters: Array<RpgData>) => ({ code, parameters })

const lineId = (index: number) => `Map001.json::/events/1/pages/0/list/${index}/parameters/0`

const material = () => {
  const collector = collectMaterial()

  collector.add('Actors.json', [
    null,
    { id: 1, name: 'リナ', nickname: '', profile: '', faceName: 'Actor1', faceIndex: 0 },
  ])

  collector.add('Items.json', [null, { name: '回復薬' }])

  collector.add('Map001.json', {
    displayName: '',
    events: [
      null,
      {
        pages: [
          {
            list: [
              command(101, ['Actor1', 0, 0, 2]),
              command(401, ['回復薬をちょうだい']),
              command(101, ['', 0, 0, 2]),
              command(401, ['こんにちは']),
            ],
          },
        ],
      },
    ],
  })

  return collector.material()
}

const glossary: ReadonlyArray<GameGlossaryEntry> = [
  {
    id: 'lina',
    kind: 'character',
    original: 'リナ',
    translation: 'Lina',
    note: 'Bright, quick to apologise.',
    speakers: [],
    lines: 1,
  },
  {
    id: 'potion',
    kind: 'item',
    original: '回復薬',
    translation: 'Healing Draught',
    note: '',
    speakers: [],
    lines: 1,
  },
  {
    id: 'kai',
    kind: 'character',
    original: 'カイ',
    translation: 'Kai',
    note: 'Blunt.',
    speakers: [],
    lines: 0,
  },
]

const item = (index: number, src: string) => ({
  id: lineId(index),
  src,
  context: 'Map001.json -> Show Text',
  entryIds: [lineId(index)],
})

describe('glossaryBatchPrompt', () => {
  it.effect('sends the speaker and only the entries the batch needs', () =>
    Effect.gen(function* () {
      const found = material()
      const requests = makeGlossaryRequests(glossary, speakerIndex(found, glossary))

      const prompt = yield* glossaryBatchPrompt(
        defaultTranslationSettings,
        [item(1, '回復薬をちょうだい')],
        requests,
      )

      const parts = prompt.split('\n\n')

      expect(parts.at(-2)).toBe(
        '{"characters":[{"name":"リナ","english":"Lina","voice":"Bright, quick to apologise."}],"terms":[{"original":"回復薬","english":"Healing Draught"}]}',
      )

      expect(parts.at(-1)).toBe(
        '{"1":{"text":"回復薬をちょうだい","context":"Map001.json -> Show Text","speaker":"Lina"}}',
      )

      expect(prompt).not.toContain('Kai')
    }),
  )

  it.effect('sends today’s request when nothing in the batch is in the glossary', () =>
    Effect.gen(function* () {
      const found = material()
      const requests = makeGlossaryRequests(glossary, speakerIndex(found, glossary))
      const batch = [item(3, 'こんにちは')]

      expect(yield* glossaryBatchPrompt(defaultTranslationSettings, batch, requests)).toBe(
        yield* batchPrompt(defaultTranslationSettings, batch),
      )
    }),
  )
})

describe('preparationPrompt', () => {
  it.effect('shows the speakers with sample lines, the party and the database names', () =>
    Effect.gen(function* () {
      const found = material()

      const prompt = yield* preparationPrompt('English', found, [
        {
          id: lineId(1),
          file: 'Map001.json',
          pointer: '',
          src: '回復薬をちょうだい',
          dst: '',
          context: '',
        },
      ])

      expect(prompt).toContain('into English')
      expect(prompt).toContain('"face:Actor1:0":{"lines":1,"samples":["回復薬をちょうだい"]}')
      expect(prompt).toContain('{"id":1,"name":"リナ","face":"face:Actor1:0"}')
      expect(prompt).toContain('"item":["回復薬"]')
    }),
  )
})

describe('parsePreparation', () => {
  it.effect('keeps clean entries and only the speaker keys the game has', () =>
    Effect.gen(function* () {
      const reply = yield* encodeJson({
        characters: [
          {
            original: 'リナ',
            english: 'Lina',
            voice: 'Bright.',
            speakers: ['face:Actor1:0', 'face:Nobody:9'],
          },
          { original: 'カイ', english: 'Kai', voice: null, speakers: ['face:Actor1:0'] },
          { original: '', english: 'Nobody' },
        ],
        terms: [
          { original: '回復薬', english: 'Healing Draught', kind: 'item', note: '' },
          { original: '回復薬', english: 'Potion', kind: 'item' },
          { original: '虚ろ村', english: 'Hollow Village', kind: 'town' },
        ],
      })

      const entries = yield* parsePreparation(
        `\`\`\`json\n${reply}\n\`\`\``,
        new Set(['face:Actor1:0']),
      )

      expect(entries).toEqual([
        {
          kind: 'character',
          original: 'リナ',
          translation: 'Lina',
          note: 'Bright.',
          speakers: ['face:Actor1:0'],
        },
        { kind: 'character', original: 'カイ', translation: 'Kai', note: '', speakers: [] },
        {
          kind: 'item',
          original: '回復薬',
          translation: 'Healing Draught',
          note: '',
          speakers: [],
        },
        {
          kind: 'other',
          original: '虚ろ村',
          translation: 'Hollow Village',
          note: '',
          speakers: [],
        },
      ])
    }),
  )

  it.effect('fails on a reply that is not the JSON asked for', () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(parsePreparation('Sorry, I cannot.', new Set()))

      expect(result).toBeDefined()
    }),
  )
})
