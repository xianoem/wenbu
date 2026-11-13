import { describe, expect, it } from '@effect/vitest'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { applyTranslations } from './ApplyTranslations'
import { prepareEntries } from './TextEntries'
import { isTextFile, textLocations } from './TextLocations'

const command = (code: number, parameters: Array<string | Array<string> | number>) => ({
  __rubyClass: 'RPG::EventCommand',
  code,
  parameters,
})

const vxAceMap = () => ({
  __rubyClass: 'RPG::Map',
  display_name: '森',
  events: {
    '3': {
      __rubyClass: 'RPG::Event',
      pages: [
        {
          list: [
            command(101, ['Actor1', 0, 0, 2]),
            command(401, ['こんにちは。']),
            command(401, ['元気？']),
            command(102, [['はい', 'いいえ'], 2]),
            command(0, []),
          ],
        },
      ],
    },
  },
})

describe('TextLocations', () => {
  it('recognises text files by their MV or VX Ace name', () => {
    expect(
      ['Map012.json', 'Map012.rvdata2', 'System.rvdata2', 'CommonEvents.json'].every(isTextFile),
    ).toBe(true)

    expect(['Tilesets.json', 'Scripts.rvdata2', 'Animations.json'].some(isTextFile)).toBe(false)
  })

  it('reads hash-keyed VX Ace events and groups consecutive message lines', () => {
    expect(textLocations('Map001.rvdata2', vxAceMap())).toEqual([
      {
        file: 'Map001.rvdata2',
        pointer: '/display_name',
        context: 'Map001.rvdata2 -> display_name',
        value: '森',
        coverage: ['mapDisplayNames'],
      },
      {
        file: 'Map001.rvdata2',
        pointer: '/events/3/pages/0/list/1/parameters/0',
        context: 'Map001.rvdata2 -> events[3] pages[0] -> Show Text',
        value: 'こんにちは。\n元気？',
        coverage: ['messages', 'mapEvents'],
        dialogue: true,
        extraPointers: ['/events/3/pages/0/list/2/parameters/0'],
      },
      {
        file: 'Map001.rvdata2',
        pointer: '/events/3/pages/0/list/3/parameters/0/0',
        context: 'Map001.rvdata2 -> events[3] pages[0] -> Show Choices[0]',
        value: 'はい',
        coverage: ['choices', 'mapEvents'],
        dialogue: true,
      },
      {
        file: 'Map001.rvdata2',
        pointer: '/events/3/pages/0/list/3/parameters/0/1',
        context: 'Map001.rvdata2 -> events[3] pages[0] -> Show Choices[1]',
        value: 'いいえ',
        coverage: ['choices', 'mapEvents'],
        dialogue: true,
      },
    ])
  })

  it('reads battle event text from troops and database fields', () => {
    const troops = [null, { pages: [{ list: [command(401, ['かかってこい！'])] }] }]
    const items = [null, { name: 'ポーション', description: 'HPを回復する。', price: 50 }]

    expect(textLocations('Troops.json', troops).map((location) => location.value)).toEqual([
      'かかってこい！',
    ])

    expect(textLocations('Items.json', items).map((location) => location.pointer)).toEqual([
      '/1/name',
      '/1/description',
    ])
  })

  it('reads MZ speaker names and name changes, tagged with their kind and place', () => {
    const commonEvents = [
      null,
      {
        list: [
          command(101, ['Actor1', 0, 0, 2, 'リード']),
          command(401, ['行くぞ。']),
          command(405, ['昔々…']),
          command(320, [1, 'ハロルド']),
          command(108, ['メモ']),
          command(356, ['Plugin arg']),
        ],
      },
    ]

    expect(
      textLocations('CommonEvents.json', commonEvents).map((location) => [
        location.value,
        location.coverage,
      ]),
    ).toEqual([
      ['リード', ['speakerNames', 'commonEvents']],
      ['行くぞ。', ['messages', 'commonEvents']],
      ['昔々…', ['scrollingText', 'commonEvents']],
      ['ハロルド', ['nameChanges', 'commonEvents']],
    ])
  })

  it('tags troop text as battle events and database fields by their type', () => {
    const troops = [null, { pages: [{ list: [command(102, [['逃げる'], 0])] }] }]

    expect(textLocations('Troops.json', troops).map((location) => location.coverage)).toEqual([
      ['choices', 'battleEvents'],
    ])

    expect(
      textLocations('MapInfos.json', [null, { name: '町' }]).map((location) => location.coverage),
    ).toEqual([['mapListNames']])

    expect(
      textLocations('Skills.json', [null, { name: '炎' }]).map((location) => location.coverage),
    ).toEqual([['skills']])
  })

  it('reads VX Ace snake_case system terms', () => {
    const system = {
      game_title: '冒険',
      currency_unit: 'G',
      elements: ['', '炎'],
      terms: { basic: ['レベル'], messages: { victory: '%1の勝利！' } },
    }

    expect(textLocations('System.rvdata2', system).map((location) => location.pointer)).toEqual([
      '/game_title',
      '/currency_unit',
      '/terms/basic/0',
      '/terms/messages/victory',
      '/elements/0',
      '/elements/1',
    ])
  })
})

