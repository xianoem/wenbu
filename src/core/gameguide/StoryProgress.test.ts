import { describe, expect, it } from '@effect/vitest'
import type { GuideState } from './GuideState'
import type { IndexEvent, IndexFact, KnowledgeIndex } from './KnowledgeIndex'
import { makeStoryProgress } from './StoryProgress'

const event = (mapId: number, id: number, pages: IndexEvent['pages']): IndexEvent => ({
  mapId,
  id,
  name: `Event ${id}`,
  x: 0,
  y: 0,
  pages,
})

const page = (conditions: IndexEvent['pages'][number]['conditions']) => ({
  conditions,
  trigger: 0,
  graphic: true,
})

const cook = event(2, 1, [
  page([]),
  page([{ kind: 'switch', id: 12, on: true }]),
  page([{ kind: 'self-switch', letter: 'A', on: true }]),
])

const herbalist = event(2, 2, [page([]), page([{ kind: 'item', of: 'item', id: 7, has: true }])])

const fact = (place: IndexFact['place'], gate: IndexFact['gate'] = []): IndexFact => ({
  kind: 'gives',
  place,
  gate,
  item: { of: 'item', id: 7 },
})

const index: KnowledgeIndex = {
  version: 1,
  title: '',
  maps: [],
  events: [cook, herbalist, event(1, 5, [page([])])],
  commons: [{ id: 3, name: 'Reward', trigger: 0, switchId: 0 }],
  facts: [
    { kind: 'calls', place: { type: 'event', mapId: 2, eventId: 1, page: 1 }, gate: [], common: 3 },
  ],
  items: [],
  weapons: [],
  armors: [],
  enemies: [],
  troops: [],
  actors: [],
  states: [],
  skills: [],
  switches: [],
  variables: [],
  elements: [],
  lines: [],
}

const state = (changes: Partial<GuideState> = {}): GuideState => ({
  mapId: 1,
  mapName: 'Inn',
  x: 0,
  y: 0,
  inBattle: false,
  troopId: 0,
  enemies: [],
  switches: [12],
  variables: [],
  selfSwitches: [],
  party: [1],
  items: [['item', 5, 1]],
  gold: 100,
  playtime: 0,
  events: [],
  dialogue: [],
  ...changes,
})

const at = (eventId: number, pageIndex: number) =>
  ({ type: 'event', mapId: 2, eventId, page: pageIndex }) as const

describe('Story Progress', () => {
  it('runs the highest page whose conditions hold, as the engines do', () => {
    const progress = makeStoryProgress(index, state())

    expect(progress.activePage(cook)).toBe(1)
    expect(progress.factStatus(fact(at(1, 0)))).toBe('passed')
    expect(progress.factStatus(fact(at(1, 1)))).toBe('open')
    expect(progress.factStatus(fact(at(1, 2)))).toBe('later')

    const finished = makeStoryProgress(index, state({ selfSwitches: [[2, 1, 'A']] }))

    expect(finished.factStatus(fact(at(1, 1)))).toBe('passed')
  })

  it('says a fact needs something when a branch above it does not hold', () => {
    const progress = makeStoryProgress(index, state())

    expect(
      progress.factStatus(fact(at(1, 1), [{ kind: 'item', of: 'item', id: 5, has: true }])),
    ).toBe('open')

    expect(progress.factStatus(fact(at(1, 1), [{ kind: 'gold', op: '>=', value: 500 }]))).toBe(
      'needs',
    )

    expect(progress.factStatus(fact(at(1, 1), [{ kind: 'choice', text: 'Help' }]))).toBe('open')
  })

  it('takes the page the game reports for events on the current map', () => {
    const progress = makeStoryProgress(index, state({ mapId: 2, events: [[1, 0, 0, 2]] }))

    expect(progress.activePage(cook)).toBe(2)
    expect(progress.activePage(herbalist)).toBe(-1)
  })

  it('judges a common event by the events that call it', () => {
    const progress = makeStoryProgress(index, state())

    expect(progress.factStatus(fact({ type: 'common', id: 3 }))).toBe('open')

    expect(
      makeStoryProgress(index, state({ switches: [] })).factStatus(fact({ type: 'common', id: 3 })),
    ).toBe('later')
  })

  it('finds pages that wait only on an item the player lacks', () => {
    const progress = makeStoryProgress(index, state())

    expect(progress.missingItems(herbalist, 1)).toEqual([
      { kind: 'item', of: 'item', id: 7, has: true },
    ])

    expect(progress.missingItems(cook, 2)).toBeUndefined()
  })
})
