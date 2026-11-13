import { Predicate } from 'effect'
import type { CoverageKey } from '#contract/GameTranslation'
import { isDataArray, isDataObject, pointerOf, type RpgData } from './RpgData'

export interface TextLocation {
  readonly file: string
  readonly pointer: string
  readonly context: string
  readonly value: RpgData | undefined
  readonly coverage: ReadonlyArray<CoverageKey>
  readonly dialogue?: boolean
  readonly extraPointers?: ReadonlyArray<string>
}

interface DatabaseFile {
  readonly coverageKey: CoverageKey
  readonly fields?: ReadonlyArray<string>
  readonly special?: 'system' | 'map-infos' | 'troops'
}

const databaseFiles: Record<string, DatabaseFile> = {
  'Actors.json': { fields: ['name', 'nickname', 'profile', 'description'], coverageKey: 'actors' },
  'Armors.json': { fields: ['name', 'description'], coverageKey: 'armors' },
  'Classes.json': { fields: ['name'], coverageKey: 'classes' },
  'Enemies.json': { fields: ['name'], coverageKey: 'enemies' },
  'Items.json': { fields: ['name', 'description'], coverageKey: 'items' },
  'MapInfos.json': { coverageKey: 'mapListNames', special: 'map-infos' },
  'Skills.json': {
    fields: ['name', 'description', 'message1', 'message2'],
    coverageKey: 'skills',
  },
  'States.json': {
    fields: ['name', 'message1', 'message2', 'message3', 'message4'],
    coverageKey: 'states',
  },
  'System.json': { coverageKey: 'systemTerms', special: 'system' },
  'Troops.json': { coverageKey: 'battleEvents', special: 'troops' },
  'Weapons.json': { fields: ['name', 'description'], coverageKey: 'weapons' },
}

const systemTermLists = ['basic', 'commands', 'params', 'etypes']

const systemTypeLists = [
  'armorTypes',
  'weaponTypes',
  'skillTypes',
  'equipTypes',
  'elements',
  'armor_types',
  'weapon_types',
  'skill_types',
]

const commandNames: Record<number, string> = {
  101: 'Speaker Name',
  102: 'Show Choices',
  320: 'Change Name',
  324: 'Change Nickname',
  325: 'Change Profile',
  401: 'Show Text',
  405: 'Scroll Text',
}

const jsonName = (fileName: string) => fileName.replace(/\.rvdata2$/i, '.json')

export const isMapFile = (fileName: string) => /^Map\d+\.json$/i.test(jsonName(fileName))

export const isTextFile = (fileName: string) => {
  const name = jsonName(fileName)

  return name === 'CommonEvents.json' || isMapFile(name) || Object.hasOwn(databaseFiles, name)
}

const keyOf = (value: Record<string, RpgData>, camel: string, snake: string) =>
  Object.hasOwn(value, snake) && !Object.hasOwn(value, camel) ? snake : camel

const entriesOf = (
  value: RpgData | undefined,
): ReadonlyArray<readonly [string | number, RpgData]> => {
  if (isDataArray(value)) {
    return value.map((item, index) => [index, item] as const)
  }

  return isDataObject(value) ? Object.entries(value) : []
}

const location = (
  file: string,
  segments: ReadonlyArray<string | number>,
  context: string,
  value: RpgData | undefined,
  coverage: ReadonlyArray<CoverageKey>,
  extra: Pick<TextLocation, 'dialogue' | 'extraPointers'> = {},
): TextLocation => ({
  file,
  pointer: pointerOf(...segments),
  context,
  value,
  coverage,
  ...extra,
})

const databaseLocations = (file: string, data: RpgData, config: DatabaseFile) =>
  entriesOf(data).flatMap(([index, item]) =>
    isDataObject(item)
      ? (config.fields ?? [])
          .filter((field) => Predicate.isString(item[field]))
          .map((field) =>
            location(file, [index, field], `${file} -> [${index}].${field}`, item[field], [
              config.coverageKey,
            ]),
          )
      : [],
  )

const mapInfoLocations = (file: string, data: RpgData, config: DatabaseFile) =>
  entriesOf(data).flatMap(([index, item]) =>
    isDataObject(item) && Predicate.isString(item['name'])
      ? [
          location(file, [index, 'name'], `${file} -> [${index}].name`, item['name'], [
            config.coverageKey,
          ]),
        ]
      : [],
  )

const systemLocations = (file: string, data: RpgData, config: DatabaseFile) => {
  if (!isDataObject(data)) {
    return []
  }

  const at = (
    segments: ReadonlyArray<string | number>,
    context: string,
    value: RpgData | undefined,
  ) => location(file, segments, `${file} -> ${context}`, value, [config.coverageKey])

  const title = keyOf(data, 'gameTitle', 'game_title')
  const currency = keyOf(data, 'currencyUnit', 'currency_unit')
  const terms = data['terms']
  const messages = isDataObject(terms) ? terms['messages'] : undefined

  return [
    at([title], title, data[title]),
    at([currency], currency, data[currency]),
    ...systemTermLists.flatMap((list) =>
      isDataObject(terms)
        ? entriesOf(isDataArray(terms[list]) ? terms[list] : undefined).map(([index, value]) =>
            at(['terms', list, index], `terms.${list}[${index}]`, value),
          )
        : [],
    ),
    ...entriesOf(isDataObject(messages) ? messages : undefined).map(([key, value]) =>
      at(['terms', 'messages', key], `terms.messages.${key}`, value),
    ),
    ...systemTypeLists.flatMap((list) =>
      entriesOf(isDataArray(data[list]) ? data[list] : undefined).map(([index, value]) =>
        at([list, index], `${list}[${index}]`, value),
      ),
    ),
  ]
}

