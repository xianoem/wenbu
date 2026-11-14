import { describe, expect, it } from '@effect/vitest'
import type { GamePicture, PictureStatus } from '#contract/Pictures'
import { groupsOf, nextGroup, readyToApprove } from './groups'

const picture = (
  name: string,
  group: string,
  status: PictureStatus = 'to-review',
): GamePicture => ({
  picture: `pictures/${name}`,
  width: 64,
  height: 32,
  lines: [{ id: 1, x: 0, y: 0, w: 10, h: 10, ocr: group, source: group, keep: false }],
  status,
  group,
  variants: 1,
  original: `C:/data/original/${name}.png`,
})

const all = [
  picture('status_a', 'status'),
  picture('status_b', 'status', 'approved'),
  picture('log', 'log', 'approved'),
  picture('title', 'title', 'kept'),
]

describe('groupsOf', () => {
  it('shows Picture Variants as one group that needs review until every variant is done', () => {
    expect(
      groupsOf(all, 'all').map((group) => [group.key, group.status, group.pictures.length]),
    ).toEqual([
      ['status', 'to-review', 2],
      ['log', 'approved', 1],
      ['title', 'kept', 1],
    ])
  })

  it('keeps only the groups in the chosen state', () => {
    expect(groupsOf(all, 'approved').map((group) => group.key)).toEqual(['log'])
    expect(groupsOf(all, 'to-review').map((group) => group.key)).toEqual(['status'])
  })
})

describe('nextGroup', () => {
  it('moves on to the next group and wraps around', () => {
    const groups = groupsOf(all, 'all')

    expect(nextGroup(groups, 'status', 1)).toBe('log')
    expect(nextGroup(groups, 'title', 1)).toBe('status')
    expect(nextGroup(groups, 'status', -1)).toBe('title')
  })
})

describe('readyToApprove', () => {
  it('needs a cleaned picture and a translation for every line that is not kept', () => {
    const shown = picture('log', 'log')
    const translated = { ...shown.lines[0]!, translation: 'Message Log' }

    expect(readyToApprove(shown)).toBe(false)
    expect(readyToApprove({ ...shown, lines: [translated] })).toBe(false)

    expect(
      readyToApprove({ ...shown, lines: [translated], cleaned: 'C:/data/cleaned/log.png' }),
    ).toBe(true)

    expect(
      readyToApprove({
        ...shown,
        lines: [{ ...shown.lines[0]!, keep: true }],
        cleaned: 'C:/c.png',
      }),
    ).toBe(true)
  })
})
