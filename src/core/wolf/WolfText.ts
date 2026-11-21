import { Predicate } from 'effect'
import type { GlossaryEntryKind } from '#contract/GameGlossary'
import type { CoverageKey } from '#contract/GameTranslation'
import type { MessageWindow } from '#contract/Library'
import { messageWindowOf, speakerMark, wrapMessage } from '#contract/TextFit'
import { assetNameOf, type ProtectedText } from '../rpgmaker/ProtectedText'
import {
  isDataArray,
  isDataObject,
  pointerOf,
  type RpgData,
  type RpgDataObject,
} from '../rpgmaker/RpgData'
import type { TextLocation } from '../rpgmaker/TextLocations'
import { composeMessage, parseMessage, type WolfMessage } from './WolfMessage'

const message = 101
const choices = 102

/** Where a message keeps its parts while Wenbu works on it; never written to the game. */
const partsKey = 'wenbu'

/** Marks a database value whose lines ended with `\r\n` in the game. */
const crlfKey = 'wenbuCrlf'

/** The database types players read, by their default WOLF names. */
const databaseTypes: ReadonlyArray<readonly [string, CoverageKey]> = [
  ['技能', 'skills'],
  ['アイテム', 'items'],
  ['武器', 'weapons'],
  ['防具', 'armors'],
  ['状態設定', 'states'],
  ['敵ｷｬﾗ個体ﾃﾞｰﾀ', 'enemies'],
  ['敵キャラ個体データ', 'enemies'],
  ['戦闘コマンド', 'systemTerms'],
  ['属性名の設定', 'systemTerms'],
  ['装備タイプ', 'systemTerms'],
  ['用語設定', 'systemTerms'],
]

/** Commands whose text names something the game looks up, so it must not change. */
const lookupCodes = new Set([112, 212, 213, 250, 300])

const entriesOf = (value: RpgData | undefined) =>
  isDataArray(value) ? value.map((item, index) => [index, item] as const) : []

const stringArgsOf = (command: RpgData | undefined) => {
  const args = isDataObject(command) ? command['stringArgs'] : undefined

  return isDataArray(args) ? args : []
}

const codeOf = (command: RpgData | undefined) =>
  isDataObject(command) && Predicate.isNumber(command['code']) ? command['code'] : undefined

const isPath = (text: string) => /[\\/]/.test(text) && /\.[A-Za-z0-9]{2,4}$/.test(text)

interface CommandList {
  readonly list: RpgData | undefined
  readonly base: ReadonlyArray<string | number>
  readonly context: string
  readonly place: CoverageKey
}

const commandLists = (file: string, data: RpgData): ReadonlyArray<CommandList> => {
  if (!isDataObject(data)) {
    return []
  }

  if (isDataArray(data['commands'])) {
    return [{ list: data['commands'], base: ['commands'], context: file, place: 'commonEvents' }]
  }

  return entriesOf(data['events']).flatMap(([eventIndex, event]) =>
    entriesOf(isDataObject(event) ? event['pages'] : undefined).map(([pageIndex, page]) => ({
      list: isDataObject(page) ? page['list'] : undefined,
      base: ['events', eventIndex, 'pages', pageIndex, 'list'],
      context: `${file} -> events[${eventIndex}] pages[${pageIndex}]`,
      place: 'mapEvents' as const,
    })),
  )
}

const listContext = (lists: CommandList, index: number) =>
  lists.base[0] === 'commands' ? `${lists.context} -> commands[${index}]` : lists.context

const isTypedDatabase = (data: RpgData) => isDataObject(data) && isDataArray(data['types'])

const fieldsOf = (data: RpgData) =>
  entriesOf(isDataObject(data) ? data['types'] : undefined).flatMap(([typeIndex, type]) =>
    entriesOf(isDataObject(type) ? type['data'] : undefined).flatMap(([recordIndex, record]) =>
      entriesOf(isDataObject(record) ? record['data'] : undefined).map(([fieldIndex, field]) => ({
        type,
        record,
        field,
        pointer: ['types', typeIndex, 'data', recordIndex, 'data', fieldIndex, 'value'] as const,
      })),
    ),
  )

const typeName = (type: RpgData) =>
  isDataObject(type) && Predicate.isString(type['name'])
    ? type['name'].replace(/^[\s　┣┗┃\-ー]+/, '')
    : ''

const coverageOf = (type: RpgData) =>
  databaseTypes.find(([name]) => typeName(type).startsWith(name))?.[1]

