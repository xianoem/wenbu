import { describe, expect, it } from '@effect/vitest'
import { cleanChapter, cleanTitle, isExtra, splitChapters, splitParagraphs } from './ChapterText'

describe('splitParagraphs', () => {
  it('splits on line breaks and drops indents and blank lines', () => {
    expect(splitParagraphs('　　丁松言睜開眼。\r\n\r\n  「二哥，你醒了？」\n\n\n')).toEqual([
      '丁松言睜開眼。',
      '「二哥，你醒了？」',
    ])
  })
})

describe('splitChapters', () => {
  it('keeps text without a heading as one untitled chapter', () => {
    expect(splitChapters('第一段。\n第二段。')).toEqual([
      { title: null, paragraphs: ['第一段。', '第二段。'] },
    ])
  })

  it('splits on Chinese, Japanese, Korean and English headings', () => {
    const text = [
      '第一章 曉夢',
      '丁松言睜開眼。',
      '第二章 木鳶',
      '院外，一隻木鳶。',
      '第3話　帰り道',
      '道を歩く。',
      '제4화 귀환',
      '집으로 돌아왔다.',
      'Chapter 5: The End',
      'It ended.',
    ].join('\n')

    expect(splitChapters(text).map((chapter) => chapter.title)).toEqual([
      '第一章 曉夢',
      '第二章 木鳶',
      '第3話　帰り道',
      '제4화 귀환',
      'Chapter 5: The End',
    ])
  })

  it('keeps text before the first heading as its own chapter', () => {
    expect(splitChapters('作品相關。\n第一章 開始\n正文。')).toEqual([
      { title: null, paragraphs: ['作品相關。'] },
      { title: '第一章 開始', paragraphs: ['正文。'] },
    ])
  })

  it('does not take a sentence that mentions a chapter for a heading', () => {
    expect(splitChapters('他翻到第一章看了很久，才合上書。')).toHaveLength(1)
  })
})

describe('cleanTitle', () => {
  it('drops ticket and vote pleas at the end', () => {
    expect(cleanTitle('第六十四章 神乎其技（雙倍最後半天求月票）')).toBe('第六十四章 神乎其技')
    expect(cleanTitle('第十章 夜渡(求推薦票)')).toBe('第十章 夜渡')
  })

  it('keeps brackets that are part of the title', () => {
    expect(cleanTitle('第五十章 九首（上）')).toBe('第五十章 九首（上）')
  })
})

describe('isExtra', () => {
  it('marks notices that are not chapters', () => {
    expect(isExtra('歡迎收藏')).toBe(true)
    expect(isExtra('請假條')).toBe(true)
    expect(isExtra('上架感言')).toBe(true)
  })

  it('never marks a numbered chapter', () => {
    expect(isExtra('第十章 上架之後')).toBe(false)
  })
})

describe('cleanChapter', () => {
  it('moves an author note at the end out of the text', () => {
    expect(cleanChapter(['「你叫丁松言。」', 'PS：幾分鐘後還有一章。', '求月票！'])).toEqual({
      paragraphs: ['「你叫丁松言。」'],
      note: 'PS：幾分鐘後還有一章。\n求月票！',
    })
  })

  it('leaves a chapter without a note alone', () => {
    expect(cleanChapter(['一。', '二。'])).toEqual({ paragraphs: ['一。', '二。'], note: null })
  })
})
