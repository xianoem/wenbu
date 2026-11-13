import { Option, Predicate, Schema } from 'effect'
import type { Memories, MemorySource, MemorySwitch } from '#contract/Memories'
import { isDataArray, isDataObject, type RpgData } from '../rpgmaker/RpgData'

export const Plugin = Schema.Struct({
  name: Schema.String,
  status: Schema.Boolean,
  parameters: Schema.Record(Schema.String, Schema.String),
})

export type Plugin = typeof Plugin.Type

export interface SharedSave {
  readonly name: string
  readonly switchIds: ReadonlyArray<number>
}

export interface GameMemoryData {
  readonly switchNames: ReadonlyArray<string>
  readonly mapInfos: RpgData | undefined
  readonly maps: ReadonlyMap<number, RpgData>
  readonly commonEvents: RpgData | undefined
  readonly plugins: ReadonlyArray<Plugin>
  readonly recollectionSwitches: ReadonlyArray<number>
}

const decodePluginList = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
)

const decodePlugin = Schema.decodeUnknownOption(Plugin)

export const parsePluginList = (source: string): ReadonlyArray<Plugin> =>
  Option.match(decodePluginList(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1)), {
    onNone: () => [],
    onSome: (entries) =>
      entries.flatMap((entry) =>
        Option.match(decodePlugin(entry), { onNone: () => [], onSome: (plugin) => [plugin] }),
      ),
  })

const pluginName = (plugin: Plugin) => plugin.name.split('/').at(-1) ?? plugin.name

type IdLike = RpgData | undefined

const toId = (value: IdLike) => {
  const id = Predicate.isString(value) || Predicate.isNumber(value) ? Number(value) : Number.NaN

  return Number.isInteger(id) && id > 0 ? id : undefined
}

const span = (from: IdLike, to: IdLike) => {
  const start = toId(from)
  const end = toId(to)

  if (start === undefined || end === undefined || end < start || end - start > 5000) {
    return []
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

const decodeStringList = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
)

const decodeRangeList = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(Schema.fromJsonString(Schema.Struct({ from: Schema.String, to: Schema.String }))),
  ),
)

const stringList = (value: string | undefined) =>
  Option.getOrElse(decodeStringList(value), (): ReadonlyArray<string> => [])

const parseRanges = (value: string | undefined) => {
  if (value === undefined) {
    return []
  }

  const parts = value.trim().startsWith('[') ? stringList(value) : value.split(',')

  return parts.flatMap((part) => {
    const [from, to = from] = part.trim().split('-')

    return span(from, to)
  })
}

const sharedSwitchReaders: Record<
  string,
  (parameters: Plugin['parameters']) => ReadonlyArray<number>
> = {
  UTA_CommonSave: (parameters) => parseRanges(parameters['Target Switches']),
  UTA_CommonSaveMZ: (parameters) => parseRanges(parameters['targetSwitches']),
  VariableCommon: (parameters) => [
    ...span(parameters['startSwitchId'], parameters['endSwitchId']),
    ...stringList(parameters['switchList']).flatMap((id) => span(id, id)),
  ],
  DarkPlasma_SharedSwitchVariable: (parameters) =>
    Option.getOrElse(decodeRangeList(parameters['switchRangeList']), () => []).flatMap((range) =>
      span(range.from, range.to),
    ),
  IM_GlobalSave: (parameters) => span(parameters['start'], parameters['end']),
  JKL_PersistentData: (parameters) => parseRanges(parameters['Persistent Switches']),
}

const sorted = (ids: Iterable<number>) => [...new Set(ids)].toSorted((left, right) => left - right)

export const sharedSaveOf = (plugins: ReadonlyArray<Plugin>): SharedSave | undefined => {
  for (const plugin of plugins) {
    const read = sharedSwitchReaders[pluginName(plugin)]

    if (!plugin.status || read === undefined) {
      continue
    }

    const switchIds = sorted(read(plugin.parameters))

    if (switchIds.length > 0) {
      return { name: pluginName(plugin), switchIds }
    }
  }

  return undefined
}