/** Adds a message's parts beside its text, and evens out database line endings. */
export const decodeWolfData = (data: RpgData): RpgData => {
  for (const lists of commandLists('', data)) {
    for (const [, command] of entriesOf(lists.list)) {
      const text = stringArgsOf(command)[0]

      if (codeOf(command) !== message || !Predicate.isString(text) || !isDataObject(command)) {
        continue
      }

      const parts = parseMessage(text)

      if (parts !== undefined) {
        command[partsKey] = { ...parts, source: parts.body }
      }
    }
  }

  if (isTypedDatabase(data)) {
    for (const { field } of fieldsOf(data)) {
      if (isDataObject(field) && Predicate.isString(field['value'])) {
        if (field['value'].includes('\r\n')) {
          field['value'] = field['value'].replaceAll('\r\n', '\n')
          field[crlfKey] = true
        }
      }
    }
  }

  return data
}

const partsOf = (command: RpgDataObject) => {
  const parts = command[partsKey]

  if (!isDataObject(parts)) {
    return undefined
  }

  const text = (key: string) => (Predicate.isString(parts[key]) ? parts[key] : '')

  return {
    message: {
      head: text('head'),
      before: text('before'),
      speaker: text('speaker'),
      after: text('after'),
      indent: text('indent'),
      body: text('body'),
      tail: text('tail'),
    } satisfies WolfMessage,
    source: text('source'),
  }
}

const composed = (command: RpgDataObject, window: MessageWindow | undefined) => {
  const parts = partsOf(command)

  if (parts === undefined) {
    return undefined
  }

  const { message: found, source } = parts

  const lines =
    found.body === source || window === undefined
      ? undefined
      : wrapMessage(found.body, window, found.speaker !== '')

  return composeMessage(found, lines)
}

/** Writes message parts back into their text, wrapping translated bodies to `window`. */
export const encodeWolfData = (data: RpgData, window?: MessageWindow): RpgData => {
  const copy = structuredClone(data)

  for (const lists of commandLists('', copy)) {
    for (const [, command] of entriesOf(lists.list)) {
      if (!isDataObject(command)) {
        continue
      }

      const text = composed(command, window)
      const args = stringArgsOf(command)

      if (text !== undefined && args.length > 0) {
        args[0] = text
      }

      delete command[partsKey]
    }
  }

  if (isTypedDatabase(copy)) {
    for (const { field } of fieldsOf(copy)) {
      if (isDataObject(field) && field[crlfKey] === true) {
        if (Predicate.isString(field['value'])) {
          field['value'] = field['value'].replaceAll('\n', '\r\n')
        }

        delete field[crlfKey]
      }
    }
  }

  return copy
}

const location = (
  file: string,
  segments: ReadonlyArray<string | number>,
  context: string,
  value: RpgData | undefined,
  coverage: ReadonlyArray<CoverageKey>,
  dialogue = false,
): TextLocation => ({
  file,
  pointer: pointerOf(...segments),
  context,
  value,
  coverage,
  ...(dialogue ? { dialogue } : {}),
})

const messageLocations = (
  file: string,
  command: RpgDataObject,
  at: ReadonlyArray<string | number>,
  context: string,
  place: CoverageKey,
) => {
  const parts = partsOf(command)

  if (parts === undefined) {
    // A message Wenbu could not split is offered whole, and its place keeps it out of wrapping.
    return [
      location(
        file,
        [...at, 'stringArgs', 0],
        `${context} -> Message`,
        stringArgsOf(command)[0],
        ['messages', place],
        true,
      ),
    ]
  }

  const { speaker, body } = parts.message
  const said = speaker === '' ? '' : `${speakerMark}${speaker}`

  return [
    ...(speaker === ''
      ? []
      : [
          location(file, [...at, partsKey, 'speaker'], `${context} -> Speaker Name`, speaker, [
            'speakerNames',
            place,
          ]),
        ]),
    location(
      file,
      [...at, partsKey, 'body'],
      `${context} -> Show Text${said}`,
      body,
      ['messages', place],
      true,
    ),
  ]
}

const eventLocations = (file: string, data: RpgData) =>
  commandLists(file, data).flatMap((lists) =>
    entriesOf(lists.list).flatMap(([index, command]) => {
      const at = [...lists.base, index]
      const context = listContext(lists, index)

      if (!isDataObject(command)) {
        return []
      }

      if (codeOf(command) === message) {
        return messageLocations(file, command, at, context, lists.place)
      }

      if (codeOf(command) === choices) {
        return stringArgsOf(command).map((choice, slot) =>
          location(
            file,
            [...at, 'stringArgs', slot],
            `${context} -> Show Choices[${slot}]`,
            choice,
            ['choices', lists.place],
            true,
          ),
        )
      }

      return []
    }),
  )

