import { describe, expect, it } from '@effect/vitest'
import { OpenNovel } from '#contract/Background'
import { chapterNotice } from './ChapterNotice'

describe('chapterNotice', () => {
  it('names the novel and opens the first new chapter', () => {
    const notice = chapterNotice('novel-1', 'The Sword Saint', [216, 215, 217])

    expect(notice.title).toBe('The Sword Saint has 3 new chapters')
    expect(notice.body).toBe('From chapter 215')
    expect(notice.target).toEqual(OpenNovel.make({ novelId: 'novel-1', chapter: 215 }))
    expect(notice.buttons.map((button) => button.label)).toEqual(['Read'])
  })

  it('counts a single chapter', () => {
    expect(chapterNotice('novel-1', 'The Sword Saint', [216]).title).toBe(
      'The Sword Saint has 1 new chapter',
    )
  })
})