describe('prepareEntries', () => {
  const at = (pointer: string, value: string) => ({
    file: 'Map001.json',
    pointer,
    context: 'Map001.json -> Show Text',
    value,
    coverage: ['messages', 'mapEvents'] as const,
  })

  it('skips text whose kind or place is off and filtered values, counting each reason', () => {
    const prepared = prepareEntries(
      [
        at('/a', 'こんにちは'),
        { ...at('/b', '森'), coverage: ['mapListNames'] as const },
        { ...at('/c', 'はい'), coverage: ['choices', 'mapEvents'] as const },
        { ...at('/d', '戦え'), coverage: ['messages', 'battleEvents'] as const },
        at('/e', '12'),
        at('/f', 'Title.png'),
      ],
      {
        ...defaultTranslationSettings,
        coverage: { ...defaultTranslationSettings.coverage, choices: false },
      },
    )

    expect(prepared.entries.map((entry) => entry.src)).toEqual(['こんにちは'])

    expect(Object.fromEntries(prepared.skipped)).toEqual({
      'coverage-disabled': 3,
      number: 1,
      filename: 1,
    })
  })

  it('sends duplicate text once when reuse is on', () => {
    const prepared = prepareEntries([at('/a', '宝箱'), at('/b', '宝箱'), at('/c', '扉')], {
      ...defaultTranslationSettings,
      reuseDuplicates: true,
    })

    expect(prepared.entries).toHaveLength(3)

    expect(prepared.items.map((item) => item.entryIds)).toEqual([
      ['Map001.json::/a', 'Map001.json::/b'],
      ['Map001.json::/c'],
    ])
  })
})

describe('applyTranslations', () => {
  const entry = {
    id: 'Map001.json::/name',
    file: 'Map001.json',
    pointer: '/name',
    src: 'アリス',
    dst: 'Alice',
    context: 'name',
  }

  it('writes a translation when the source still matches', () => {
    const data = { name: 'アリス' }

    expect(applyTranslations(data, [entry], defaultTranslationSettings)).toEqual({
      written: 1,
      unchanged: 0,
      skipped: [],
    })

    expect(data.name).toBe('Alice')
  })

  it('leaves values that changed since extraction', () => {
    const data = { name: 'Changed' }

    expect(applyTranslations(data, [entry], defaultTranslationSettings).skipped).toEqual([
      { entryId: entry.id, reason: 'source-mismatch' },
    ])

    expect(data.name).toBe('Changed')
  })

  it('rejects translations that lose control codes', () => {
    const data = { name: 'Count \\V[1]' }

    const result = applyTranslations(data, [{ ...entry, src: 'Count \\V[1]', dst: 'Count one' }], {
      ...defaultTranslationSettings,
    })

    expect(result.skipped).toEqual([
      { entryId: entry.id, reason: 'broken-formatting', details: ['missing-control-code:\\V[1]'] },
    ])
  })

  it('spreads grouped lines over their commands, padding missing lines', () => {
    const map = vxAceMap()
    const [, dialogue] = textLocations('Map001.rvdata2', map)

    const prepared = prepareEntries(
      dialogue === undefined ? [] : [dialogue],
      defaultTranslationSettings,
    )

    const translated = prepared.entries.map((item) => ({ ...item, dst: 'Hello.\nHow are you?' }))

    expect(applyTranslations(map, translated, defaultTranslationSettings).written).toBe(1)

    expect(map.events['3'].pages[0]?.list.slice(1, 3).map((line) => line.parameters[0])).toEqual([
      'Hello.',
      'How are you?',
    ])

    const shorter = translated.map((item) => ({ ...item, src: 'Hello.\nHow are you?', dst: 'Hi.' }))

    expect(
      applyTranslations(map, shorter, {
        ...defaultTranslationSettings,
        formatting: { ...defaultTranslationSettings.formatting, preserveLineBreaks: false },
      }).written,
    ).toBe(1)

    expect(map.events['3'].pages[0]?.list.slice(1, 3).map((line) => line.parameters[0])).toEqual([
      'Hi.',
      '',
    ])
  })

  it('wraps long lines at whitespace and splits words that do not fit', () => {
    const data = { name: 'アリス' }

    applyTranslations(data, [{ ...entry, dst: 'hello world extraordinary' }], {
      ...defaultTranslationSettings,
      formatting: { ...defaultTranslationSettings.formatting, maxLineLength: 6 },
    })

    expect(data.name).toBe('hello\nworld\nextrao\nrdinar\ny')
  })
})
