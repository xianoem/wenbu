import { describe, expect, it } from '@effect/vitest'
import { contentFlags, digestBatches, digestPrompt, parseDigests } from './NovelDigests'

const flags = contentFlags(['Amnesia'])

describe('parseDigests', () => {
  it('reads summaries, characters and known flags per chapter', () => {
    const reply = [
      '#3',
      'S|Ding Songyan wakes in a ruined shrine and meets Lin Ya.',
      'C|丁松言; 林雅',
      'F|character-death|the old priest is killed',
      'F|made-up|ignored',
      'F|amnesia|he remembers nothing',
      '',
      '# Chapter 4',
      'S|They leave the valley.',
      'C|丁松言、林雅',
    ].join('\n')

    expect(parseDigests(reply, [3, 4], flags)).toEqual([
      {
        number: 3,
        summary: 'Ding Songyan wakes in a ruined shrine and meets Lin Ya.',
        characters: ['丁松言', '林雅'],
        flags: [
          { id: 'character-death', note: 'the old priest is killed' },
          { id: 'Amnesia', note: 'he remembers nothing' },
        ],
      },
      { number: 4, summary: 'They leave the valley.', characters: ['丁松言', '林雅'], flags: [] },
    ])
  })

  it('leaves out chapters that were not asked for or have no summary', () => {
    const reply = ['#9', 'S|Not asked for.', '#5', 'C|丁松言'].join('\n')

    expect(parseDigests(reply, [5], flags)).toEqual([])
  })
})

describe('digestBatches', () => {
  it('puts at most ten chapters in a batch', () => {
    const chapters = Array.from({ length: 23 }, (_, index) => ({
      number: index + 1,
      title: `第${index + 1}章`,
      paragraphs: ['短'],
    }))

    expect(digestBatches(chapters).map((batch) => batch.length)).toEqual([10, 10, 3])
  })

  it('starts a new batch when the text grows too long', () => {
    const long = { title: 'x', paragraphs: ['字'.repeat(8000)] }
    const chapters = Array.from({ length: 9 }, (_, index) => ({ ...long, number: index + 1 }))

    expect(digestBatches(chapters).map((batch) => batch.length)).toEqual([7, 2])
  })
})

describe('digestPrompt', () => {
  it('lists the flags and every chapter', () => {
    const prompt = digestPrompt(
      [{ number: 1, title: '醒来', paragraphs: ['他醒了。'] }],
      flags,
      'English',
    )

    expect(prompt).toContain('- ntr:')
    expect(prompt).toContain('- Amnesia: Amnesia')
    expect(prompt).toContain('=== Chapter 1: 醒来\n他醒了。')
  })
})
