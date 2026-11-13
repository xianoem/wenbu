import { describe, expect, it } from '@effect/vitest'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import {
  assetNameOf,
  codeNamesOf,
  eventScriptsOf,
  noProtectedText,
  protectionOf,
} from './ProtectedText'
import { prepareEntries } from './TextEntries'
import type { TextLocation } from './TextLocations'

const commandPatch = `
/*:
 * @plugindesc 通常攻撃の装備設定
 * @help 防具のメモ欄で、通常攻撃スキルを指定できます。
 */
(() => {
  // 魔法 is mentioned in this comment only.
  const commandImageMap = {
    Com_攻撃: "Com_kougeki",
    Com_アイテム_disabled: "Com_item_disabled",
  };
  const tag = armor.meta["通常攻撃スキル"];
  const label = 'メッセージ速度';
  const url = "https://example.com//path";
})();
`

const location = (value: string, pointer: string): TextLocation => ({
  file: 'System.json',
  pointer,
  context: 'System terms',
  value,
  coverage: ['systemTerms'],
})

describe('ProtectedText', () => {
  it('finds the Japanese a plugin works with, but not what its comments say', () => {
    const names = codeNamesOf([commandPatch])

    expect([...names].toSorted()).toEqual(
      ['アイテム', 'メッセージ速度', '攻撃', '通常攻撃スキル'].toSorted(),
    )
  })

  it('reads event scripts and Conditional Branch scripts', () => {
    const scripts = eventScriptsOf({
      events: [
        {
          list: [
            { code: 355, parameters: ['$gameActors.actor(1).name() === "リリア"'] },
            { code: 655, parameters: ['&& true'] },
            { code: 111, parameters: [12, '$gameParty.leader().name() === "ミカ"'] },
            { code: 111, parameters: [0, 1, 0] },
            { code: 401, parameters: ['こんにちは'] },
          ],
        },
      ],
    })

    expect(scripts).toEqual([
      '$gameActors.actor(1).name() === "リリア"',
      '&& true',
      '$gameParty.leader().name() === "ミカ"',
    ])
  })

  it('names assets the way games refer to them', () => {
    expect([assetNameOf('img/SoRBatCom/Com_kougeki.png_'), assetNameOf('立ち絵.rpgmvp')]).toEqual([
      'com_kougeki',
      '立ち絵',
    ])
  })

  it('keeps names the game uses as values out of a translation', () => {
    const protection = {
      codeNames: codeNamesOf([commandPatch]),
      assetNames: new Set(['ミカ立ち絵']),
    }

    const prepared = prepareEntries(
      [
        location('攻撃', 'terms.commands[0]'),
        location('防御', 'terms.commands[1]'),
        location('ミカ立ち絵', 'terms.basic[0]'),
        location('通常攻撃', 'terms.commands[2]'),
      ],
      defaultTranslationSettings,
      protection,
    )

    expect(prepared.entries.map((entry) => entry.src)).toEqual(['防御', '通常攻撃'])

    expect([...prepared.skipped]).toEqual([
      ['used-by-code', 1],
      ['asset-name', 1],
    ])

    expect(protectionOf('攻撃', ['systemTerms'], noProtectedText)).toBeUndefined()

    const speaker: TextLocation = {
      ...location('攻撃', 'events[1]'),
      coverage: ['speakerNames', 'mapEvents'],
    }

    expect(prepareEntries([speaker], defaultTranslationSettings, protection).entries).toHaveLength(
      1,
    )
  })
})
