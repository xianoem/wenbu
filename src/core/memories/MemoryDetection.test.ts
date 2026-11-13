import { describe, expect, it } from '@effect/vitest'
import {
  type GameMemoryData,
  parsePluginList,
  planMemories,
  recollectionModeSwitches,
  sharedSaveOf,
} from './MemoryDetection'
import type { RpgData } from '../rpgmaker/RpgData'

const command = (code: number, parameters: Array<RpgData>): RpgData => ({
  code,
  indent: 0,
  parameters,
})

const page = (list: Array<RpgData>, switchId?: number): RpgData => ({
  conditions: {
    switch1Valid: switchId !== undefined,
    switch1Id: switchId ?? 1,
    switch2Valid: false,
    switch2Id: 1,
    variableValid: false,
  },
  list,
})

const event = (id: number, name: string, pages: Array<RpgData>): RpgData => ({ id, name, pages })

const switchNames = [
  '',
  '夜',
  '回想ルーム入場',
  'シーン1回想',
  'シーン2回想',
  'シーン3回想',
  'H解放1',
]

const mvGame = (overrides: Partial<GameMemoryData> = {}): GameMemoryData => ({
  switchNames,
  mapInfos: [null, { id: 1, name: '町' }, { id: 2, name: '回想ルーム' }],
  maps: new Map([
    [
      2,
      {
        events: [
          null,
          event(1, 'クリスタル1', [page([], 3)]),
          event(2, 'クリスタル2', [page([command(111, [0, 4, 0])])]),
          event(3, '時計', [page([], 1)]),
          event(4, '扉', [page([command(111, [0, 6, 0])])]),
        ],
      },
    ],
  ]),
  commonEvents: [null, { id: 1, name: '回想全開放', list: [command(121, [3, 5, 0])] }],
  plugins: [],
  recollectionSwitches: [],
  ...overrides,
})

