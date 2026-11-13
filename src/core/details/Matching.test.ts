import { assert, describe, it } from '@effect/vitest'
import { Option } from 'effect'
import {
  type CandidateFacts,
  confidentPick,
  type FolderHints,
  normalize,
  scoreCandidate,
  similarity,
} from './Matching'

const hints = (overrides: Partial<FolderHints> = {}): FolderHints => ({
  titles: ['鍛冶師ノ姉ガ堕チル時'],
  pathNames: ['鍛冶師ノ姉ガ堕チル時…ver1.02', 'Games', 'H', 'D:'],
  releasedOn: Option.none(),
  rpgMaker: true,
  ...overrides,
})

const candidate = (overrides: Partial<CandidateFacts> = {}): CandidateFacts => ({
  titles: ['鍛冶師ノ姉ガ堕チル時…'],
  circle: 'Crazy Nirin',
  releasedOn: Option.some('2023-03-17'),
  workType: 'RPG',
  genreIds: [510, 315],
  ...overrides,
})

describe('Matching', () => {
  it('compares titles across width, case, kana and punctuation', () => {
    assert.strictEqual(normalize('【完全版】戦巫女ホノカ'), '戦巫女ほのか')
    assert.strictEqual(similarity('ＳＵＭＭＥＲ　ＲＰＧ!', 'summer rpg'), 1)
    assert.strictEqual(similarity('ホノカ', 'ほのか'), 1)
    assert.isAbove(similarity('Blue Mage Luna', 'Blue Mage Luna ~The Lost Grimoire~'), 0.85)
    assert.isBelow(similarity('Blue Mage Luna', 'Red Knight Alicia'), 0.4)
    assert.strictEqual(similarity('', 'anything'), 0)
  })

  it('scores a matching title highest, with its reasons', () => {
    const scored = scoreCandidate(hints(), candidate())

    assert.isAtLeast(scored.score, 95)

    assert.deepStrictEqual(
      scored.reasons.map((reason) => reason.agrees),
      [true, true],
    )
  })

  it('never reaches 100, which only a code gives', () => {
    const scored = scoreCandidate(
      hints({ releasedOn: Option.some('2023-03-17'), pathNames: ['Crazy Nirin'] }),
      candidate(),
    )

    assert.strictEqual(scored.score, 99)
  })

  it('counts the Circle in a parent folder and the release date in the name', () => {
    const plain = scoreCandidate(hints({ titles: ['鍛冶師の姉'] }), candidate()).score

    const withCircle = scoreCandidate(
      hints({ titles: ['鍛冶師の姉'], pathNames: ['鍛冶師の姉', 'Crazy Nirin'] }),
      candidate(),
    ).score

    const wrongDate = scoreCandidate(
      hints({ titles: ['鍛冶師の姉'], releasedOn: Option.some('2024-01-01') }),
      candidate(),
    )

    assert.isAbove(withCircle, plain)
    assert.isBelow(wrongDate.score, plain)
    assert.isTrue(wrongDate.reasons.some((reason) => !reason.agrees))
  })

  it('gives no bonus to a title that does not match', () => {
    const scored = scoreCandidate(
      hints({ titles: ['Completely Different'], pathNames: ['Crazy Nirin'] }),
      candidate(),
    )

    assert.isBelow(scored.score, 20)
  })

  it('links without asking only a confident candidate well ahead of the next', () => {
    assert.deepStrictEqual(
      confidentPick([{ score: 95 }, { score: 70 }]),
      Option.some({ score: 95 }),
    )

    assert.isTrue(Option.isNone(confidentPick([{ score: 95 }, { score: 88 }])))
    assert.isTrue(Option.isNone(confidentPick([{ score: 85 }])))
    assert.isTrue(Option.isNone(confidentPick([])))

    assert.deepStrictEqual(
      confidentPick([{ score: 60 }, { score: 92 }]),
      Option.some({ score: 92 }),
    )
  })
})
