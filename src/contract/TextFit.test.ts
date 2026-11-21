import { describe, expect, it } from '@effect/vitest'
import { fitOf, kindOf, measure, messageWindowOf, visibleText } from './TextFit'

describe('kindOf', () => {
  it('reads the window a line appears in from where it is', () => {
    expect(
      [
        'Map012.json -> events[4] pages[0] -> Show Text',
        'Map012.json -> events[4] pages[0] -> Show Choices',
        'CommonEvents.json -> [3] -> Scroll Text',
        'Items.json -> [14].description',
        'Items.json -> [14].name',
        'Skills.json -> [31].message1',
        'Actors.json -> [1].name',
        'System.json -> gameTitle',
      ].map(kindOf),
    ).toEqual(['message', 'choice', 'scroll', 'help', 'item', 'battle', undefined, undefined])
  })
})

describe('visibleText', () => {
  it('drops colour and wait codes and stands in for names and numbers', () => {
    expect(visibleText('\\C[2]灯籠\\C[0]に\\.手を\\N[1]と\\V[3]\\\\')).toBe(
      '灯籠に手をHaroldと000\\',
    )
  })
})

describe('measure', () => {
  it('counts full-width text wider than Latin text', () => {
    const japanese = measure('こんにちは', 28)
    const english = measure('Hello', 28)

    expect(japanese).toBe(140)
    expect(english).toBeLessThan(japanese)
    expect(measure('\\I[5]', 28)).toBe(32)
  })
})

describe('fitOf', () => {
  it('fits a short message and flags one too wide or too long', () => {
    const place = 'Map001.json -> events[1] pages[0] -> Show Text'
    const short = fitOf('rpg-maker-mv', place, 'Hello there.')
    const wide = fitOf('rpg-maker-mv', place, 'A'.repeat(80))
    const tall = fitOf('rpg-maker-mv', place, 'one\ntwo\nthree\nfour\nfive')

    expect(short).toMatchObject({ kind: 'message', status: 'fits', maxLines: 4, maxWidth: 780 })
    expect(wide).toMatchObject({ status: 'too-long', extraLines: 0 })
    expect(wide?.overflowPx).toBeGreaterThan(0)
    expect(tall).toMatchObject({ status: 'too-long', extraLines: 1, overflowPx: 0 })
  })

  it('uses each engine’s own window sizes and leaves unknown places alone', () => {
    const description = 'Items.json -> [3].description'

    expect(fitOf('rpg-maker-vx-ace', description, 'x')?.maxWidth).toBe(520)
    expect(fitOf('rpg-maker-mz', description, 'x')?.maxWidth).toBe(784)
    expect(fitOf('rpg-maker-mv', 'System.json -> gameTitle', 'x')).toBeUndefined()
  })
})

describe('WOLF RPG messages', () => {
  const place = 'mps/Map001.json -> events[1] pages[0] -> Show Text'
  const window = { width: 12, lines: 3 }

  it('measures WOLF codes the way the game draws them', () => {
    expect(visibleText('\\c[2]冬子\\c[0]は\\cself[8]を\\r[鍵,かぎ]', 'wolf-rpg')).toBe(
      '冬子はHaroldを鍵',
    )
  })

  it('wraps a translation to the game’s window and keeps its own line breaks when they fit', () => {
    const fit = fitOf('wolf-rpg', place, 'Yes.\nPlease take care of it for me, okay?', window)

    expect(fit?.lines.map((line) => line.text)).toEqual([
      'Yes.',
      'Please take care of it',
      'for me, okay?',
    ])

    expect(fit).toMatchObject({ kind: 'message', status: 'fits', maxLines: 3, overflowPx: 0 })
  })

  it('joins the lines into one paragraph when keeping the breaks needs too many lines', () => {
    const fit = fitOf('wolf-rpg', place, 'Ah.\nI see.\nSo that is how it was.', {
      ...window,
      lines: 2,
    })

    expect(fit?.lines.map((line) => line.text)).toEqual(['Ah. I see. So that is how', 'it was.'])
    expect(fit?.status).toBe('fits')
  })

  it('counts the speaker’s name line against the window', () => {
    const said = `${place}, said by 冬子`
    const text = 'One two three four five six seven eight nine ten eleven twelve thirteen'

    expect(fitOf('wolf-rpg', place, text, window)?.status).toBe('fits')

    expect(fitOf('wolf-rpg', said, text, window)).toMatchObject({
      status: 'too-long',
      maxLines: 2,
      extraLines: 1,
    })
  })

  it('has no fit without a measured window', () => {
    expect(fitOf('wolf-rpg', place, 'Hello.')).toBeUndefined()
  })

  it('measures the window from the game’s own messages', () => {
    const messages = Array.from({ length: 200 }, (_, index) => ({
      body: index % 2 === 0 ? 'あ'.repeat(18) : `${'い'.repeat(12)}\n${'う'.repeat(16)}`,
      named: index % 2 === 1,
    }))

    expect(messageWindowOf(messages, 'wolf-rpg')).toEqual({ width: 18, lines: 3 })
    expect(messageWindowOf(messages.slice(0, 10), 'wolf-rpg')).toBeUndefined()
  })
})
