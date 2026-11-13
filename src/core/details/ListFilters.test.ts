import { assert, describe, it } from '@effect/vitest'
import { applyListFilters } from './ListFilters'

const work = (code: string, workType: string, ...ids: Array<number>) => ({
  code,
  workType,
  genres: ids.map((id) => ({ id, name: `g${id}` })),
})

const tag = (id: number) => ({ id, name: `g${id}` })

const codes = (works: ReadonlyArray<{ readonly code: string }>) => works.map((found) => found.code)

describe('applyListFilters', () => {
  const works = [
    work('fantasy', 'RPG', 1, 2),
    work('ntr', 'RPG', 1, 48),
    work('village', 'SLN', 3, 48),
    work('untagged', ''),
  ]

  it('shows everything when nothing is chosen', () => {
    assert.deepStrictEqual(codes(applyListFilters(works, { tags: [], gameTypes: [] })), [
      'fantasy',
      'ntr',
      'village',
      'untagged',
    ])
  })

  it('shows only works that have the chosen tag', () => {
    assert.deepStrictEqual(codes(applyListFilters(works, { tags: [tag(48)], gameTypes: [] })), [
      'ntr',
      'village',
    ])
  })

  it('shows only works that have every chosen tag', () => {
    assert.deepStrictEqual(
      codes(applyListFilters(works, { tags: [tag(48), tag(1)], gameTypes: [] })),
      ['ntr'],
    )
  })

  it('shows only works of a chosen game type', () => {
    assert.deepStrictEqual(
      codes(applyListFilters(works, { tags: [], gameTypes: ['SLN', 'ADV'] })),
      ['village'],
    )
  })

  it('needs both the tags and the game type', () => {
    assert.deepStrictEqual(
      codes(applyListFilters(works, { tags: [tag(48)], gameTypes: ['RPG'] })),
      ['ntr'],
    )
  })
})
