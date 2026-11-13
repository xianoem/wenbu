import { Match, Predicate } from 'effect'
import { isMapFile } from '../rpgmaker/TextLocations'
import {
  isDataArray,
  isDataObject,
  pointerOf,
  type RpgData,
  type RpgDataObject,
} from '../rpgmaker/RpgData'

export const knowledgeIndexVersion = 2

export type CompareOp = '==' | '>=' | '<=' | '>' | '<' | '!='

export type ItemKind = 'item' | 'weapon' | 'armor'

export type Condition =
  | { readonly kind: 'switch'; readonly id: number; readonly on: boolean }
  | {
      readonly kind: 'variable'
      readonly id: number
      readonly op: CompareOp
      readonly value: number
      readonly against?: number
    }
  | { readonly kind: 'self-switch'; readonly letter: string; readonly on: boolean }
  | { readonly kind: 'item'; readonly of: ItemKind; readonly id: number; readonly has: boolean }
  | { readonly kind: 'actor'; readonly id: number; readonly inParty: boolean }
  | { readonly kind: 'gold'; readonly op: CompareOp; readonly value: number }
  | { readonly kind: 'choice'; readonly text: string }
  | { readonly kind: 'script' }

export type FactPlace =
  | {
      readonly type: 'event'
      readonly mapId: number
      readonly eventId: number
      readonly page: number
    }
  | { readonly type: 'common'; readonly id: number }

export interface IndexFact {
  readonly kind:
    | 'gives'
    | 'takes'
    | 'sells'
    | 'fights'
    | 'leads-to'
    | 'sets'
    | 'joins'
    | 'leaves'
    | 'calls'
    | 'script'
  readonly place: FactPlace
  readonly gate: ReadonlyArray<Condition>
  readonly item?: { readonly of: ItemKind | 'gold' | 'troop' | 'actor'; readonly id: number }
  readonly amount?: number
  readonly price?: number
  readonly to?: { readonly mapId: number; readonly x: number; readonly y: number }
  readonly switchId?: number
  readonly variableId?: number
  readonly letter?: string
  readonly value?: boolean | number
  readonly common?: number
  readonly note?: string
}

export interface IndexPage {
  readonly conditions: ReadonlyArray<Condition>
  readonly trigger: number
  readonly graphic: boolean
}

export interface IndexEvent {
  readonly mapId: number
  readonly id: number
  readonly name: string
  readonly x: number
  readonly y: number
  readonly pages: ReadonlyArray<IndexPage>
}

export interface IndexMap {
  readonly id: number
  readonly name: string
  readonly nameEntry?: string
  readonly displayName: string
  readonly displayEntry?: string
  readonly parentId: number
  readonly width: number
  readonly height: number
  readonly encounters: ReadonlyArray<number>
  readonly passable?: string
}

export interface IndexThing {
  readonly id: number
  readonly name: string
  readonly entry: string
  readonly description: string
  readonly price: number
  readonly key: boolean
}

export interface IndexEnemy {
  readonly id: number
  readonly name: string
  readonly entry: string
  readonly hp: number
  readonly exp: number
  readonly gold: number
  readonly drops: ReadonlyArray<{
    readonly of: ItemKind
    readonly id: number
    readonly denominator: number
  }>
  readonly weak: ReadonlyArray<number>
  readonly resists: ReadonlyArray<number>
}

export interface IndexLine {
  readonly entry: string
  readonly text: string
  readonly place: FactPlace
  readonly speaker: string
  readonly kind: 'dialogue' | 'choice' | 'comment'
}

export interface IndexCommon {
  readonly id: number
  readonly name: string
  readonly trigger: number
  readonly switchId: number
}

export interface IndexTroop {
  readonly id: number
  readonly name: string
  readonly enemies: ReadonlyArray<number>
}

export interface IndexActor {
  readonly id: number
  readonly name: string
  readonly entry: string
  readonly nickname: string
  readonly profile: string
}

export interface IndexNamed {
  readonly id: number
  readonly name: string
  readonly entry: string
  readonly description: string
}

