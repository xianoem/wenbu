import { describe, expect, it } from '@effect/vitest'
import { speakerKeysOf, dialogueSpeakers } from './Speakers'
import { textLocations } from './TextLocations'
import type { RpgData } from './RpgData'

const command = (code: number, parameters: Array<RpgData>) => ({ code, parameters })

const map = (list: Array<RpgData>) => ({
  displayName: '',
  events: [null, { pages: [{ list }] }],
})

describe('dialogueSpeakers', () => {
  it('reads the name box and the face of each message', () => {
    const data = map([
      command(101, ['Actor1', 2, 0, 2, 'リナ']),
      command(401, ['行こう']),
      command(401, ['早く']),
      command(101, ['', 0, 0, 2]),
      command(401, ['……']),
    ])

    const locations = textLocations('Map001.json', data).filter((location) => location.dialogue)
    const speakers = dialogueSpeakers('Map001.json', data)

    expect(locations.map((location) => speakers.get(location.pointer))).toEqual([
      { name: 'リナ', face: 'Actor1:2' },
      undefined,
    ])
  })

  it('reads faces from VX Ace event hashes, which have no name box', () => {
    const data = {
      display_name: '',
      events: {
        '3': { pages: [{ list: [command(101, ['People1', 4, 0, 2]), command(401, ['やあ'])] }] },
      },
    }

    expect([...dialogueSpeakers('Map002.rvdata2', data)]).toEqual([
      ['/events/3/pages/0/list/1/parameters/0', { face: 'People1:4' }],
    ])
  })

  it('reads speakers in common events and troop battles', () => {
    const list = [command(101, ['', 0, 0, 2, '村長']), command(401, ['ようこそ'])]

    expect([...dialogueSpeakers('CommonEvents.json', [null, { list }])]).toEqual([
      ['/1/list/1/parameters/0', { name: '村長' }],
    ])

    expect([...dialogueSpeakers('Troops.json', [null, { pages: [{ list }] }])]).toEqual([
      ['/1/pages/0/list/1/parameters/0', { name: '村長' }],
    ])
  })

  it('reads a name written at the start of the text', () => {
    const data = map([
      command(101, ['', 0, 0, 2]),
      command(401, ['\\N[1]']),
      command(401, ['行こう']),
      command(101, ['', 0, 0, 2]),
      command(401, ['【カイ】']),
      command(401, ['ふん']),
      command(101, ['', 0, 0, 2]),
      command(401, ['\\n<エルダ>ほう？']),
      command(101, ['', 0, 0, 2]),
      command(401, ['【\\N[2]】「待って」']),
    ])

    expect([...dialogueSpeakers('Map001.json', data).values()]).toEqual([
      { actor: 1 },
      { name: 'カイ' },
      { name: 'エルダ' },
      { actor: 2 },
    ])
  })

  it('takes an actor from a name box that only holds \\N[n]', () => {
    const data = map([command(101, ['', 0, 0, 2, '\\N[3]']), command(401, ['うん'])])

    expect([...dialogueSpeakers('Map001.json', data).values()]).toEqual([{ actor: 3 }])
  })

  it('drops colour and icon codes from a speaker name', () => {
    const data = map([
      command(101, ['', 0, 0, 2, '\\C[2]リナ\\C[0]']),
      command(401, ['うん']),
      command(101, ['', 0, 0, 2]),
      command(401, ['【\\I[5]カイ】']),
      command(101, ['', 0, 0, 2, '\\C[2]\\N[1]\\C[0]']),
      command(401, ['行こう']),
    ])

    expect([...dialogueSpeakers('Map001.json', data).values()]).toEqual([
      { name: 'リナ' },
      { name: 'カイ' },
      { actor: 1 },
    ])
  })

  it('finds nothing outside event lists', () => {
    expect(dialogueSpeakers('Items.json', [null, { name: '回復薬' }]).size).toBe(0)
  })
})

describe('speakerKeysOf', () => {
  it('orders keys from the most to the least certain', () => {
    expect(speakerKeysOf({ face: 'Actor1:0', name: 'リナ', actor: 1 })).toEqual([
      'name:リナ',
      'actor:1',
      'face:Actor1:0',
    ])
  })
})
