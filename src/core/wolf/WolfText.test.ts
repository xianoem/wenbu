import { describe, expect, it } from '@effect/vitest'
import { getAt, type RpgData, setAt } from '../rpgmaker/RpgData'
import {
  decodeWolfData,
  encodeWolfData,
  wolfProtectedText,
  wolfTextLocations,
  wolfWindowOf,
} from './WolfText'

const command = (code: number, stringArgs: ReadonlyArray<string>, index: number) => ({
  code,
  codeStr: 'Command',
  stringArgs: [...stringArgs],
  intArgs: [0],
  index,
})

const map = (...list: ReadonlyArray<ReturnType<typeof command>>) => ({
  events: [{ id: 0, name: '', pages: [{ id: 0, list: [...list] }] }],
})

const decoded = (value: RpgData) => decodeWolfData(structuredClone(value))

describe('wolfTextLocations', () => {
  it('offers a message’s speaker and body apart, and each choice', () => {
    const data = decoded(
      map(
        command(101, ['@10\n冬子：\n　　はい、お願いします。\n'], 0),
        command(102, ['はい', 'いいえ'], 1),
        command(300, ['冬子_会話'], 2),
      ),
    )

    const found = wolfTextLocations('mps/Map001.json', data).map((location) => ({
      pointer: location.pointer,
      value: location.value,
      context: location.context,
      coverage: location.coverage,
    }))

    expect(found).toEqual([
      {
        pointer: '/events/0/pages/0/list/0/wenbu/speaker',
        value: '冬子',
        context: 'mps/Map001.json -> events[0] pages[0] -> Speaker Name',
        coverage: ['speakerNames', 'mapEvents'],
      },
      {
        pointer: '/events/0/pages/0/list/0/wenbu/body',
        value: 'はい、お願いします。',
        context: 'mps/Map001.json -> events[0] pages[0] -> Show Text, said by 冬子',
        coverage: ['messages', 'mapEvents'],
      },
      {
        pointer: '/events/0/pages/0/list/1/stringArgs/0',
        value: 'はい',
        context: 'mps/Map001.json -> events[0] pages[0] -> Show Choices[0]',
        coverage: ['choices', 'mapEvents'],
      },
      {
        pointer: '/events/0/pages/0/list/1/stringArgs/1',
        value: 'いいえ',
        context: 'mps/Map001.json -> events[0] pages[0] -> Show Choices[1]',
        coverage: ['choices', 'mapEvents'],
      },
    ])
  })

  it('reads common events and the database fields players see', () => {
    const common = decoded({
      id: 3,
      name: '会話',
      description: '',
      commands: [command(101, ['@1\n　　扉が開いた。'], 0)],
    })

    const database = decoded({
      types: [
        {
          name: 'アイテム',
          description: '',
          fields: [],
          data: [
            {
              name: '薬草',
              data: [
                { name: 'アイテム名', value: '薬草' },
                { name: '説明文[2行まで可]', value: 'HPを回復する\r\n' },
                { name: '効果', value: 3 },
                { name: '画像', value: 'Picture/薬草.png' },
              ],
            },
          ],
        },
        { name: '敵行動AI', description: '', fields: [], data: [{ name: '', data: [] }] },
      ],
    })

    expect(
      wolfTextLocations('common/3_会話.json', common).map((location) => location.context),
    ).toEqual(['common/3_会話.json -> commands[0] -> Show Text'])

    expect(
      wolfTextLocations('db/DataBase.json', database).map((location) => [
        location.value,
        location.coverage,
      ]),
    ).toEqual([
      ['薬草', ['items']],
      ['HPを回復する\n', ['items']],
    ])
  })
})

describe('encodeWolfData', () => {
  it('writes untouched data back as it was read', () => {
    const original = map(command(101, ['@10\n冬子：\n　　はい。\n'], 0))

    expect(encodeWolfData(decoded(original))).toEqual(original)
  })

  it('wraps a translated body to the measured window under its speaker', () => {
    const data = decoded(map(command(101, ['@10\n冬子：\n　　はい、お願いします。\n'], 0)))

    setAt(data, '/events/0/pages/0/list/0/wenbu/speaker', 'Fuyuko')
    setAt(data, '/events/0/pages/0/list/0/wenbu/body', 'Yes, please take care of it for me.')

    const written = encodeWolfData(data, { width: 12, lines: 4 })

    expect(getAt(written, '/events/0/pages/0/list/0/stringArgs/0')).toBe(
      '@10\nFuyuko:\n　　Yes, please take care of\n　　it for me.\n',
    )

    expect(getAt(written, '/events/0/pages/0/list/0/wenbu')).toBeUndefined()
  })

  it('puts the game’s own line endings back into database text', () => {
    const data = decoded({
      types: [
        {
          name: 'アイテム',
          fields: [],
          data: [{ name: '薬草', data: [{ name: '説明', value: 'HPを回復する\r\n効果小' }] }],
        },
      ],
    })

    setAt(data, '/types/0/data/0/data/0/value', 'Restores HP\nA little')

    expect(getAt(encodeWolfData(data), '/types/0/data/0/data/0/value')).toBe(
      'Restores HP\r\nA little',
    )
  })
})

describe('wolfProtectedText', () => {
  it('keeps names the events look things up by', () => {
    const protection = wolfProtectedText([
      ['common/12_冬子_会話.json', decoded({ id: 12, name: '冬子_会話', commands: [] })],
      [
        'mps/Map001.json',
        decoded(
          map(
            command(300, ['冬子_会話'], 0),
            command(112, ['薬草'], 1),
            command(150, ['Picture/扉.png'], 2),
          ),
        ),
      ],
    ])

    expect([...protection.codeNames].toSorted()).toEqual(['冬子_会話', '薬草'])
    expect([...protection.assetNames]).toEqual(['扉'])
  })
})

describe('wolfWindowOf', () => {
  it('measures the window from the messages', () => {
    const list = Array.from({ length: 60 }, (_, index) =>
      command(101, [`@1\n冬子：\n　　${'あ'.repeat(10)}\n　　${'い'.repeat(14)}`], index),
    )

    expect(wolfWindowOf(wolfTextLocations('mps/Map001.json', decoded(map(...list))))).toEqual({
      width: 14,
      lines: 3,
    })
  })
})