export interface KnowledgeIndex {
  readonly version: number
  readonly title: string
  readonly maps: ReadonlyArray<IndexMap>
  readonly events: ReadonlyArray<IndexEvent>
  readonly commons: ReadonlyArray<IndexCommon>
  readonly facts: ReadonlyArray<IndexFact>
  readonly items: ReadonlyArray<IndexThing>
  readonly weapons: ReadonlyArray<IndexThing>
  readonly armors: ReadonlyArray<IndexThing>
  readonly enemies: ReadonlyArray<IndexEnemy>
  readonly troops: ReadonlyArray<IndexTroop>
  readonly actors: ReadonlyArray<IndexActor>
  readonly states: ReadonlyArray<IndexNamed>
  readonly skills: ReadonlyArray<IndexNamed>
  readonly switches: ReadonlyArray<string>
  readonly variables: ReadonlyArray<string>
  readonly elements: ReadonlyArray<string>
  readonly lines: ReadonlyArray<IndexLine>
}

/** VX Ace data uses snake_case where MV and MZ use camelCase. */
const field = (value: RpgData | undefined, camel: string, snake = camel): RpgData | undefined => {
  if (!isDataObject(value)) {
    return undefined
  }

  return Object.hasOwn(value, camel) ? value[camel] : value[snake]
}

const num = (value: RpgData | undefined, fallback = 0) =>
  Predicate.isNumber(value) ? value : fallback

const str = (value: RpgData | undefined) => (Predicate.isString(value) ? value : '')

const bool = (value: RpgData | undefined) => value === true

const list = (value: RpgData | undefined) => (isDataArray(value) ? value : [])

/** MV keeps records in arrays by id; VX Ace keeps map events and map infos in hashes by id. */
const pairsOf = (value: RpgData | undefined): ReadonlyArray<readonly [string, RpgData]> => {
  if (isDataArray(value)) {
    return value.map((item, index) => [String(index), item] as const)
  }

  return isDataObject(value) ? Object.entries(value) : []
}

const records = (value: RpgData | undefined): ReadonlyArray<readonly [string, RpgDataObject]> =>
  pairsOf(value).flatMap(([key, item]) => (isDataObject(item) ? [[key, item] as const] : []))

const jsonName = (file: string) => file.replace(/\.rvdata2$/i, '.json')

const entryOf = (file: string, ...segments: ReadonlyArray<string | number>) =>
  `${file}::${pointerOf(...segments)}`

const itemKinds: ReadonlyArray<ItemKind> = ['item', 'weapon', 'armor']

const compareOps: ReadonlyArray<CompareOp> = ['==', '>=', '<=', '>', '<', '!=']

const goldOps: ReadonlyArray<CompareOp> = ['>=', '<=', '<']

const opposite: Record<CompareOp, CompareOp> = {
  '==': '!=',
  '!=': '==',
  '>=': '<',
  '<': '>=',
  '<=': '>',
  '>': '<=',
}

export const negate = (condition: Condition): Condition =>
  Match.value(condition).pipe(
    Match.discriminatorsExhaustive('kind')({
      switch: (found): Condition => ({ ...found, on: !found.on }),
      'self-switch': (found): Condition => ({ ...found, on: !found.on }),
      item: (found): Condition => ({ ...found, has: !found.has }),
      actor: (found): Condition => ({ ...found, inParty: !found.inParty }),
      variable: (found): Condition => ({ ...found, op: opposite[found.op] }),
      gold: (found): Condition => ({ ...found, op: opposite[found.op] }),
      choice: (found): Condition => ({ kind: 'choice', text: `not "${found.text}"` }),
      script: (found): Condition => found,
    }),
  )