describe('MemoryDetection', () => {
  it('reads the plugin list out of plugins.js', () => {
    const plugins = parsePluginList(
      'var $plugins =\n[\n{"name":"UTA_CommonSaveMZ","status":true,"description":"","parameters":{}}\n];\n',
    )

    expect(plugins.map((plugin) => plugin.name)).toEqual(['UTA_CommonSaveMZ'])
    expect(parsePluginList('not a plugin list')).toEqual([])
  })

  it('finds the switches each shared-save plugin keeps outside the save slots', () => {
    const shared = (name: string, parameters: Record<string, string>, status = true) =>
      sharedSaveOf([{ name, status, parameters }])

    expect(shared('UTA_CommonSave', { 'Target Switches': '3-5,9' })).toEqual({
      name: 'UTA_CommonSave',
      switchIds: [3, 4, 5, 9],
    })

    expect(shared('UTA_CommonSaveMZ', { targetSwitches: '["562-564","580"]' })?.switchIds).toEqual([
      562, 563, 564, 580,
    ])

    expect(
      shared('トリアコンタン/VariableCommon', {
        startSwitchId: '460',
        endSwitchId: '462',
        switchList: '["440"]',
      }),
    ).toEqual({ name: 'VariableCommon', switchIds: [440, 460, 461, 462] })

    expect(
      shared('DarkPlasma_SharedSwitchVariable', {
        switchRangeList: JSON.stringify([
          JSON.stringify({ from: '78', to: '79' }),
          JSON.stringify({ from: '93', to: '93' }),
        ]),
      })?.switchIds,
    ).toEqual([78, 79, 93])

    expect(shared('IM_GlobalSave', { start: '320', end: '322' })?.switchIds).toEqual([
      320, 321, 322,
    ])

    expect(shared('JKL_PersistentData', { 'Persistent Switches': '7' })?.switchIds).toEqual([7])
    expect(shared('UTA_CommonSave', { 'Target Switches': '3-5' }, false)).toBeUndefined()
    expect(shared('UTA_CommonSave', { 'Target Switches': '' })).toBeUndefined()
  })

  it('reads the scene switches of the RecollectionMode plugin', () => {
    const source = `var rngd_recollection_mode_settings = { "rec_cg_set": {
      1: { "title": "a", "switch_id": 1001 },
      2: { "title": "b", "switch_id": 1002 } } }`

    expect(recollectionModeSwitches(source)).toEqual([1001, 1002])
  })

  it('suggests what the shared save, the unlock event and named room switches turn on', () => {
    const memories = planMemories(mvGame(), [3])

    expect(memories.rooms).toEqual(['回想ルーム'])
    expect(memories.unlockEvent).toBe('回想全開放')
    expect(memories.sharedSave).toBeUndefined()

    expect(memories.switches).toEqual([
      { id: 1, name: '夜', unlocked: false, sources: ['room'], suggested: false },
      {
        id: 3,
        name: 'シーン1回想',
        unlocked: true,
        sources: ['unlock-event', 'room'],
        suggested: true,
      },
      {
        id: 4,
        name: 'シーン2回想',
        unlocked: false,
        sources: ['unlock-event', 'room'],
        suggested: true,
      },
      { id: 5, name: 'シーン3回想', unlocked: false, sources: ['unlock-event'], suggested: true },
      { id: 6, name: 'H解放1', unlocked: false, sources: ['room'], suggested: true },
    ])
  })

  it('keeps shared and plugin switches and names the unlock event on its map', () => {
    const memories = planMemories(
      mvGame({
        commonEvents: [],
        maps: new Map([
          [
            2,
            {
              events: [null, event(7, 'Unlock all', [page([command(121, [4, 5, 0])])])],
            },
          ],
        ]),
        plugins: [{ name: 'UTA_CommonSave', status: true, parameters: { 'Target Switches': '5' } }],
        recollectionSwitches: [2],
      }),
      [],
    )

    expect(memories.sharedSave).toBe('UTA_CommonSave')
    expect(memories.unlockEvent).toBe('Unlock all on map 2')

    expect(memories.switches.map((entry) => [entry.id, entry.sources])).toEqual([
      [2, ['recollection-plugin']],
      [4, ['unlock-event']],
      [5, ['shared-save', 'unlock-event']],
    ])
  })

  it('reads VX Ace names and conditions', () => {
    const memories = planMemories(
      {
        switchNames,
        mapInfos: { 1: { name: 'Recollection Room' }, 2: { name: 'Town' } },
        maps: new Map([
          [
            1,
            {
              events: {
                1: {
                  name: 'Book',
                  pages: [
                    {
                      conditions: { switch1_valid: true, switch1_id: 4, switch2_valid: false },
                      list: [],
                    },
                  ],
                },
              },
            },
          ],
        ]),
        commonEvents: [],
        plugins: [],
        recollectionSwitches: [],
      },
      [],
      { name: 'ゲーム内共有変数', switchIds: [5] },
    )

    expect(memories.rooms).toEqual(['Recollection Room'])
    expect(memories.sharedSave).toBe('ゲーム内共有変数')
    expect(memories.switches.map((entry) => entry.id)).toEqual([4, 5])
  })

  it('suggests every room switch when the room is all Wenbu found and no name says scene', () => {
    const memories = planMemories(
      mvGame({
        switchNames: ['', '妈妈的审问4', '凌华泳衣'],
        maps: new Map([
          [
            2,
            { events: [null, event(1, 'EV001', [page([], 1)]), event(2, 'EV002', [page([], 2)])] },
          ],
        ]),
        commonEvents: [],
      }),
      [2],
    )

    expect(memories.switches.map((entry) => [entry.id, entry.unlocked, entry.suggested])).toEqual([
      [1, false, true],
      [2, true, true],
    ])
  })

  it('finds nothing in a game without a recollection room', () => {
    const memories = planMemories(
      mvGame({ mapInfos: [null, { id: 1, name: '町' }], commonEvents: [] }),
      [],
    )

    expect(memories).toEqual({ rooms: [], switches: [] })
  })
})
