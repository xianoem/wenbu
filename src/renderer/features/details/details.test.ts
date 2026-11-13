import { assert, describe, it } from '@effect/vitest'
import { formatExpected, looksLikeCode } from './details'

describe('formatExpected', () => {
  it('reads the planned date the Japanese DLsite words', () => {
    assert.strictEqual(formatExpected('2026年11月14日 発売予定'), 'Nov 14, 2026')
    assert.strictEqual(formatExpected('2026年12月下旬 発売予定'), 'Late Dec 2026')
    assert.strictEqual(formatExpected('2027年01月 発売予定'), 'Jan 2027')
  })

  it('keeps wording it does not know, without the label', () => {
    assert.strictEqual(formatExpected('Oct/30/2026 Upcoming works'), 'Oct/30/2026')
    assert.strictEqual(formatExpected('発売日未定'), '発売日未定')
    assert.strictEqual(formatExpected('未定 発売予定'), 'date not set')
  })
})

describe('looksLikeCode', () => {
  it('takes DLsite codes and links', () => {
    assert.isTrue(looksLikeCode('RJ01664771'))
    assert.isTrue(looksLikeCode('rj123456'))
    assert.isTrue(looksLikeCode('https://www.dlsite.com/maniax/work/=/product_id/RJ01664771.html'))
    assert.isTrue(looksLikeCode('dlsite.com/home/work/=/product_id/VJ012345'))
  })

  it('leaves titles to the search', () => {
    assert.isFalse(looksLikeCode('Duo Fallen Lesbian NTR'))
    assert.isFalse(looksLikeCode('百合姫学園のヘテロセクシャル'))
    assert.isFalse(looksLikeCode('RJ Quest 2'))
  })
})
