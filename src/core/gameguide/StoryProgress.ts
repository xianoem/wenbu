import { Match, Predicate } from 'effect'
import type { FactStatus } from '#contract/GameGuide'
import type { GuideState } from './GuideState'
import type {
  CompareOp,
  Condition,
  FactPlace,
  IndexEvent,
  IndexFact,
  KnowledgeIndex,
} from './KnowledgeIndex'

export interface StoryProgress {
  readonly holds: (condition: Condition, place: FactPlace) => boolean | undefined
  readonly activePage: (event: IndexEvent) => number
  readonly factStatus: (fact: IndexFact) => FactStatus
  readonly missingItems: (event: IndexEvent, page: number) => ReadonlyArray<Condition> | undefined
}

const comparisons: Record<CompareOp, (left: number, right: number) => boolean> = {
  '==': (left, right) => left === right,
  '!=': (left, right) => left !== right,
  '>=': (left, right) => left >= right,
  '<=': (left, right) => left <= right,
  '>': (left, right) => left > right,
  '<': (left, right) => left < right,
}

const compare = (left: number, op: CompareOp, right: number) => comparisons[op](left, right)

const rank: Record<FactStatus, number> = { open: 0, needs: 1, later: 2, passed: 3, unknown: 4 }

const best = (statuses: ReadonlyArray<FactStatus>): FactStatus =>
  statuses.reduce<FactStatus>(
    (found, status) => (rank[status] < rank[found] ? status : found),
    'unknown',
  )

const eventKey = (mapId: number, eventId: number) => `${mapId}:${eventId}`

export const makeStoryProgress = (index: KnowledgeIndex, state: GuideState): StoryProgress => {
  const switches = new Set(state.switches)
  const variables = new Map(state.variables)

  const selfSwitches = new Set(
    state.selfSwitches.map(([mapId, eventId, letter]) => `${mapId},${eventId},${letter}`),
  )

  const held = new Map(state.items.map(([of, id, count]) => [`${of}:${id}`, count]))
  const party = new Set(state.party)
  const livePages = new Map(state.events.map(([eventId, , , page]) => [eventId, page]))
  const events = new Map(index.events.map((event) => [eventKey(event.mapId, event.id), event]))
  const callers = new Map<number, Array<IndexFact>>()

  for (const fact of index.facts) {
    if (fact.kind === 'calls' && fact.common !== undefined) {
      callers.set(fact.common, [...(callers.get(fact.common) ?? []), fact])
    }
  }

  const numberOf = (id: number) => {
    const value = variables.get(id) ?? 0

    return Predicate.isNumber(value) ? value : undefined
  }

  const unknown = () => undefined

  const holds = (condition: Condition, place: FactPlace): boolean | undefined =>
    Match.value(condition).pipe(
      Match.discriminatorsExhaustive('kind')({
        switch: (found) => switches.has(found.id) === found.on,
        variable: (found) => {
          const left = numberOf(found.id)
          const right = found.against === undefined ? found.value : numberOf(found.against)

          return left === undefined || right === undefined
            ? undefined
            : compare(left, found.op, right)
        },
        'self-switch': (found) =>
          place.type === 'event'
            ? selfSwitches.has(`${place.mapId},${place.eventId},${found.letter}`) === found.on
            : undefined,
        item: (found) => (held.get(`${found.of}:${found.id}`) ?? 0) > 0 === found.has,
        actor: (found) => party.has(found.id) === found.inParty,
        gold: (found) => compare(state.gold, found.op, found.value),
        choice: unknown,
        script: unknown,
      }),
    )

  const pageHolds = (event: IndexEvent, page: number) =>
    (event.pages[page]?.conditions ?? []).every(
      (condition) =>
        holds(condition, { type: 'event', mapId: event.mapId, eventId: event.id, page }) !== false,
    )

  const activePage = (event: IndexEvent) => {
    if (event.mapId === state.mapId) {
      return livePages.get(event.id) ?? -1
    }

    for (let page = event.pages.length - 1; page >= 0; page--) {
      if (pageHolds(event, page)) {
        return page
      }
    }

    return -1
  }

  const statusAt = (fact: IndexFact, depth: number): FactStatus => {
    const place = fact.place

    if (place.type === 'common') {
      const common = index.commons.find((candidate) => candidate.id === place.id)

      if (common !== undefined && common.trigger > 0) {
        return switches.has(common.switchId) ? 'open' : 'later'
      }

      return depth > 3
        ? 'unknown'
        : best((callers.get(place.id) ?? []).map((caller) => statusAt(caller, depth + 1)))
    }

    const event = events.get(eventKey(place.mapId, place.eventId))

    if (event === undefined) {
      return 'unknown'
    }

    const active = activePage(event)

    if (active === -1 || place.page > active) {
      return 'later'
    }

    if (place.page < active) {
      return 'passed'
    }

    return fact.gate.some((condition) => holds(condition, place) === false) ? 'needs' : 'open'
  }

  const missingItems = (event: IndexEvent, page: number) => {
    const conditions = event.pages[page]?.conditions ?? []
    const place: FactPlace = { type: 'event', mapId: event.mapId, eventId: event.id, page }
    const failing = conditions.filter((condition) => holds(condition, place) === false)

    return failing.length > 0 && failing.every((condition) => condition.kind === 'item')
      ? failing
      : undefined
  }

  return { holds, activePage, factStatus: (fact) => statusAt(fact, 0), missingItems }
}
