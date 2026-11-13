import { assert, describe, it } from '@effect/vitest'
import { Option } from 'effect'
import { cleanTitle, codeInInput, codesIn, firstCode, shortcutUrl, titlesFor } from './NameHints'

const codeOf = (name: string) => codesIn(name).map((found) => found.code)

describe('NameHints', () => {
  it('finds RJ, VJ and BJ codes of 6 and 8 digits', () => {
    assert.deepStrictEqual(codeOf('RJ01229425-Battle Shrine Maiden Honoka'), ['RJ01229425'])
    assert.deepStrictEqual(codeOf('RJ419055-Celica Magia'), ['RJ419055'])
    assert.deepStrictEqual(codeOf('Tsumamigui 3-VJ009980'), ['VJ009980'])
    assert.deepStrictEqual(codeOf('White Craving (RJ343309)'), ['RJ343309'])
    assert.deepStrictEqual(codeOf('RJ188734_ENPatch_Decensored'), ['RJ188734'])

    assert.deepStrictEqual(codeOf('[260626][■■■□□ NOWLOADING] 南国ジャンクション [RJ01389169]'), [
      'RJ01389169',
    ])
  })

  it('reads YYMMDD-G names as RJ codes with their release date', () => {
    const [found] = codesIn('230317-G01009019')

    assert.strictEqual(found?.code, 'RJ01009019')
    assert.deepStrictEqual(found?.releasedOn, Option.some('2023-03-17'))
    assert.deepStrictEqual(codeOf('261025-G01664771v1.03'), ['RJ01664771'])
    assert.deepStrictEqual(codeOf('260725-G01444262.part1.rar'), ['RJ01444262'])
    assert.deepStrictEqual(codeOf('230122-G327362'), ['RJ327362'])
  })

  it('ignores codes inside longer words and numbers', () => {
    assert.deepStrictEqual(codeOf('XRJ01229425'), [])
    assert.deepStrictEqual(codeOf('RJ012294251'), [])
    assert.deepStrictEqual(codeOf('RJ12345'), [])
    assert.deepStrictEqual(codeOf('Blue Mage Luna'), [])
  })

  it('takes the first code across names given nearest first', () => {
    const found = firstCode(['百合姫学園 Ver_1.03', '261025-G01664771v1.03', 'Duo Fallen'])

    assert.deepStrictEqual(
      Option.map(found, (code) => code.code),
      Option.some('RJ01664771'),
    )

    assert.isTrue(Option.isNone(firstCode(['Games', 'H', 'D:'])))
  })

  it('cleans versions, copies, site names and noise from titles', () => {
    assert.strictEqual(cleanTitle('Ice_Heart_and_Jack-O_v1.11'), 'Ice Heart and Jack-O')
    assert.strictEqual(cleanTitle('Divagatev1.7'), 'Divagatev1.7')
    assert.strictEqual(cleanTitle('Divagate v1.7'), 'Divagate')

    assert.strictEqual(
      cleanTitle('RJ01345367-Melphias Azure and Crimson Verge - Copy'),
      'Melphias Azure and Crimson Verge',
    )

    assert.strictEqual(cleanTitle('鍛冶師ノ姉ガ堕チル時…ver1.02'), '鍛冶師ノ姉ガ堕チル時')

    assert.strictEqual(
      cleanTitle('Daily_Lives_of_My_Countryside_v0.3.0.1_PC_Bugfix'),
      'Daily Lives of My Countryside',
    )

    assert.strictEqual(cleanTitle('HENTAI4DAILY.COM'), '')

    assert.strictEqual(
      cleanTitle('Happy School Light Hikari & Akari Demo2'),
      'Happy School Light Hikari & Akari',
    )

    assert.strictEqual(cleanTitle('ＳＵＭＭＥＲ　ＲＰＧ'), 'SUMMER RPG')
  })

  it('searches the game folder and the folders above it, up to where games are kept', () => {
    assert.deepStrictEqual(
      titlesFor('D:\\H\\Games\\HeianteiGames\\Boss Office Wife\\人妻上司の分からせ方'),
      ['人妻上司の分からせ方', 'Boss Office Wife', 'HeianteiGames'],
    )

    assert.deepStrictEqual(titlesFor('D:\\H\\Games\\Happy School Light Hikari & Akari Demo2'), [
      'Happy School Light Hikari & Akari',
    ])

    assert.deepStrictEqual(
      titlesFor('D:\\H\\Games\\261028-G01754034\\261028-G01754034\\堕ちる彼女の寝取られ奇譚'),
      ['堕ちる彼女の寝取られ奇譚'],
    )
  })

  it('reads a code from a pasted code or store link', () => {
    assert.deepStrictEqual(codeInInput(' rj01009019 '), Option.some('RJ01009019'))

    assert.deepStrictEqual(
      codeInInput('https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html'),
      Option.some('RJ01009019'),
    )

    assert.isTrue(Option.isNone(codeInInput('Blue Mage Luna')))
  })

  it('reads the link of a .url shortcut', () => {
    const text =
      '[InternetShortcut]\r\nURL=https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html\r\n'

    assert.deepStrictEqual(
      shortcutUrl(text),
      Option.some('https://www.dlsite.com/maniax/work/=/product_id/RJ01009019.html'),
    )
  })
})
