import { Match } from 'effect'
import type {
  FactStatus,
  FinderResults,
  FinderSubject,
  GameFact,
  GateItem,
  GuidePlace,
  GuideSubject,
  MapSketch,
  SketchMark,
  SketchMarkKind,
} from '#contract/GameGuide'
import type { GuideState } from './GuideState'
import type {
  Condition,
  FactPlace,
  IndexEnemy,
  IndexEvent,
  IndexFact,
  IndexLine,
  IndexThing,
  ItemKind,
  KnowledgeIndex,
} from './KnowledgeIndex'
import { makeStoryProgress, type StoryProgress } from './StoryProgress'

export interface GuideNames {
  readonly states: ReadonlyArray<string>
  readonly skills: ReadonlyArray<string>
  readonly actors: ReadonlyArray<string>
  readonly switches: ReadonlyArray<string>
  readonly variables: ReadonlyArray<string>
  readonly commonEvents: ReadonlyArray<string>
}

export interface GuideBook {
  readonly index: KnowledgeIndex
  readonly state: GuideState
  readonly mapName: (mapId: number) => string
  readonly findMap: (map: number | string | null | undefined) => number | undefined
  readonly resolve: (id: string) => GameFact | undefined
  readonly find: (query: string) => FinderResults
  readonly subjects: (query: string) => ReadonlyArray<FinderSubject>
  readonly whereToGet: (of: ItemKind, id: number) => ReadonlyArray<GameFact>
  readonly whatNeeds: (of: ItemKind, id: number) => ReadonlyArray<GameFact>
  readonly whatSets: (switchId: number) => ReadonlyArray<GameFact>
  readonly whatOpensAfter: (switchId: number) => ReadonlyArray<GameFact>
  readonly people: (query: string) => ReadonlyArray<GameFact>
  readonly places: (query: string) => ReadonlyArray<GameFact>
  readonly dialogue: (queries: ReadonlyArray<string>, limit?: number) => ReadonlyArray<GameFact>
  readonly names: (queries: ReadonlyArray<string>) => GuideNames
  readonly characters: () => ReadonlyArray<string>
  readonly around: (mapId: number) => ReadonlyArray<GameFact>
  readonly nextSteps: (limit: number) => ReadonlyArray<GameFact>
  readonly enemies: () => ReadonlyArray<GameFact>
  readonly enemyCard: (enemyId: number) => GameFact | undefined
  readonly recentDialogue: () => ReadonlyArray<GameFact>
  readonly sketch: (mapId: number, target?: { readonly x: number; readonly y: number }) => MapSketch
  readonly route: (fromMapId: number, toMapId: number) => ReadonlyArray<string>
  readonly progress: StoryProgress
}

const statusRank: Record<FactStatus, number> = {
  open: 0,
  needs: 1,
  later: 3,
  passed: 4,
  unknown: 2,
}

const itemSubjects: ReadonlyArray<ItemKind> = ['item', 'weapon', 'armor']

const opWords: Record<string, string> = {
  '==': 'is',
  '!=': 'is not',
  '>=': 'is at least',
  '<=': 'is at most',
  '>': 'is above',
  '<': 'is below',
}

const LIST_LIMIT = 12

const isItemKind = (of: string): of is ItemKind => itemSubjects.some((kind) => kind === of)

const normalise = (text: string) => text.normalize('NFKC').toLowerCase()

const eventKey = (mapId: number, eventId: number) => `${mapId}:${eventId}`

const pageKey = (mapId: number, eventId: number, page: number) => `${mapId}:${eventId}:${page}`

const push = <K, V>(map: Map<K, Array<V>>, key: K, value: V) => {
  const found = map.get(key)

  if (found === undefined) {
    map.set(key, [value])
  } else {
    found.push(value)
  }
}

