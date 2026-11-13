import { describe, expect, it } from '@effect/vitest'
import { chapterKey, matchChapters, sameBook } from './ChapterMatch'

describe('chapterKey', () => {
  it('keeps the name after the number, in one script, without pleas or punctuation', () => {
    expect(chapterKey('第六十六章 神乎其技（双倍最后半天求月票）')).toBe('神乎其技')
    expect(chapterKey('第六十四章 神乎其技（雙倍最後半天求月票）')).toBe('神乎其技')
    expect(chapterKey('第3話　帰り道')).toBe('帰り道')
    expect(chapterKey('第一百章')).toBe('')
  })
})

describe('matchChapters', () => {
  it('matches chapters by name though the sites number them differently', () => {
    const matches = matchChapters(
      [
        { number: 66, title: '第六十六章 神乎其技' },
        { number: 67, title: '第六十七章 夜渡' },
        { number: 68, title: '第六十八章' },
      ],
      [
        { title: '第六十四章 神乎其技', url: 'https://host/64' },
        { title: '第六十五章 夜渡', url: 'https://host/65' },
      ],
    )

    expect(matches).toEqual(
      new Map([
        [66, 'https://host/64'],
        [67, 'https://host/65'],
      ]),
    )
  })

  it('leaves out a name a site uses twice', () => {
    const matches = matchChapters(
      [{ number: 1, title: '第一章 回家' }],
      [
        { title: '第一章 回家', url: 'a' },
        { title: '第九章 回家', url: 'b' },
      ],
    )

    expect(matches.size).toBe(0)
  })
})

describe('sameBook', () => {
  it('compares titles in one script and authors when both are known', () => {
    expect(
      sameBook(
        { title: '劍燭大荒', author: '愛潛水的烏賊' },
        { title: '剑烛大荒', author: '爱潜水的乌贼' },
      ),
    ).toBe(true)

    expect(
      sameBook({ title: '剑烛大荒', author: null }, { title: '劍燭大荒', author: '愛潛水的烏賊' }),
    ).toBe(true)

    expect(
      sameBook(
        { title: '剑烛大荒', author: '别人' },
        { title: '剑烛大荒', author: '爱潜水的乌贼' },
      ),
    ).toBe(false)

    expect(sameBook({ title: '剑烛', author: null }, { title: '剑烛大荒', author: null })).toBe(
      false,
    )

    expect(
      sameBook(
        { title: '劍燭大荒', author: '佚名' },
        { title: '剑烛大荒', author: '爱潜水的乌贼' },
      ),
    ).toBe(true)
  })
})