export const pageConditions = (page: RpgData | undefined): ReadonlyArray<Condition> => {
  const source = field(page, 'conditions', 'condition')
  const found: Array<Condition> = []

  for (const n of [1, 2]) {
    if (bool(field(source, `switch${n}Valid`, `switch${n}_valid`))) {
      found.push({
        kind: 'switch',
        id: num(field(source, `switch${n}Id`, `switch${n}_id`)),
        on: true,
      })
    }
  }

  if (bool(field(source, 'variableValid', 'variable_valid'))) {
    found.push({
      kind: 'variable',
      id: num(field(source, 'variableId', 'variable_id')),
      op: '>=',
      value: num(field(source, 'variableValue', 'variable_value')),
    })
  }

  if (bool(field(source, 'selfSwitchValid', 'self_switch_valid'))) {
    found.push({
      kind: 'self-switch',
      letter: str(field(source, 'selfSwitchCh', 'self_switch_ch')) || 'A',
      on: true,
    })
  }

  if (bool(field(source, 'itemValid', 'item_valid'))) {
    found.push({ kind: 'item', of: 'item', id: num(field(source, 'itemId', 'item_id')), has: true })
  }

  if (bool(field(source, 'actorValid', 'actor_valid'))) {
    found.push({ kind: 'actor', id: num(field(source, 'actorId', 'actor_id')), inParty: true })
  }

  return found
}

const hasGraphic = (page: RpgData | undefined) => {
  const graphic = field(page, 'image', 'graphic')

  return (
    str(field(graphic, 'characterName', 'character_name')) !== '' ||
    num(field(graphic, 'tileId', 'tile_id')) > 0
  )
}

type BranchReader = (at: (index: number) => number, parameters: ReadonlyArray<RpgData>) => Condition

const branchKinds: Record<number, BranchReader> = {
  0: (at) => ({ kind: 'switch', id: at(1), on: at(2) === 0 }),
  1: (at) =>
    at(2) === 0
      ? { kind: 'variable', id: at(1), op: compareOps[at(4)] ?? '==', value: at(3) }
      : { kind: 'variable', id: at(1), op: compareOps[at(4)] ?? '==', value: 0, against: at(3) },
  2: (at, parameters) => ({
    kind: 'self-switch',
    letter: str(parameters[1]) || 'A',
    on: at(2) === 0,
  }),
  4: (at) => (at(2) === 0 ? { kind: 'actor', id: at(1), inParty: true } : { kind: 'script' }),
  7: (at) => ({ kind: 'gold', op: goldOps[at(2)] ?? '>=', value: at(1) }),
  8: (at) => ({ kind: 'item', of: 'item', id: at(1), has: true }),
  9: (at) => ({ kind: 'item', of: 'weapon', id: at(1), has: true }),
  10: (at) => ({ kind: 'item', of: 'armor', id: at(1), has: true }),
}

export const branchCondition = (parameters: ReadonlyArray<RpgData>): Condition => {
  const read = branchKinds[num(parameters[0], -1)]

  return read === undefined
    ? { kind: 'script' }
    : read((index) => num(parameters[index]), parameters)
}

const battleOutcomes: Record<number, string> = {
  601: 'Win the battle',
  602: 'Escape the battle',
  603: 'Lose the battle',
}

const RANGE_LIMIT = 50

interface Command {
  readonly code: number
  readonly indent: number
  readonly parameters: ReadonlyArray<RpgData>
}

const commandAt = (value: RpgData | undefined): Command | undefined => {
  const code = field(value, 'code')
  const parameters = field(value, 'parameters')

  return Predicate.isNumber(code) && isDataArray(parameters)
    ? { code, indent: num(field(value, 'indent')), parameters }
    : undefined
}

interface Walked {
  readonly facts: Array<IndexFact>
  readonly lines: Array<IndexLine>
}

/** Shop goods: VX Ace and MV list `[type, id, priceType, price]`; XP wraps `[type, id]` in an array. */
const shopGood = (parameters: ReadonlyArray<RpgData>) => {
  const good = isDataArray(parameters[0]) ? parameters[0] : parameters
  const of = itemKinds[num(good[0])]

  if (of === undefined) {
    return undefined
  }

  const price = good === parameters && num(parameters[2]) === 1 ? num(parameters[3]) : undefined

  return { of, id: num(good[1]), ...(price === undefined ? {} : { price }) }
}

