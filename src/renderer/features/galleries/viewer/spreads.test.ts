import { assert, describe, it } from '@effect/vitest'
import { matchingPage, pageBoxes, readingOrder, spreadOf, spreadsOf } from './spreads'

const portrait = { width: 700, height: 1000 }
const landscape = { width: 1400, height: 1000 }
const unknown = { width: null, height: null }

describe('spreadsOf', () => {
  it('shows the cover alone, then pairs pages in order', () => {
    assert.deepStrictEqual(spreadsOf([portrait, portrait, portrait, portrait, portrait], false), [
      [0],
      [1, 2],
      [3, 4],
    ])
  })

  it('shows a landscape page alone, since it is already a spread, and pairs on after it', () => {
    assert.deepStrictEqual(
      spreadsOf([portrait, portrait, landscape, portrait, portrait, portrait], false),
      [[0], [1], [2], [3, 4], [5]],
    )
  })

  it('moves the pairing by a page when shifted', () => {
    assert.deepStrictEqual(spreadsOf([portrait, portrait, portrait, portrait, portrait], true), [
      [0],
      [1],
      [2, 3],
      [4],
    ])
  })

  it('pairs pages whose size is unknown as if they were portrait', () => {
    assert.deepStrictEqual(spreadsOf([unknown, unknown, unknown], false), [[0], [1, 2]])
  })
})

describe('spreadOf', () => {
  it('finds the spread that holds a page', () => {
    const spreads = spreadsOf([portrait, portrait, portrait, portrait], false)

    assert.strictEqual(spreadOf(spreads, 0), 0)
    assert.strictEqual(spreadOf(spreads, 2), 1)
    assert.strictEqual(spreadOf(spreads, 3), 2)
    assert.strictEqual(spreadOf(spreads, 99), 2)
  })
})

describe('matchingPage', () => {
  const named = (...names: ReadonlyArray<string>) => names.map((name) => ({ name }))

  it('matches pages by name without the extension, since a translation may change format', () => {
    const original = named('1.jpg', '2.jpg', '3.jpg')
    const translated = named('1.png', '2.png', '3.png')

    assert.strictEqual(matchingPage(original, 1, translated), 1)
  })

  it('lands on the nearest page that exists when the page is missing from the other version', () => {
    const original = named('1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg')
    const translated = named('1.png', '4.png', '5.png')

    assert.strictEqual(matchingPage(original, 2, translated), 1)
    assert.strictEqual(matchingPage(original, 1, translated), 0)
  })

  it('stays on the first page when nothing matches', () => {
    assert.strictEqual(matchingPage(named('a.jpg'), 0, named('b.jpg')), 0)
  })
})

describe('readingOrder', () => {
  const spreads = [[0], [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11]]

  it('wants the spread on screen, then the next three, then the one before', () => {
    assert.deepStrictEqual(
      readingOrder(spreads, 2, 3, 1).slice(0, 10),
      [3, 4, 5, 6, 7, 8, 9, 10, 1, 2],
    )
  })

  it('wants only pages that exist near either end', () => {
    assert.deepStrictEqual(readingOrder(spreads, 6, 3, 1), [11, 9, 10])
  })
})

describe('pageBoxes', () => {
  it('fits a spread inside the stage, or across its width', () => {
    const spread = [portrait, portrait]

    assert.deepStrictEqual(pageBoxes(spread, { width: 1400, height: 800 }, 'page'), [
      { width: 560, height: 800 },
      { width: 560, height: 800 },
    ])

    assert.deepStrictEqual(pageBoxes(spread, { width: 1400, height: 800 }, 'width'), [
      { width: 700, height: 1000 },
      { width: 700, height: 1000 },
    ])
  })

  it('shapes a page of unknown size like a typical manga page', () => {
    assert.deepStrictEqual(pageBoxes([unknown], { width: 2000, height: 1000 }, 'page'), [
      { width: 700, height: 1000 },
    ])
  })
})