export const makeGuideBook = (
  index: KnowledgeIndex,
  state: GuideState,
  translations: ReadonlyMap<string, string>,
): GuideBook => {
  const progress = makeStoryProgress(index, state)
  const maps = new Map(index.maps.map((map) => [map.id, map]))
  const events = new Map(index.events.map((event) => [eventKey(event.mapId, event.id), event]))
  const pageFacts = new Map<string, Array<number>>()
  const itemFacts = new Map<string, Array<number>>()
  const switchSetters = new Map<number, Array<number>>()
  const callers = new Map<number, Array<number>>()
  const eventLines = new Map<string, Array<number>>()
  const exits = new Map<number, Set<number>>()

  const things: Record<ItemKind, ReadonlyMap<number, IndexThing>> = {
    item: new Map(index.items.map((thing) => [thing.id, thing])),
    weapon: new Map(index.weapons.map((thing) => [thing.id, thing])),
    armor: new Map(index.armors.map((thing) => [thing.id, thing])),
  }

  const enemies = new Map(index.enemies.map((enemy) => [enemy.id, enemy]))
  const actors = new Map(index.actors.map((actor) => [actor.id, actor]))
  const troops = new Map(index.troops.map((troop) => [troop.id, troop]))
  const held = new Map(state.items.map(([of, id, count]) => [`${of}:${id}`, count]))

  index.facts.forEach((fact, position) => {
    const { place } = fact

    if (place.type === 'event') {
      push(pageFacts, pageKey(place.mapId, place.eventId, place.page), position)
    }

    if (fact.item !== undefined) {
      push(itemFacts, `${fact.item.of}:${fact.item.id}`, position)
    }

    if (fact.switchId !== undefined && fact.value === true) {
      push(switchSetters, fact.switchId, position)
    }

    if (fact.kind === 'calls' && fact.common !== undefined) {
      push(callers, fact.common, position)
    }

    if (
      fact.kind === 'leads-to' &&
      fact.to !== undefined &&
      place.type === 'event' &&
      place.mapId !== fact.to.mapId
    ) {
      exits.set(place.mapId, (exits.get(place.mapId) ?? new Set()).add(fact.to.mapId))
    }
  })

  index.lines.forEach((line, position) => {
    if (line.place.type === 'event') {
      push(eventLines, eventKey(line.place.mapId, line.place.eventId), position)
    }
  })

  const tr = (entry: string | undefined, source: string) => {
    const translated = entry === undefined ? undefined : translations.get(entry)

    return translated === undefined || translated.trim() === '' ? source : translated
  }

  const mapName = (mapId: number) => {
    const map = maps.get(mapId)

    if (map === undefined) {
      return `Map ${mapId}`
    }

    const display = tr(map.displayEntry, map.displayName)

    return display.trim() === '' ? tr(map.nameEntry, map.name) || `Map ${mapId}` : display
  }

  const thingName = (of: ItemKind, id: number) => {
    const thing = things[of].get(id)

    return thing === undefined ? `${of} ${id}` : tr(thing.entry, thing.name)
  }

  const enemyName = (id: number) => {
    const enemy = enemies.get(id)

    return enemy === undefined ? `Enemy ${id}` : tr(enemy.entry, enemy.name)
  }

  const actorName = (id: number) => {
    const actor = actors.get(id)

    return actor === undefined ? `Actor ${id}` : tr(actor.entry, actor.name)
  }

  const troopName = (id: number) => {
    const troop = troops.get(id)
    const members = [...new Set(troop?.enemies ?? [])].map((enemyId) => enemyName(enemyId))

    return members.length > 0 ? members.join(', ') : troop?.name || `Troop ${id}`
  }

  const switchName = (id: number) => index.switches[id]?.trim() || `Switch ${id}`

  const variableName = (id: number) => index.variables[id]?.trim() || `Variable ${id}`

  const plainText = (text: string) =>
    text
      .replace(/\\N\[(\d+)\]/gi, (_, id: string) => actorName(Number(id)))
      .replace(/\\V\[(\d+)\]/gi, (_, id: string) =>
        String(state.variables.find(([key]) => key === Number(id))?.[1] ?? 0),
      )
      .replace(/\\N<([^>]*)>/gi, '$1')
      .replace(/\\[A-Za-z]+\[[^\]]*\]/g, '')
      .replace(/\\[A-Za-z]+<[^>]*>/g, '')
      .replace(/\\[{}.|!><^$G]/g, '')
      .trim()

  const lineText = (line: IndexLine) =>
    plainText(tr(line.entry === '' ? undefined : line.entry, line.text))

  const labelOf = (event: IndexEvent) => {
    const speaker = (eventLines.get(eventKey(event.mapId, event.id)) ?? [])
      .map((position) => index.lines[position]?.speaker ?? '')
      .find((name) => name !== '')

    return speaker === undefined ? event.name : plainText(speaker)
  }

  const subjectMakers: Record<NonNullable<IndexFact['item']>['of'], (id: number) => GuideSubject> =
    {
      item: (id) => ({ kind: 'item', id, name: thingName('item', id) }),
      weapon: (id) => ({ kind: 'weapon', id, name: thingName('weapon', id) }),
      armor: (id) => ({ kind: 'armor', id, name: thingName('armor', id) }),
      troop: (id) => ({ kind: 'troop', id, name: troopName(id) }),
      actor: (id) => ({ kind: 'actor', id, name: actorName(id) }),
      gold: () => ({ kind: 'gold', id: 0, name: 'gold' }),
    }

  const subjectOf = (item: NonNullable<IndexFact['item']>) => subjectMakers[item.of](item.id)

  const eventPlace = (mapId: number, eventId: number): GuidePlace => {
    const event = events.get(eventKey(mapId, eventId))

    return {
      mapId,
      mapName: mapName(mapId),
      eventId,
      ...(event === undefined ? {} : { eventName: labelOf(event), x: event.x, y: event.y }),
    }
  }

  const eventPlaceOf = (
    place: FactPlace,
    depth = 0,
  ): Extract<FactPlace, { type: 'event' }> | undefined => {
    if (place.type === 'event') {
      return place
    }

    if (depth > 3) {
      return undefined
    }

    const found = (callers.get(place.id) ?? [])
      .map((position) => index.facts[position])
      .flatMap((caller) => {
        const resolved = caller === undefined ? undefined : eventPlaceOf(caller.place, depth + 1)

        return resolved === undefined ? [] : [resolved]
      })

    return found[0]
  }

  const comparedTo = (found: Extract<Condition, { kind: 'variable' }>) =>
    found.against === undefined ? String(found.value) : `"${variableName(found.against)}"`

  const conditionText = (condition: Condition): string =>
    Match.value(condition).pipe(
      Match.discriminatorsExhaustive('kind')({
        switch: (found) => `"${switchName(found.id)}" is ${found.on ? 'on' : 'off'}`,
        variable: (found) =>
          `"${variableName(found.id)}" ${opWords[found.op] ?? found.op} ${comparedTo(found)}`,
        'self-switch': (found) =>
          found.on ? `Done here before (${found.letter})` : `Not done here yet (${found.letter})`,
        item: (found) => `${found.has ? 'Has' : "Doesn't have"} ${thingName(found.of, found.id)}`,
        actor: (found) => `${actorName(found.id)} ${found.inParty ? 'is' : 'is not'} in the party`,
        gold: (found) => `Gold ${opWords[found.op] ?? found.op} ${found.value}`,
        choice: (found) => `Choose "${plainText(found.text)}"`,
        script: () => 'A check the game makes in a script',
      }),
    )

  const gateOf = (conditions: ReadonlyArray<Condition>, place: FactPlace): Array<GateItem> =>
    conditions.map((condition) => {
      const holds = progress.holds(condition, place)

      return { text: conditionText(condition), ...(holds === undefined ? {} : { holds }) }
    })

  const pageGate = (place: FactPlace) => {
    if (place.type !== 'event') {
      return []
    }

    return events.get(eventKey(place.mapId, place.eventId))?.pages[place.page]?.conditions ?? []
  }

  const listPrice = (item: IndexFact['item']) =>
    item !== undefined && isItemKind(item.of) ? things[item.of].get(item.id)?.price : undefined

  const setsSummary = (fact: IndexFact) => {
    if (fact.switchId !== undefined) {
      return `Turns "${switchName(fact.switchId)}" ${fact.value === true ? 'on' : 'off'}`
    }

    if (fact.variableId !== undefined) {
      return fact.value === undefined
        ? `Changes "${variableName(fact.variableId)}"`
        : `Sets "${variableName(fact.variableId)}" to ${String(fact.value)}`
    }

    return fact.value === true ? 'Marks itself as done' : 'Resets itself'
  }

  const moves = (verb: string, fact: IndexFact, subject: GuideSubject | undefined) => {
    if (subject?.kind === 'gold') {
      return `${verb} ${fact.amount ?? 'some'} gold`
    }

    return `${verb} ${subject?.name ?? 'something'}${fact.amount === undefined ? '' : ` ×${fact.amount}`}`
  }

  const summaries: Record<
    IndexFact['kind'],
    (fact: IndexFact, subject: GuideSubject | undefined) => string
  > = {
    gives: (fact, subject) => moves('Gives', fact, subject),
    takes: (fact, subject) => moves('Takes', fact, subject),
    sells: (fact, subject) => {
      const price = fact.price ?? listPrice(fact.item)

      return `Sells ${subject?.name ?? 'something'}${price === undefined ? '' : ` for ${price} G`}`
    },
    fights: (_, subject) => `Battle with ${subject?.name ?? 'enemies'}`,
    'leads-to': (fact) =>
      `Leads to ${fact.to === undefined ? 'another map' : mapName(fact.to.mapId)}`,
    joins: (_, subject) => `${subject?.name ?? 'Someone'} joins the party`,
    leaves: (_, subject) => `${subject?.name ?? 'Someone'} leaves the party`,
    sets: (fact) => setsSummary(fact),
    script: (fact) =>
      fact.note === undefined || fact.note === ''
        ? "Runs game logic Wenbu can't read"
        : `Runs game logic Wenbu can't read (${fact.note})`,
    calls: () => 'Runs a common event',
  }

  const summaryOf = (fact: IndexFact, subject: GuideSubject | undefined) =>
    summaries[fact.kind](fact, subject)

  const factAt = (position: number): GameFact | undefined => {
    const fact = index.facts[position]

    if (fact === undefined || fact.kind === 'calls') {
      return undefined
    }

    const subject = fact.item === undefined ? undefined : subjectOf(fact.item)
    const place = eventPlaceOf(fact.place)
    const conditions = [...pageGate(place ?? fact.place), ...fact.gate]

    return {
      id: `f${position}`,
      kind: fact.kind,
      summary: summaryOf(fact, subject),
      ...(place === undefined ? {} : { place: eventPlace(place.mapId, place.eventId) }),
      ...(subject === undefined ? {} : { subject }),
      ...(fact.amount === undefined ? {} : { amount: fact.amount }),
      ...(fact.to === undefined
        ? {}
        : {
            to: {
              mapId: fact.to.mapId,
              mapName: mapName(fact.to.mapId),
              x: fact.to.x,
              y: fact.to.y,
            },
          }),
      gate: gateOf(conditions, place ?? fact.place),
      status: progress.factStatus(fact),
    }
  }

  const eventStatus = (event: IndexEvent): FactStatus => {
    const active = progress.activePage(event)

    return active === -1 ? 'later' : 'open'
  }

  const personFact = (event: IndexEvent): GameFact => {
    const active = progress.activePage(event)
    const page = Math.max(active, 0)

    const said = (eventLines.get(eventKey(event.mapId, event.id)) ?? [])
      .map((position) => index.lines[position])
      .find(
        (line) =>
          line !== undefined &&
          line.kind === 'dialogue' &&
          line.place.type === 'event' &&
          line.place.page === page,
      )

    const label = labelOf(event)

    return {
      id: `e${event.mapId}.${event.id}`,
      kind: 'person',
      summary: label,
      place: eventPlace(event.mapId, event.id),
      gate: gateOf(event.pages[page]?.conditions ?? [], {
        type: 'event',
        mapId: event.mapId,
        eventId: event.id,
        page,
      }),
      status: eventStatus(event),
      ...(said === undefined ? {} : { text: lineText(said) }),
    }
  }

  const lineFact = (position: number): GameFact | undefined => {
    const line = index.lines[position]

    if (line === undefined) {
      return undefined
    }

    const place = eventPlaceOf(line.place)
    const text = lineText(line)

    return {
      id: `l${position}`,
      kind: 'dialogue',
      summary:
        line.speaker === ''
          ? (text.split('\n')[0] ?? '')
          : `${plainText(line.speaker)}: ${text.split('\n')[0] ?? ''}`,
      ...(place === undefined ? {} : { place: eventPlace(place.mapId, place.eventId) }),
      gate: [],
      status:
        line.place.type === 'event'
          ? progress.factStatus({ kind: 'script', place: line.place, gate: [] })
          : 'unknown',
      text,
    }
  }

  const enemyMaps = (enemy: IndexEnemy) => {
    const troopIds = new Set(
      index.troops.filter((troop) => troop.enemies.includes(enemy.id)).map((troop) => troop.id),
    )

    const found = new Set<number>()

    for (const map of index.maps) {
      if (map.encounters.some((troopId) => troopIds.has(troopId))) {
        found.add(map.id)
      }
    }

    for (const troopId of troopIds) {
      for (const position of itemFacts.get(`troop:${troopId}`) ?? []) {
        const place = eventPlaceOf(index.facts[position]?.place ?? { type: 'common', id: 0 })

        if (place !== undefined) {
          found.add(place.mapId)
        }
      }
    }

    return [...found]
  }

  const dropFact = (enemy: IndexEnemy, drop: number): GameFact | undefined => {
    const item = enemy.drops[drop]

    if (item === undefined) {
      return undefined
    }

    const mapId = enemyMaps(enemy)[0]

    return {
      id: `d${enemy.id}.${drop}`,
      kind: 'drops',
      summary: `${enemyName(enemy.id)} drops ${thingName(item.of, item.id)} (1 in ${item.denominator})`,
      ...(mapId === undefined ? {} : { place: { mapId, mapName: mapName(mapId) } }),
      subject: { kind: item.of, id: item.id, name: thingName(item.of, item.id) },
      gate: [],
      status: 'open',
    }
  }

  const enemyCard = (enemyId: number): GameFact | undefined => {
    const enemy = enemies.get(enemyId)

    if (enemy === undefined) {
      return undefined
    }

    const element = (id: number) => index.elements[id]?.trim() || `element ${id}`
    const weak = enemy.weak.map((id) => element(id))
    const resists = enemy.resists.map((id) => element(id))

    const drops = enemy.drops.map(
      (drop) => `${thingName(drop.of, drop.id)} (1 in ${drop.denominator})`,
    )

    const where = enemyMaps(enemy)
      .slice(0, 4)
      .map((mapId) => mapName(mapId))

    return {
      id: `n${enemy.id}`,
      kind: 'fights',
      summary: `${enemyName(enemy.id)} · HP ${enemy.hp}`,
      subject: { kind: 'enemy', id: enemy.id, name: enemyName(enemy.id) },
      gate: [],
      status: 'open',
      text: [
        weak.length > 0 ? `Weak to ${weak.join(', ')}` : '',
        resists.length > 0 ? `Resists ${resists.join(', ')}` : '',
        drops.length > 0 ? `Drops ${drops.join(', ')}` : 'Drops nothing',
        `${enemy.exp} EXP, ${enemy.gold} G`,
        where.length > 0 ? `Found in ${where.join(', ')}` : '',
      ]
        .filter((part) => part !== '')
        .join('. '),
    }
  }

  const mapFact = (mapId: number): GameFact => ({
    id: `m${mapId}`,
    kind: 'person',
    summary: mapName(mapId),
    place: { mapId, mapName: mapName(mapId) },
    gate: [],
    status: 'unknown',
  })

  const resolvers: Record<string, (first: number, second: number) => GameFact | undefined> = {
    f: (position) => factAt(position),
    e: (mapId, eventId) => {
      const event = events.get(eventKey(mapId, eventId))

      return event === undefined ? undefined : personFact(event)
    },
    l: (position) => lineFact(position),
    d: (enemyId, drop) => {
      const enemy = enemies.get(enemyId)

      return enemy === undefined ? undefined : dropFact(enemy, drop)
    },
    n: (enemyId) => enemyCard(enemyId),
    m: (mapId) => (maps.has(mapId) ? mapFact(mapId) : undefined),
  }

  const resolve = (id: string): GameFact | undefined => {
    const [, kind = '', first, second] = /^([feldnm])(\d+)(?:\.(\d+))?$/.exec(id) ?? []

    return resolvers[kind]?.(Number(first), Number(second))
  }

  const hops = (fromMapId: number) => {
    const distance = new Map<number, number>([[fromMapId, 0]])
    const previous = new Map<number, number>()
    const queue = [fromMapId]

    while (queue.length > 0) {
      const current = queue.shift() ?? fromMapId

      for (const next of exits.get(current) ?? []) {
        if (!distance.has(next)) {
          distance.set(next, (distance.get(current) ?? 0) + 1)
          previous.set(next, current)
          queue.push(next)
        }
      }
    }

    return { distance, previous }
  }

  const fromHere = hops(state.mapId)

  const route = (fromMapId: number, toMapId: number) => {
    const { previous } = fromMapId === state.mapId ? fromHere : hops(fromMapId)

    if (fromMapId === toMapId || !previous.has(toMapId)) {
      return fromMapId === toMapId ? [mapName(toMapId)] : []
    }

    const path = [toMapId]

    while (path[0] !== fromMapId && path.length < 12) {
      const step = previous.get(path[0] ?? fromMapId)

      if (step === undefined) {
        break
      }

      path.unshift(step)
    }

    return path.map((mapId) => mapName(mapId))
  }

  const distanceOf = (fact: GameFact) =>
    fact.place === undefined ? 99 : (fromHere.distance.get(fact.place.mapId) ?? 50)

  const byRelevance = (left: GameFact, right: GameFact) =>
    statusRank[left.status] - statusRank[right.status] || distanceOf(left) - distanceOf(right)

  const sorted = (facts: ReadonlyArray<GameFact | undefined>) =>
    facts
      .filter((fact): fact is GameFact => fact !== undefined)
      .toSorted(byRelevance)
      .slice(0, LIST_LIMIT)

  const whereToGet = (of: ItemKind, id: number) => {
    const given = (itemFacts.get(`${of}:${id}`) ?? []).filter((position) => {
      const kind = index.facts[position]?.kind

      return kind === 'gives' || kind === 'sells'
    })

    const drops = index.enemies.flatMap((enemy) =>
      enemy.drops.flatMap((drop, position) =>
        drop.of === of && drop.id === id ? [dropFact(enemy, position)] : [],
      ),
    )

    return sorted([...given.map((position) => factAt(position)), ...drops])
  }

  const wantedStatus = (event: IndexEvent, page: number): FactStatus => {
    if (page === progress.activePage(event)) {
      return 'open'
    }

    return progress.missingItems(event, page) === undefined ? 'later' : 'needs'
  }

  const whatNeeds = (of: ItemKind, id: number) => {
    const pages = index.events.flatMap((event) =>
      event.pages.flatMap((page, pageIndex) =>
        page.conditions.some(
          (condition) => condition.kind === 'item' && condition.of === of && condition.id === id,
        )
          ? [
              {
                ...personFact(event),
                summary: `${labelOf(event)} wants ${thingName(of, id)}`,
                status: wantedStatus(event, pageIndex),
              },
            ]
          : [],
      ),
    )

    const branches = index.facts.flatMap((fact, position) =>
      fact.gate.some(
        (condition) => condition.kind === 'item' && condition.of === of && condition.id === id,
      ) ||
      (fact.kind === 'takes' && fact.item?.of === of && fact.item.id === id)
        ? [factAt(position)]
        : [],
    )

    return sorted([...pages, ...branches])
  }

  const whatSets = (switchId: number) =>
    sorted((switchSetters.get(switchId) ?? []).map((position) => factAt(position)))

  const whatOpensAfter = (switchId: number) =>
    sorted(
      index.events.flatMap((event) =>
        event.pages.some((page) =>
          page.conditions.some(
            (condition) => condition.kind === 'switch' && condition.id === switchId && condition.on,
          ),
        )
          ? [personFact(event)]
          : [],
      ),
    )

  const matches = (query: string, ...texts: ReadonlyArray<string>) => {
    const wanted = normalise(query.trim())

    return wanted !== '' && texts.some((text) => normalise(text).includes(wanted))
  }

  const subjects = (query: string): ReadonlyArray<FinderSubject> => {
    const found: Array<FinderSubject> = []

    for (const of of itemSubjects) {
      for (const thing of things[of].values()) {
        if (matches(query, thing.name, tr(thing.entry, thing.name))) {
          found.push({
            subject: { kind: of, id: thing.id, name: thingName(of, thing.id) },
            description: plainText(thing.description),
            held: held.get(`${of}:${thing.id}`) ?? 0,
            facts: whereToGet(of, thing.id).slice(0, 5),
          })
        }
      }
    }

    for (const enemy of index.enemies) {
      const card = enemyCard(enemy.id)

      if (card !== undefined && matches(query, enemy.name, enemyName(enemy.id))) {
        found.push({
          subject: { kind: 'enemy', id: enemy.id, name: enemyName(enemy.id) },
          description: card.text ?? '',
          facts: [card],
        })
      }
    }

    return found.slice(0, 6)
  }

  const people = (query: string) =>
    sorted(
      index.events
        .filter((event) => matches(query, event.name, labelOf(event)))
        .map((event) => personFact(event)),
    )

  const places = (query: string) =>
    sorted(
      index.maps
        .filter((map) => matches(query, map.name, map.displayName, mapName(map.id)))
        .map((map) => mapFact(map.id)),
    )

  const dialogue = (queries: ReadonlyArray<string>, limit = LIST_LIMIT) => {
    const found: Array<GameFact> = []

    for (let position = 0; position < index.lines.length && found.length < limit; position++) {
      const line = index.lines[position]

      if (
        line !== undefined &&
        line.kind !== 'comment' &&
        queries.some((query) => matches(query, line.text, tr(line.entry, '')))
      ) {
        const fact = lineFact(position)

        if (fact !== undefined) {
          found.push(fact)
        }
      }
    }

    return found
  }

  const actorLine = (actor: KnowledgeIndex['actors'][number]) => {
    const about = plainText(`${actor.nickname} ${actor.profile}`.replace(/s+/g, ' ').trim())
    const translated = actorName(actor.id)
    const original = translated === actor.name ? '' : ` (${actor.name})`

    return `#${actor.id} ${translated}${original}${about === '' ? '' : `: ${about}`}`
  }

  const characters = () => index.actors.slice(0, 20).map((actor) => actorLine(actor))

  const names = (queries: ReadonlyArray<string>) => {
    const hit = (...texts: ReadonlyArray<string>) =>
      queries.some((query) => matches(query, ...texts))

    const line = (id: number, name: string, translated: string, more: string) => {
      const original = translated === name ? '' : ` (${name})`

      return `#${id} ${translated}${original}${more === '' ? '' : `: ${more}`}`
    }

    const namedLines = (list: KnowledgeIndex['states']) =>
      list
        .filter((item) => hit(item.name, tr(item.entry, item.name), item.description))
        .slice(0, 10)
        .map((item) =>
          line(item.id, item.name, tr(item.entry, item.name), plainText(item.description)),
        )

    const developerNames = (list: ReadonlyArray<string>) =>
      list
        .flatMap((name, id) => (name.trim() !== '' && hit(name) ? [`#${id} ${name}`] : []))
        .slice(0, 15)

    return {
      states: namedLines(index.states),
      skills: namedLines(index.skills),
      actors: index.actors
        .filter((actor) =>
          hit(actor.name, tr(actor.entry, actor.name), actor.nickname, actor.profile),
        )
        .slice(0, 10)
        .map((actor) => actorLine(actor)),
      switches: developerNames(index.switches),
      variables: developerNames(index.variables),
      commonEvents: index.commons
        .filter((common) => hit(common.name))
        .slice(0, 10)
        .map((common) => `#${common.id} ${common.name}`),
    }
  }

  const findMap = (map: number | string | null | undefined) => {
    if (map === null || map === undefined) {
      return undefined
    }

    const id = Number(String(map).trim().replace(/^m/i, ''))

    if (Number.isInteger(id) && maps.has(id)) {
      return id
    }

    const wanted = normalise(String(map).trim())

    const exact = index.maps.find((candidate) =>
      [candidate.name, candidate.displayName, mapName(candidate.id)].some(
        (name) => normalise(name) === wanted,
      ),
    )

    return exact?.id ?? places(String(map))[0]?.place?.mapId
  }

  const find = (query: string): FinderResults => ({
    query,
    subjects: subjects(query),
    people: people(query).slice(0, 5),
    places: places(query).slice(0, 5),
    dialogue: dialogue([query], 5),
  })

  const markKind = (
    facts: ReadonlyArray<IndexFact>,
    event: IndexEvent,
    page: number,
  ): SketchMarkKind => {
    if (facts.some((fact) => fact.kind === 'sells')) {
      return 'shop'
    }

    if (facts.some((fact) => fact.kind === 'leads-to')) {
      return 'exit'
    }

    if (facts.some((fact) => fact.kind === 'fights')) {
      return 'battle'
    }

    if (facts.some((fact) => fact.kind === 'gives')) {
      return 'thing'
    }

    return event.pages[page]?.graphic === true ? 'person' : 'other'
  }

  const activePositions = (event: IndexEvent, page: number) =>
    pageFacts.get(pageKey(event.mapId, event.id, page)) ?? []

  const activeFacts = (event: IndexEvent, page: number) =>
    activePositions(event, page).flatMap((position) => {
      const fact = index.facts[position]

      return fact === undefined ? [] : [fact]
    })

  const around = (mapId: number) =>
    index.events
      .filter((event) => event.mapId === mapId)
      .flatMap((event): ReadonlyArray<GameFact> => {
        const page = progress.activePage(event)

        if (page === -1) {
          return []
        }

        const facts = activeFacts(event, page)
        const kind = markKind(facts, event, page)

        if (kind === 'other') {
          return []
        }

        const useful = (pageFacts.get(pageKey(event.mapId, event.id, page)) ?? [])
          .map((position) => factAt(position))
          .filter(
            (fact): fact is GameFact =>
              fact !== undefined && fact.kind !== 'sets' && fact.kind !== 'script',
          )

        return useful.length > 0 ? useful.slice(0, 3) : [personFact(event)]
      })
      .slice(0, 30)

  const nextSteps = (limit: number) => {
    const switchedOff = new Map<number, number>()

    for (const fact of index.facts) {
      if (fact.switchId !== undefined && fact.value === false) {
        switchedOff.set(fact.switchId, (switchedOff.get(fact.switchId) ?? 0) + 1)
      }
    }

    const on = new Set(state.switches)
    const candidates: Array<{ readonly fact: GameFact; readonly score: number }> = []

    for (const event of index.events) {
      const page = progress.activePage(event)
      const distance = fromHere.distance.get(event.mapId)

      if (distance === undefined) {
        continue
      }

      if (page >= 0 && (event.pages[page]?.trigger ?? 0) <= 2) {
        const facts = activeFacts(event, page)
        let score = 0

        for (const fact of facts) {
          if (
            fact.switchId !== undefined &&
            fact.value === true &&
            !on.has(fact.switchId) &&
            (switchedOff.get(fact.switchId) ?? 0) < 3
          ) {
            score += 3
          }

          if (fact.kind === 'gives') {
            score += fact.item?.of === 'gold' ? 0.5 : 2
          }

          if (fact.kind === 'joins' || fact.kind === 'fights') {
            score += 2
          }

          if (fact.letter !== undefined && fact.value === true) {
            score += 1
          }
        }

        if (score > 0) {
          const person = personFact(event)

          const does = activePositions(event, page).flatMap((position) => {
            const shown = factAt(position)

            return shown === undefined || shown.kind === 'sets' || shown.kind === 'script'
              ? []
              : [shown.summary]
          })

          candidates.push({
            fact: {
              ...person,
              summary:
                does.length > 0 ? `${person.summary}: ${does[0]}` : `Talk to ${person.summary}`,
            },
            score: score - distance * 0.5,
          })
        }
      }

      for (let later = Math.max(page + 1, 0); later < event.pages.length; later++) {
        const missing = progress.missingItems(event, later)

        if (missing !== undefined) {
          const wanted = missing
            .map((condition) => conditionText(condition).replace(/^Has /, ''))
            .join(', ')

          const person = personFact(event)

          candidates.push({
            fact: { ...person, summary: `Bring ${wanted} to ${person.summary}`, status: 'needs' },
            score: 2.5 - distance * 0.5,
          })

          break
        }
      }
    }

    return candidates
      .toSorted((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((candidate) => candidate.fact)
  }

  const battleEnemies = () =>
    [...new Set(state.enemies.map(([enemyId]) => enemyId))].flatMap((enemyId) => {
      const card = enemyCard(enemyId)

      return card === undefined ? [] : [card]
    })

  const recentDialogue = () =>
    state.dialogue.slice(-12).map((line, position) => ({
      id: `r${position}`,
      kind: 'dialogue' as const,
      summary: line.speaker === '' ? 'Dialogue' : plainText(line.speaker),
      place: { mapId: line.mapId, mapName: mapName(line.mapId) },
      gate: [],
      status: 'open' as const,
      text: plainText(line.text),
    }))

  const sketch = (
    mapId: number,
    target?: { readonly x: number; readonly y: number },
  ): MapSketch => {
    const map = maps.get(mapId)

    const marks = index.events
      .filter((event) => event.mapId === mapId)
      .flatMap((event): ReadonlyArray<SketchMark> => {
        const page = progress.activePage(event)

        if (page === -1) {
          return []
        }

        const kind = markKind(activeFacts(event, page), event, page)

        if (kind === 'other') {
          return []
        }

        return [{ x: event.x, y: event.y, kind, label: labelOf(event), status: 'open' }]
      })

    return {
      mapId,
      name: mapName(mapId),
      width: map?.width ?? 0,
      height: map?.height ?? 0,
      ...(map?.passable === undefined ? {} : { passable: map.passable }),
      marks,
      route: route(state.mapId, mapId),
      ...(state.mapId === mapId ? { player: { x: state.x, y: state.y } } : {}),
      ...(target === undefined ? {} : { target }),
    }
  }

  return {
    index,
    state,
    mapName,
    findMap,
    resolve,
    find,
    subjects,
    whereToGet,
    whatNeeds,
    whatSets,
    whatOpensAfter,
    people,
    places,
    dialogue,
    names,
    characters,
    around,
    nextSteps,
    enemies: battleEnemies,
    enemyCard,
    recentDialogue,
    sketch,
    route,
    progress,
  }
}
