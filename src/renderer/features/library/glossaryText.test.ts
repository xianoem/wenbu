import { assert, describe, it } from '@effect/vitest'
import type { GameGlossary, GlossaryEstimate } from '#contract/GameGlossary'
import {
  contentsOf,
  extraText,
  offPreparedSummary,
  offSummary,
  preparationText,
  readySummary,
  speakerLabel,
  unpreparedSummary,
} from './glossaryText'

const priced: GlossaryEstimate = {
  enabled: false,
  prepared: false,
  prepare: { inputTokens: 60_000, outputTokens: 10_000, costUsd: 0.35 },
  extraInputTokens: 400_000,
  extraCostUsd: 1.2,
  baseCostUsd: 23.4,
}

const priceless: GlossaryEstimate = {
  enabled: false,
  prepared: false,
  prepare: { inputTokens: 60_000, outputTokens: 10_000 },
  extraInputTokens: 400_000,
}

const glossary: GameGlossary = {
  gameId: 'g',
  enabled: true,
  preparedAt: '2026-11-18T10:00:00Z',
  costUsd: 0.33,
  entries: [
    {
      id: 'a',
      kind: 'character',
      original: 'リナ',
      translation: 'Lina',
      note: '',
      speakers: [],
      lines: 3,
    },
    {
      id: 'b',
      kind: 'item',
      original: '回復薬',
      translation: 'Potion',
      note: '',
      speakers: [],
      lines: 1,
    },
    {
      id: 'c',
      kind: 'place',
      original: '森',
      translation: 'Forest',
      note: '',
      speakers: [],
      lines: 1,
    },
  ],
}

describe('glossaryText', () => {
  it('prices the glossary in dollars when the model has a price', () => {
    assert.strictEqual(preparationText(priced), '$0.35')
    assert.strictEqual(extraText(priced), '$1.20 (5%)')

    assert.strictEqual(
      offSummary(priced),
      'Keeps names, terms and each character’s way of talking the same in every scene. About $0.35 once, then about $1.20 (5%) more a run.',
    )

    assert.strictEqual(
      unpreparedSummary(priced),
      'Not prepared yet. Translate prepares it first, about $0.35 once. Or prepare it now and review it before translating.',
    )
  })

  it('counts tokens when the model has no price', () => {
    assert.strictEqual(preparationText(priceless), '70K tokens')
    assert.strictEqual(extraText(priceless), '400K tokens')
  })

  it('sums up a prepared glossary', () => {
    assert.strictEqual(contentsOf(glossary), '1 character and 2 terms')

    assert.strictEqual(
      readySummary(glossary, priced),
      '1 character and 2 terms · prepared for $0.33 · adds about $1.20 (5%) a run',
    )

    assert.strictEqual(
      readySummary({ ...glossary, costUsd: undefined }, undefined),
      '1 character and 2 terms',
    )

    assert.strictEqual(
      offPreparedSummary(glossary, priced),
      '1 character and 2 terms · off · would add about $1.20 (5%) a run',
    )
  })

  it('names the speaker keys the way the game shows them', () => {
    assert.strictEqual(speakerLabel('name:リナ'), 'name box リナ')
    assert.strictEqual(speakerLabel('face:Actor1:0'), 'face Actor1 #0')
    assert.strictEqual(speakerLabel('actor:2'), 'actor 2')
  })
})