const fieldName = (field: RpgData) =>
  isDataObject(field) && Predicate.isString(field['name']) ? field['name'] : ''

const recordName = (record: RpgData) =>
  isDataObject(record) && Predicate.isString(record['name']) ? record['name'] : ''

const databaseLocations = (file: string, data: RpgData) =>
  fieldsOf(data).flatMap(({ type, record, field, pointer }) => {
    const coverage = coverageOf(type)
    const value = isDataObject(field) ? field['value'] : undefined

    if (coverage === undefined || !Predicate.isString(value) || isPath(value)) {
      return []
    }

    const context = `${file} -> ${typeName(type)}[${pointer[3]}] ${recordName(record)}.${fieldName(field)}`

    return [location(file, pointer, context, value, [coverage])]
  })

/** The text of one WolfTL dump file that players can read. */
export const wolfTextLocations = (file: string, data: RpgData): ReadonlyArray<TextLocation> => {
  if (file === 'db/DataBase.json') {
    return databaseLocations(file, data)
  }

  return /^(?:mps|common)\//.test(file) ? eventLocations(file, data) : []
}

const commonEventName = (file: string) => /^common\/\d+_(.+)\.json$/.exec(file)?.[1]

const hasCjk = (text: string) => /[぀-ヿ㐀-鿿]/.test(text)

/** Names that events look things up by, and the files the game draws or plays. */
export const wolfProtectedText = (
  files: ReadonlyArray<readonly [string, RpgData]>,
): ProtectedText => {
  const codeNames = new Set<string>()
  const assetNames = new Set<string>()

  for (const [file, data] of files) {
    const eventName = commonEventName(file)

    if (eventName !== undefined && hasCjk(eventName)) {
      codeNames.add(eventName)
    }

    for (const lists of commandLists(file, data)) {
      for (const [, command] of entriesOf(lists.list)) {
        const code = codeOf(command)

        for (const arg of stringArgsOf(command)) {
          if (!Predicate.isString(arg)) {
            continue
          }

          if (isPath(arg)) {
            assetNames.add(assetNameOf(arg))
          } else if (code !== undefined && lookupCodes.has(code) && hasCjk(arg)) {
            codeNames.add(arg.trim())
          }
        }
      }
    }
  }

  return { codeNames, assetNames }
}

/** Measures a game's message window from the bodies of its original messages. */
export const wolfWindowOf = (locations: ReadonlyArray<TextLocation>) =>
  messageWindowOf(
    locations.flatMap((found) =>
      found.context.includes(' -> Show Text') && Predicate.isString(found.value)
        ? [{ body: found.value, named: found.context.includes(speakerMark) }]
        : [],
    ),
    'wolf-rpg',
  )

/** WolfTL dump files that hold the game's dialogue or its database names. */
export const isWolfTextFile = (file: string) =>
  /^(?:mps|common)\/.+\.json$/.test(file) || file === 'db/DataBase.json'

/** Who says each message, by the place of its body, read from the speaker line above it. */
export const wolfSpeakers = (file: string, data: RpgData) =>
  wolfTextLocations(file, data).flatMap((found) => {
    const at = found.context.indexOf(speakerMark)

    return at === -1
      ? []
      : [[found.pointer, { name: found.context.slice(at + speakerMark.length) }] as const]
  })

const nameKinds: Partial<Record<CoverageKey, GlossaryEntryKind>> = {
  items: 'item',
  weapons: 'item',
  armors: 'item',
  skills: 'skill',
  enemies: 'other',
  states: 'other',
}

/** The names of the database's items, skills, enemies and states. */
export const wolfDatabaseNames = (file: string, data: RpgData) => {
  if (file !== 'db/DataBase.json' || !isDataObject(data)) {
    return []
  }

  return entriesOf(data['types']).flatMap(([, type]) => {
    const coverage = coverageOf(type)
    const kind = coverage === undefined ? undefined : nameKinds[coverage]

    if (kind === undefined || !isDataObject(type)) {
      return []
    }

    return entriesOf(type['data']).flatMap(([, record]) => {
      const name = recordName(record).trim()

      return name === '' ? [] : [{ kind, name }]
    })
  })
}