export const speakerInText = (line: string) =>
  /^【([^】]{1,16})】/.exec(line)?.[1] ?? /^([^\s「『(（]{1,12})[「『]/.exec(line)?.[1] ?? ''

const scriptNote = (text: string) => text.split('\n')[0]?.slice(0, 80) ?? ''

const walkCommands = (
  commands: RpgData | undefined,
  place: FactPlace,
  file: string,
  base: ReadonlyArray<string | number>,
  walked: Walked,
) => {
  const source = list(commands)
  const open: Array<{ readonly indent: number; readonly condition: Condition }> = []
  const lastBranch = new Map<number, Condition>()
  let speaker = ''
  let index = 0

  const fact = (value: Omit<IndexFact, 'place' | 'gate'>) =>
    walked.facts.push({ ...value, place, gate: open.map((entry) => entry.condition) })

  const linesFrom = (first: Command, next: number) => {
    const text = [str(first.parameters[0])]

    while (commandAt(source[index + 1])?.code === next) {
      index++
      text.push(str(commandAt(source[index])?.parameters[0]))
    }

    return text
  }

  const opens = (indent: number, condition: Condition) => open.push({ indent, condition })

  const message = (command: Command) => {
    const start = index
    const text = linesFrom(command, command.code)

    walked.lines.push({
      entry: entryOf(file, ...base, start, 'parameters', 0),
      text: text.join('\n'),
      place,
      speaker: speaker || speakerInText(text[0] ?? ''),
      kind: 'dialogue',
    })
  }

  const items = ({ code, parameters }: Command) => {
    const at = (position: number) => num(parameters[position])

    fact({
      kind: at(1) === 0 ? 'gives' : 'takes',
      item: { of: itemKinds[code - 126] ?? 'item', id: at(0) },
      ...(at(2) === 0 ? { amount: at(3) } : {}),
    })
  }

  const shop = ({ parameters }: Command) => {
    const good = shopGood(parameters)

    if (good !== undefined) {
      fact({
        kind: 'sells',
        item: { of: good.of, id: good.id },
        ...(good.price === undefined ? {} : { price: good.price }),
      })
    }
  }

  const ranged = ({ parameters }: Command, each: (id: number) => void) => {
    const first = num(parameters[0])

    for (let id = first; id <= Math.min(num(parameters[1]), first + RANGE_LIMIT); id++) {
      each(id)
    }
  }

  const outcome = ({ code, indent }: Command) =>
    opens(indent, { kind: 'choice', text: battleOutcomes[code] ?? '' })

  const script = ({ parameters }: Command) =>
    fact({ kind: 'script', note: scriptNote(str(parameters[0])) })

  const handlers: Record<number, (command: Command) => void> = {
    101: ({ parameters }) => {
      speaker = str(parameters[4])
    },
    401: message,
    405: message,
    102: ({ parameters }) =>
      list(parameters[0]).forEach((choice, position) =>
        walked.lines.push({
          entry: entryOf(file, ...base, index, 'parameters', 0, position),
          text: str(choice),
          place,
          speaker,
          kind: 'choice',
        }),
      ),
    108: (command) =>
      walked.lines.push({
        entry: '',
        text: linesFrom(command, 408).join('\n'),
        place,
        speaker: '',
        kind: 'comment',
      }),
    111: ({ indent, parameters }) => {
      const condition = branchCondition(parameters)

      lastBranch.set(indent, condition)
      opens(indent, condition)
    },
    411: ({ indent }) => {
      const branch = lastBranch.get(indent)

      opens(indent, branch === undefined ? { kind: 'script' } : negate(branch))
    },
    402: ({ indent, parameters }) => opens(indent, { kind: 'choice', text: str(parameters[1]) }),
    403: ({ indent }) => opens(indent, { kind: 'choice', text: 'Cancel' }),
    601: outcome,
    602: outcome,
    603: outcome,
    117: ({ parameters }) => fact({ kind: 'calls', common: num(parameters[0]) }),
    121: (command) =>
      ranged(command, (id) =>
        fact({ kind: 'sets', switchId: id, value: num(command.parameters[2]) === 0 }),
      ),
    122: (command) => {
      const at = (position: number) => num(command.parameters[position])
      const constant = at(2) === 0 && at(3) === 0

      ranged(command, (id) =>
        fact({ kind: 'sets', variableId: id, ...(constant ? { value: at(4) } : {}) }),
      )
    },
    123: ({ parameters }) =>
      fact({ kind: 'sets', letter: str(parameters[0]) || 'A', value: num(parameters[1]) === 0 }),
    125: ({ parameters }) =>
      fact({
        kind: num(parameters[0]) === 0 ? 'gives' : 'takes',
        item: { of: 'gold', id: 0 },
        ...(num(parameters[1]) === 0 ? { amount: num(parameters[2]) } : {}),
      }),
    126: items,
    127: items,
    128: items,
    129: ({ parameters }) =>
      fact({
        kind: num(parameters[1]) === 0 ? 'joins' : 'leaves',
        item: { of: 'actor', id: num(parameters[0]) },
      }),
    201: ({ parameters }) => {
      if (num(parameters[0]) === 0) {
        const to = { mapId: num(parameters[1]), x: num(parameters[2]), y: num(parameters[3]) }

        fact({ kind: 'leads-to', to })
      }
    },
    301: ({ parameters }) => {
      if (num(parameters[0]) === 0) {
        fact({ kind: 'fights', item: { of: 'troop', id: num(parameters[1]) } })
      }
    },
    302: shop,
    605: shop,
    355: script,
    356: script,
    357: ({ parameters }) =>
      fact({ kind: 'script', note: `${str(parameters[0])} ${str(parameters[1])}`.trim() }),
  }

  for (; index < source.length; index++) {
    const command = commandAt(source[index])

    if (command === undefined) {
      continue
    }

    while ((open.at(-1)?.indent ?? -1) >= command.indent) {
      open.pop()
    }

    handlers[command.code]?.(command)
  }
}

const tableOf = (value: RpgData | undefined) => {
  if (!isDataObject(value) || value['__rubyUserDefined'] !== 'Table') {
    return undefined
  }

  const bytes = value['bytes']

  if (!(bytes instanceof Uint8Array) || bytes.length < 20) {
    return undefined
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const xsize = view.getInt32(4, true)
  const ysize = view.getInt32(8, true)
  const size = view.getInt32(16, true)

  return {
    xsize,
    ysize,
    at: (x: number, y = 0, z = 0) => {
      const index = x + y * xsize + z * xsize * ysize

      return index < size && 20 + index * 2 + 1 < bytes.length
        ? view.getUint16(20 + index * 2, true)
        : 0
    },
  }
}

const flagsOf = (tileset: RpgData | undefined) => {
  const flags = field(tileset, 'flags')
  const table = tableOf(flags)

  if (table !== undefined) {
    return (tile: number) => table.at(tile)
  }

  const array = list(flags)

  return array.length === 0 ? undefined : (tile: number) => num(array[tile])
}

const passability = (map: RpgData, tilesets: RpgData | undefined) => {
  const tilesetId = num(field(map, 'tilesetId', 'tileset_id'))
  const flags = flagsOf(isDataArray(tilesets) ? tilesets[tilesetId] : undefined)
  const width = num(field(map, 'width'))
  const height = num(field(map, 'height'))
  const data = field(map, 'data')
  const table = tableOf(data)
  const array = list(data)

  if (
    flags === undefined ||
    width === 0 ||
    height === 0 ||
    (table === undefined && array.length === 0)
  ) {
    return undefined
  }

  const layers = table === undefined ? 4 : 3

  const tile = (x: number, y: number, z: number) =>
    table === undefined ? num(array[(z * height + y) * width + x]) : table.at(x, y, z)

  const bits = new Uint8Array(Math.ceil((width * height) / 8))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let walkable = false

      for (let z = layers - 1; z >= 0; z--) {
        const flag = flags(tile(x, y, z))

        if ((flag & 0x10) !== 0) {
          continue
        }

        walkable = (flag & 0x0f) !== 0x0f
        break
      }

      if (walkable) {
        const index = y * width + x

        bits[index >> 3] = (bits[index >> 3] ?? 0) | (1 << (index & 7))
      }
    }
  }

  let binary = ''

  for (const byte of bits) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

const things = (file: string, data: RpgData): Array<IndexThing> =>
  records(data).flatMap(([key, item]) => {
    const name = str(item['name'])

    return name === ''
      ? []
      : [
          {
            id: num(item['id'], Number(key)),
            name,
            entry: entryOf(file, Number(key), 'name'),
            description: str(item['description']),
            price: num(item['price']),
            key: num(field(item, 'itypeId', 'itype_id')) === 2,
          },
        ]
  })

const ELEMENT_RATE = 11

const enemies = (file: string, data: RpgData): Array<IndexEnemy> =>
  records(data).flatMap(([key, enemy]) => {
    const name = str(enemy['name'])

    if (name === '') {
      return []
    }

    const rates = list(field(enemy, 'traits', 'features')).filter(
      (trait) => num(field(trait, 'code')) === ELEMENT_RATE,
    )

    return [
      {
        id: num(enemy['id'], Number(key)),
        name,
        entry: entryOf(file, Number(key), 'name'),
        hp: num(list(field(enemy, 'params'))[0]),
        exp: num(field(enemy, 'exp')),
        gold: num(field(enemy, 'gold')),
        drops: list(field(enemy, 'dropItems', 'drop_items')).flatMap((drop) => {
          const of = itemKinds[num(field(drop, 'kind')) - 1]

          return of === undefined
            ? []
            : [
                {
                  of,
                  id: num(field(drop, 'dataId', 'data_id')),
                  denominator: num(field(drop, 'denominator'), 1),
                },
              ]
        }),
        weak: rates
          .filter((trait) => num(field(trait, 'value'), 1) > 1)
          .map((trait) => num(field(trait, 'dataId', 'data_id'))),
        resists: rates
          .filter((trait) => num(field(trait, 'value'), 1) < 1)
          .map((trait) => num(field(trait, 'dataId', 'data_id'))),
      },
    ]
  })

const named = (
  file: string,
  data: RpgData,
  describe: (record: RpgDataObject) => string,
): Array<IndexNamed> =>
  records(data).flatMap(([key, record]) =>
    str(record['name']) === ''
      ? []
      : [
          {
            id: num(record['id'], Number(key)),
            name: str(record['name']),
            entry: entryOf(file, Number(key), 'name'),
            description: describe(record),
          },
        ],
  )

const names = (value: RpgData | undefined) => list(value).map((name) => str(name))

export const makeIndexBuilder = (tilesets?: RpgData) => {
  const maps = new Map<number, IndexMap>()
  const infos = new Map<number, { name: string; entry: string; parentId: number }>()
  const events: Array<IndexEvent> = []
  const commons: Array<IndexCommon> = []
  const walked: Walked = { facts: [], lines: [] }

  const database: {
    title: string
    items: ReadonlyArray<IndexThing>
    weapons: ReadonlyArray<IndexThing>
    armors: ReadonlyArray<IndexThing>
    enemies: ReadonlyArray<IndexEnemy>
    troops: ReadonlyArray<IndexTroop>
    actors: ReadonlyArray<IndexActor>
    states: ReadonlyArray<IndexNamed>
    skills: ReadonlyArray<IndexNamed>
    switches: ReadonlyArray<string>
    variables: ReadonlyArray<string>
    elements: ReadonlyArray<string>
  } = {
    title: '',
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
  }

  const addMap = (file: string, mapId: number, data: RpgData) => {
    const displayKey =
      isDataObject(data) && Object.hasOwn(data, 'display_name') ? 'display_name' : 'displayName'

    const passable = passability(data, tilesets)

    maps.set(mapId, {
      id: mapId,
      name: '',
      displayName: str(field(data, displayKey)),
      displayEntry: entryOf(file, displayKey),
      parentId: 0,
      width: num(field(data, 'width')),
      height: num(field(data, 'height')),
      encounters: list(field(data, 'encounterList', 'encounter_list')).map((encounter) =>
        num(field(encounter, 'troopId', 'troop_id')),
      ),
      ...(passable === undefined ? {} : { passable }),
    })

    for (const [key, event] of records(field(data, 'events'))) {
      const eventId = num(event['id'], Number(key))

      const pages = list(event['pages']).map((page, pageIndex) => {
        walkCommands(
          field(page, 'list'),
          { type: 'event', mapId, eventId, page: pageIndex },
          file,
          ['events', key, 'pages', pageIndex, 'list'],
          walked,
        )

        return {
          conditions: pageConditions(page),
          trigger: num(field(page, 'trigger')),
          graphic: hasGraphic(page),
        }
      })

      events.push({
        mapId,
        id: eventId,
        name: str(event['name']),
        x: num(event['x']),
        y: num(event['y']),
        pages,
      })
    }
  }

  const readers: Record<string, (file: string, data: RpgData) => void> = {
    'MapInfos.json': (file, data) => {
      for (const [key, info] of records(data)) {
        infos.set(Number(key), {
          name: str(info['name']),
          entry: entryOf(file, Number(key), 'name'),
          parentId: num(field(info, 'parentId', 'parent_id')),
        })
      }
    },
    'CommonEvents.json': (file, data) => {
      for (const [key, common] of records(data)) {
        const id = num(common['id'], Number(key))

        commons.push({
          id,
          name: str(common['name']),
          trigger: num(field(common, 'trigger')),
          switchId: num(field(common, 'switchId', 'switch_id')),
        })

        walkCommands(field(common, 'list'), { type: 'common', id }, file, [key, 'list'], walked)
      }
    },
    'Items.json': (file, data) => {
      database.items = things(file, data)
    },
    'Weapons.json': (file, data) => {
      database.weapons = things(file, data)
    },
    'Armors.json': (file, data) => {
      database.armors = things(file, data)
    },
    'Enemies.json': (file, data) => {
      database.enemies = enemies(file, data)
    },
    'Troops.json': (_, data) => {
      database.troops = records(data).map(([key, troop]) => ({
        id: num(troop['id'], Number(key)),
        name: str(troop['name']),
        enemies: list(troop['members']).map((member) => num(field(member, 'enemyId', 'enemy_id'))),
      }))
    },
    'Actors.json': (file, data) => {
      database.actors = records(data).flatMap(([key, actor]) =>
        str(actor['name']) === ''
          ? []
          : [
              {
                id: num(actor['id'], Number(key)),
                name: str(actor['name']),
                entry: entryOf(file, Number(key), 'name'),
                nickname: str(actor['nickname']),
                profile: str(actor['profile']),
              },
            ],
      )
    },
    'States.json': (file, data) => {
      database.states = named(file, data, (state) =>
        ['message1', 'message2', 'message3', 'message4']
          .map((key) => str(state[key]))
          .filter((message) => message !== '')
          .join(' / '),
      )
    },
    'Skills.json': (file, data) => {
      database.skills = named(file, data, (skill) => str(skill['description']))
    },
    'System.json': (_, data) => {
      database.title = str(field(data, 'gameTitle', 'game_title'))
      database.switches = names(field(data, 'switches'))
      database.variables = names(field(data, 'variables'))
      database.elements = names(field(data, 'elements'))
    },
  }

  const add = (file: string, data: RpgData) => {
    const name = jsonName(file)

    if (isMapFile(name)) {
      addMap(file, Number(/\d+/.exec(name)?.[0] ?? 0), data)

      return
    }

    readers[name]?.(file, data)
  }

  const finish = (): KnowledgeIndex => {
    const named = [...maps.values()].map((map) => {
      const info = infos.get(map.id)

      return info === undefined
        ? map
        : { ...map, name: info.name, nameEntry: info.entry, parentId: info.parentId }
    })

    return {
      version: knowledgeIndexVersion,
      ...database,
      maps: named.toSorted((left, right) => left.id - right.id),
      events,
      commons,
      facts: walked.facts,
      lines: walked.lines,
    }
  }

  return { add, finish }
}
