import { describe, expect, it } from '@effect/vitest'
import { findCandidates } from './TermScan'

const zhChapters = (() => {
  const names = ['丁松言', '丁轻烟', '青云宗', '烛龙']

  const before = [
    '他看着',
    '只见',
    '原来是',
    '传闻',
    '听说',
    '众人望向',
    '她想起',
    '远处的',
    '据说',
    '谁知',
  ]

  const after = [
    '笑了笑。',
    '沉默不语。',
    '点了点头。',
    '走了过来。',
    '叹了口气。',
    '皱起眉头。',
    '一动不动。',
    '转身离去。',
    '没有回答。',
    '声名远扬。',
  ]

  const chapters: Array<Array<string>> = []

  for (let chapter = 0; chapter < 6; chapter++) {
    const paragraphs: Array<string> = []

    for (let line = 0; line < 30; line++) {
      const name = names[(chapter * 7 + line) % names.length] ?? ''

      paragraphs.push(
        `${before[(line + chapter) % before.length]}${name}${after[(line * 3 + chapter) % after.length]}他们什么也没有说，只是一个人自己走了。`,
      )
    }

    chapters.push(paragraphs)
  }

  return chapters
})()

describe('findCandidates', () => {
  it('finds names and coined terms in Chinese without a dictionary', () => {
    const found = findCandidates('zh', zhChapters).map((candidate) => candidate.text)

    expect(found.slice(0, 4).toSorted()).toEqual(['丁松言', '丁轻烟', '烛龙', '青云宗'].toSorted())
    expect(found).not.toContain('松言')
    expect(found).not.toContain('什么')
    expect(found).not.toContain('他们什么')
  })

  it('reports counts, chapters and a few lines of context', () => {
    const hero = findCandidates('zh', zhChapters).find((candidate) => candidate.text === '丁松言')

    expect(hero?.count).toBeGreaterThan(20)
    expect(hero?.chapters).toEqual([1, 2, 3, 4, 5, 6])
    expect(hero?.contexts.length).toBeGreaterThan(0)
    expect(hero?.contexts[0]).toContain('丁松言')
  })

  it('leaves out terms the glossary already has', () => {
    const found = findCandidates('zh', zhChapters, ['丁鬆言']).map((candidate) => candidate.text)

    expect(found).not.toContain('丁松言')
  })

  it('finds katakana names and kanji terms in Japanese', () => {
    const chapters = [
      Array.from({ length: 40 }, (_, line) =>
        line % 2 === 0
          ? `アリシアは${line % 4 === 0 ? '魔導書' : '剣'}を手に取った。`
          : `王都の門でアリシアが待っていた。`,
      ),
    ]

    const found = findCandidates('ja', chapters).map((candidate) => candidate.text)

    expect(found).toContain('アリシア')
    expect(found).toContain('魔導書')
  })

  it('finds names in Korean with their particles stripped', () => {
    const particles = ['은', '는', '이', '가', '을', '를', '의', '에게']

    const chapters = [
      Array.from(
        { length: 40 },
        (_, line) => `그날 이서준${particles[line % particles.length]} 천천히 걸어갔다.`,
      ),
    ]

    const found = findCandidates('ko', chapters).map((candidate) => candidate.text)

    expect(found[0]).toBe('이서준')
  })
})
