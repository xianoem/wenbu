import { describe, expect, it } from '@effect/vitest'
import type { RpgData } from '../rpgmaker/RpgData'
import { makeIndexBuilder } from './KnowledgeIndex'

const command = (code: number, parameters: Array<RpgData>, indent = 0) => ({
  code,
  indent,
  parameters,
})

const mvPage = (list: Array<RpgData>, conditions: Record<string, RpgData> = {}) => ({
  conditions: {
    switch1Valid: false,
    switch1Id: 1,
    switch2Valid: false,
    switch2Id: 1,
    variableValid: false,
    variableId: 1,
    variableValue: 0,
    selfSwitchValid: false,
    selfSwitchCh: 'A',
    itemValid: false,
    itemId: 1,
    actorValid: false,
    actorId: 1,
    ...conditions,
  },
  image: { characterName: 'People1', tileId: 0 },
  trigger: 0,
  list,
})

const mvMap = {
  displayName: 'Shrine Path',
  width: 3,
  height: 2,
  tilesetId: 1,
  encounterList: [{ troopId: 4 }],
  data: [1, 2, 1, 1, 1, 1, ...Array.from({ length: 5 * 6 }, () => 0)],
  events: [
    null,
    {
      id: 1,
      name: 'Glinting flower',
      x: 2,
      y: 1,
      pages: [
        mvPage(
          [
            command(101, ['Actor1', 0, 0, 2, 'Cook']),
            command(401, ['Will you help me?']),
            command(401, ['I need oil.']),
            command(102, [['Help', 'Leave'], 1]),
            command(402, [0, 'Help']),
            command(111, [8, 5], 1),
            command(126, [7, 0, 0, 1], 2),
            command(123, ['A', 0], 2),
            command(411, [], 1),
            command(121, [3, 3, 0], 2),
            command(412, [], 1),
            command(402, [1, 'Leave']),
            command(201, [0, 2, 10, 4, 0, 0], 1),
          ],
          { switch1Valid: true, switch1Id: 12 },
        ),
        mvPage([command(401, ['Thanks again!'])], { selfSwitchValid: true, selfSwitchCh: 'A' }),
      ],
    },
    {
      id: 2,
      name: 'Merchant',
      x: 0,
      y: 0,
      pages: [mvPage([command(302, [0, 7, 1, 120, false]), command(605, [1, 3, 0, 0])])],
    },
  ],
}

const build = (files: Record<string, RpgData>, tilesets?: RpgData) => {
  const builder = makeIndexBuilder(tilesets)

  for (const [name, data] of Object.entries(files)) {
    builder.add(name, data)
  }

  return builder.finish()
}