const commandParameters = (command: RpgData | undefined) => {
  if (!isDataObject(command)) {
    return undefined
  }

  const code = command['code']
  const parameters = command['parameters']

  return Predicate.isNumber(code) && isDataArray(parameters) ? { code, parameters } : undefined
}

const eventCommandLocations = (
  list: RpgData | undefined,
  file: string,
  base: ReadonlyArray<string | number>,
  baseContext: string,
  place: CoverageKey,
) => {
  if (!isDataArray(list)) {
    return []
  }

  const locations: Array<TextLocation> = []

  for (let index = 0; index < list.length; index++) {
    const command = commandParameters(list[index])

    if (command === undefined) {
      continue
    }

    const { code, parameters } = command
    const context = `${baseContext} -> ${commandNames[code] ?? `Command ${code}`}`
    const first = parameters[0]

    // MZ keeps the speaker name in the fifth parameter of Show Text; older engines have none.
    if (code === 101 && Predicate.isString(parameters[4]) && parameters[4] !== '') {
      locations.push(
        location(file, [...base, index, 'parameters', 4], context, parameters[4], [
          'speakerNames',
          place,
        ]),
      )

      continue
    }

    if ((code === 401 || code === 405) && Predicate.isString(first)) {
      const lines = [first]
      const extraPointers: Array<string> = []

      while (index + 1 < list.length) {
        const next = commandParameters(list[index + 1])
        const line = next?.parameters[0]

        if (next?.code !== code || !Predicate.isString(line)) {
          break
        }

        index++
        lines.push(line)
        extraPointers.push(pointerOf(...base, index, 'parameters', 0))
      }

      const start = index - extraPointers.length

      locations.push(
        location(
          file,
          [...base, start, 'parameters', 0],
          context,
          lines.join('\n'),
          [code === 401 ? 'messages' : 'scrollingText', place],
          { dialogue: true, ...(extraPointers.length > 0 ? { extraPointers } : {}) },
        ),
      )

      continue
    }

    if (code === 102 && isDataArray(first)) {
      for (const [choice, value] of first.entries()) {
        locations.push(
          location(
            file,
            [...base, index, 'parameters', 0, choice],
            `${context}[${choice}]`,
            value,
            ['choices', place],
            { dialogue: true },
          ),
        )
      }

      continue
    }

    if ((code === 320 || code === 324 || code === 325) && Predicate.isString(parameters[1])) {
      locations.push(
        location(file, [...base, index, 'parameters', 1], context, parameters[1], [
          'nameChanges',
          place,
        ]),
      )
    }
  }

  return locations
}

const pagesOf = (owner: RpgData) => {
  const pages = isDataObject(owner) ? owner['pages'] : undefined

  return entriesOf(isDataArray(pages) ? pages : undefined)
}

const mapLocations = (file: string, data: RpgData) => {
  if (!isDataObject(data)) {
    return []
  }

  const displayName = keyOf(data, 'displayName', 'display_name')

  // MV and MZ store map events in an array; VX Ace stores them in a hash keyed by event id.
  const events = entriesOf(data['events']).flatMap(([eventIndex, event]) =>
    pagesOf(event).flatMap(([pageIndex, page]) =>
      eventCommandLocations(
        isDataObject(page) ? page['list'] : undefined,
        file,
        ['events', eventIndex, 'pages', pageIndex, 'list'],
        `${file} -> events[${eventIndex}] pages[${pageIndex}]`,
        'mapEvents',
      ),
    ),
  )

  return [
    location(file, [displayName], `${file} -> ${displayName}`, data[displayName], [
      'mapDisplayNames',
    ]),
    ...events,
  ]
}

const troopLocations = (file: string, data: RpgData, config: DatabaseFile) =>
  entriesOf(isDataArray(data) ? data : undefined).flatMap(([troopIndex, troop]) =>
    pagesOf(troop).flatMap(([pageIndex, page]) =>
      eventCommandLocations(
        isDataObject(page) ? page['list'] : undefined,
        file,
        [troopIndex, 'pages', pageIndex, 'list'],
        `${file} -> [${troopIndex}] pages[${pageIndex}]`,
        config.coverageKey,
      ),
    ),
  )

const commonEventLocations = (file: string, data: RpgData) =>
  entriesOf(isDataArray(data) ? data : undefined).flatMap(([index, event]) =>
    eventCommandLocations(
      isDataObject(event) ? event['list'] : undefined,
      file,
      [index, 'list'],
      `${file} -> [${index}]`,
      'commonEvents',
    ),
  )

const specialLocations = {
  system: systemLocations,
  'map-infos': mapInfoLocations,
  troops: troopLocations,
}

export const textLocations = (file: string, data: RpgData): ReadonlyArray<TextLocation> => {
  const name = jsonName(file)
  const database = databaseFiles[name]

  if (database !== undefined) {
    return database.special === undefined
      ? databaseLocations(file, data, database)
      : specialLocations[database.special](file, data, database)
  }

  if (name === 'CommonEvents.json') {
    return commonEventLocations(file, data)
  }

  return isMapFile(name) ? mapLocations(file, data) : []
}