export const recollectionModeSwitches = (source: string) =>
  sorted(
    [...source.matchAll(/["']?switch_id["']?\s*:\s*(\d+)/g)].flatMap((match) =>
      span(match[1], match[1]),
    ),
  )

const field = (value: RpgData | undefined, ...names: ReadonlyArray<string>) => {
  if (!isDataObject(value)) {
    return undefined
  }

  for (const name of names) {
    if (Object.hasOwn(value, name)) {
      return value[name]
    }
  }

  return undefined
}

const entriesOf = (value: RpgData | undefined): ReadonlyArray<readonly [number, RpgData]> => {
  if (isDataArray(value)) {
    return value.flatMap((entry, index): Array<readonly [number, RpgData]> =>
      isDataObject(entry) ? [[toId(entry['id']) ?? index, entry]] : [],
    )
  }

  if (!isDataObject(value)) {
    return []
  }

  return Object.entries(value).flatMap(([key, entry]): Array<readonly [number, RpgData]> => {
    const id = toId(key)

    return id === undefined || !isDataObject(entry) ? [] : [[id, entry]]
  })
}

const textOf = (value: RpgData | undefined) => (Predicate.isString(value) ? value : '')

const roomName =
  /(回想|recollection|memory|memories|gallery|ギャラリー|鑑賞|回忆|コレクション|シーン)\s*(部屋|ルーム|room|室|空間|モード|mode)|(シーン|scene)\s*回想/i

const sceneName =
  /回想|シーン|scene|recollect|memor|cg|解放|開放|閲覧|鑑賞|unlock|seen|回忆|済|场景|解锁|开放|鉴赏/i

const unlockAllName = /全|all|unlock/i

const commandsOf = (list: RpgData | undefined) =>
  isDataArray(list)
    ? list.flatMap((entry) => {
        const code = field(entry, 'code')
        const parameters = field(entry, 'parameters')

        return Predicate.isNumber(code) && isDataArray(parameters) ? [{ code, parameters }] : []
      })
    : []

const pagesOf = (event: RpgData | undefined) => {
  const pages = field(event, 'pages')

  return isDataArray(pages) ? pages : []
}

const checkedSwitches = (page: RpgData) => {
  const conditions = field(page, 'conditions')
  const ids: Array<number> = []

  for (const slot of ['1', '2']) {
    const id = field(conditions, `switch${slot}Id`, `switch${slot}_id`)

    if (field(conditions, `switch${slot}Valid`, `switch${slot}_valid`) === true) {
      ids.push(...span(id, id))
    }
  }

  for (const { code, parameters } of commandsOf(field(page, 'list'))) {
    if (code === 111 && parameters[0] === 0 && parameters[2] === 0) {
      ids.push(...span(parameters[1], parameters[1]))
    }
  }

  return ids
}

const switchesTurnedOn = (list: RpgData | undefined) =>
  sorted(
    commandsOf(list).flatMap(({ code, parameters }) =>
      code === 121 && parameters[2] === 0 ? span(parameters[0], parameters[1]) : [],
    ),
  )

const manySwitches = 8

interface UnlockEvent {
  readonly label: string
  readonly switchIds: ReadonlyArray<number>
}

const unlockEventsOf = (data: GameMemoryData, roomIds: ReadonlyArray<number>) => {
  const found: Array<UnlockEvent> = []

  const consider = (label: string, name: string, list: RpgData | undefined) => {
    const switchIds = switchesTurnedOn(list)
    const needed = unlockAllName.test(name) ? 2 : manySwitches

    if (switchIds.length >= needed) {
      found.push({ label, switchIds })
    }
  }

  for (const [, commonEvent] of entriesOf(data.commonEvents)) {
    const name = textOf(field(commonEvent, 'name'))

    if (unlockAllName.test(name) && sceneName.test(name)) {
      consider(name, name, field(commonEvent, 'list'))
    }
  }

  for (const mapId of roomIds) {
    for (const [, event] of entriesOf(field(data.maps.get(mapId), 'events'))) {
      const name = textOf(field(event, 'name'))

      for (const page of pagesOf(event)) {
        consider(`${name} on map ${mapId}`, name, field(page, 'list'))
      }
    }
  }

  return found.toSorted((left, right) => right.switchIds.length - left.switchIds.length)
}

export const roomMapsOf = (mapInfos: RpgData | undefined) =>
  entriesOf(mapInfos).flatMap(([id, info]) => {
    const name = textOf(field(info, 'name'))

    return roomName.test(name) ? [{ id, name }] : []
  })

const sourceOrder: ReadonlyArray<MemorySource> = [
  'shared-save',
  'recollection-plugin',
  'unlock-event',
  'room',
]

export const planMemories = (
  data: GameMemoryData,
  switchesOn: ReadonlyArray<number>,
  sharedSave: SharedSave | undefined = sharedSaveOf(data.plugins),
): Memories => {
  const rooms = roomMapsOf(data.mapInfos)

  const unlockEvents = unlockEventsOf(
    data,
    rooms.map((room) => room.id),
  )

  const sources = new Map<number, Set<MemorySource>>()

  const add = (source: MemorySource, ids: ReadonlyArray<number>) => {
    for (const id of ids) {
      if (id < data.switchNames.length) {
        sources.set(id, (sources.get(id) ?? new Set()).add(source))
      }
    }
  }

  add('shared-save', sharedSave?.switchIds ?? [])
  add('recollection-plugin', data.recollectionSwitches)

  add(
    'unlock-event',
    unlockEvents.flatMap((event) => event.switchIds),
  )

  for (const room of rooms) {
    for (const [, event] of entriesOf(field(data.maps.get(room.id), 'events'))) {
      add('room', pagesOf(event).flatMap(checkedSwitches))
    }
  }

  const on = new Set(switchesOn)

  const found = sorted(sources.keys()).map((id): MemorySwitch => {
    const from = sourceOrder.filter((source) => sources.get(id)?.has(source) === true)
    const name = data.switchNames[id] ?? ''
    const roomOnly = from.length === 1 && from[0] === 'room'

    return {
      id,
      name,
      unlocked: on.has(id),
      sources: from,
      suggested: !roomOnly || sceneName.test(name),
    }
  })

  const switches = found.some((entry) => entry.suggested)
    ? found
    : found.map((entry) => ({ ...entry, suggested: true }))

  const unlockEvent = unlockEvents[0]?.label

  return {
    ...(sharedSave === undefined ? {} : { sharedSave: sharedSave.name }),
    ...(unlockEvent === undefined ? {} : { unlockEvent }),
    rooms: switches.length === 0 ? [] : rooms.map((room) => room.name),
    switches,
  }
}