describe('Game Knowledge Index', () => {
  it('ties what events give, sell and lead to to their map, event and Gate', () => {
    const index = build({
      'Map001.json': mvMap,
      'MapInfos.json': [null, { id: 1, name: 'North Woods', parentId: 0 }],
      'Items.json': [
        null,
        null,
        null,
        null,
        null,
        { id: 5, name: 'Lantern Oil', description: '', price: 10, itypeId: 1 },
        null,
        { id: 7, name: 'Moonpetal', description: 'A pale flower.', price: 60, itypeId: 2 },
      ],
    })

    expect(index.maps).toEqual([
      expect.objectContaining({
        id: 1,
        name: 'North Woods',
        nameEntry: 'MapInfos.json::/1/name',
        displayName: 'Shrine Path',
        displayEntry: 'Map001.json::/displayName',
        width: 3,
        height: 2,
        encounters: [4],
      }),
    ])

    expect(index.events[0]?.pages[0]?.conditions).toEqual([{ kind: 'switch', id: 12, on: true }])

    const place = { type: 'event', mapId: 1, eventId: 1, page: 0 }
    const helped = { kind: 'choice', text: 'Help' }

    expect(
      index.facts.filter((fact) => fact.place.type === 'event' && fact.place.eventId === 1),
    ).toEqual([
      {
        kind: 'gives',
        place,
        gate: [helped, { kind: 'item', of: 'item', id: 5, has: true }],
        item: { of: 'item', id: 7 },
        amount: 1,
      },
      {
        kind: 'sets',
        place,
        gate: [helped, { kind: 'item', of: 'item', id: 5, has: true }],
        letter: 'A',
        value: true,
      },
      {
        kind: 'sets',
        place,
        gate: [helped, { kind: 'item', of: 'item', id: 5, has: false }],
        switchId: 3,
        value: true,
      },
      {
        kind: 'leads-to',
        place,
        gate: [{ kind: 'choice', text: 'Leave' }],
        to: { mapId: 2, x: 10, y: 4 },
      },
    ])

    expect(index.facts.filter((fact) => fact.kind === 'sells')).toEqual([
      expect.objectContaining({ item: { of: 'item', id: 7 }, price: 120 }),
      expect.objectContaining({ item: { of: 'weapon', id: 3 } }),
    ])

    expect(index.items[1]).toMatchObject({
      id: 7,
      name: 'Moonpetal',
      entry: 'Items.json::/7/name',
      key: true,
    })
  })

  it('keeps dialogue with the translation entry of its first line and the speaker', () => {
    const index = build({ 'Map001.json': mvMap })

    expect(index.lines.slice(0, 3)).toEqual([
      {
        entry: 'Map001.json::/events/1/pages/0/list/1/parameters/0',
        text: 'Will you help me?\nI need oil.',
        place: { type: 'event', mapId: 1, eventId: 1, page: 0 },
        speaker: 'Cook',
        kind: 'dialogue',
      },
      expect.objectContaining({
        text: 'Help',
        kind: 'choice',
        entry: 'Map001.json::/events/1/pages/0/list/3/parameters/0/0',
      }),
      expect.objectContaining({ text: 'Leave', kind: 'choice' }),
    ])
  })

  it('marks the tiles the player can walk on from the tileset flags', () => {
    const index = build({ 'Map001.json': mvMap }, [null, { flags: [0x10, 0, 0x0f] }])
    const bits = atob(index.maps[0]?.passable ?? '').charCodeAt(0)

    expect(bits.toString(2).padStart(6, '0')).toBe('111101')
  })

  it('reads VX Ace data, which keeps events in hashes and uses snake_case', () => {
    const index = build({
      'Map003.rvdata2': {
        display_name: 'Old Well',
        width: 10,
        height: 8,
        encounter_list: [{ troop_id: 2 }],
        events: {
          '4': {
            id: 4,
            name: 'Chest',
            x: 3,
            y: 5,
            pages: [
              {
                condition: {
                  switch1_valid: false,
                  variable_valid: true,
                  variable_id: 9,
                  variable_value: 2,
                  self_switch_valid: false,
                  item_valid: false,
                  actor_valid: false,
                },
                graphic: { character_name: '', tile_id: 0 },
                trigger: 0,
                list: [command(127, [2, 0, 0, 1]), command(301, [0, 6, false, false])],
              },
            ],
          },
        },
      },
      'Enemies.rvdata2': [
        null,
        {
          id: 1,
          name: 'Ghost Moth',
          params: [80, 0, 10, 5, 5, 5, 5, 5],
          exp: 12,
          gold: 4,
          drop_items: [
            { kind: 1, data_id: 7, denominator: 8 },
            { kind: 0, data_id: 0, denominator: 1 },
          ],
          features: [
            { code: 11, data_id: 3, value: 2 },
            { code: 11, data_id: 4, value: 0.5 },
          ],
        },
      ],
    })

    expect(index.maps[0]).toMatchObject({
      id: 3,
      displayName: 'Old Well',
      displayEntry: 'Map003.rvdata2::/display_name',
      encounters: [2],
    })

    expect(index.events[0]).toMatchObject({ mapId: 3, id: 4, name: 'Chest', x: 3, y: 5 })

    expect(index.events[0]?.pages[0]).toEqual({
      conditions: [{ kind: 'variable', id: 9, op: '>=', value: 2 }],
      trigger: 0,
      graphic: false,
    })

    expect(index.facts.map((fact) => [fact.kind, fact.item])).toEqual([
      ['gives', { of: 'weapon', id: 2 }],
      ['fights', { of: 'troop', id: 6 }],
    ])

    expect(index.enemies).toEqual([
      {
        id: 1,
        name: 'Ghost Moth',
        entry: 'Enemies.rvdata2::/1/name',
        hp: 80,
        exp: 12,
        gold: 4,
        drops: [{ of: 'item', id: 7, denominator: 8 }],
        weak: [3],
        resists: [4],
      },
    ])
  })

  it('links common events to the events that call them', () => {
    const index = build({
      'CommonEvents.json': [
        null,
        { id: 1, name: 'Reward', trigger: 0, switchId: 1, list: [command(126, [7, 0, 0, 2])] },
      ],
      'Map001.json': {
        ...mvMap,
        events: [null, { id: 1, name: 'Elder', x: 1, y: 1, pages: [mvPage([command(117, [1])])] }],
      },
    })

    expect(index.commons).toEqual([{ id: 1, name: 'Reward', trigger: 0, switchId: 1 }])

    expect(index.facts).toEqual([
      {
        kind: 'gives',
        place: { type: 'common', id: 1 },
        gate: [],
        item: { of: 'item', id: 7 },
        amount: 2,
      },
      {
        kind: 'calls',
        place: { type: 'event', mapId: 1, eventId: 1, page: 0 },
        gate: [],
        common: 1,
      },
    ])
  })
})
