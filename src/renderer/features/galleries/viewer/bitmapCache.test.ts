import { assert, describe, it } from '@effect/vitest'
import { bitmapCache } from './bitmapCache'

const bitmap = (width: number, height = 1) => {
  const made = { width, height, closed: false, close: () => (made.closed = true) }

  return made
}

describe('bitmapCache', () => {
  it('keeps the wanted pages within its budget, dropping the least wanted first', () => {
    const cache = bitmapCache<ReturnType<typeof bitmap>>(100)
    const a = bitmap(10)
    const b = bitmap(10)
    const c = bitmap(10)

    cache.put('a', a)
    cache.put('b', b)
    cache.put('c', c)
    cache.keep(['c', 'a', 'b'], 80)

    assert.isTrue(b.closed)
    assert.isFalse(a.closed)
    assert.isFalse(c.closed)
    assert.isUndefined(cache.get('b'))
  })

  it('drops pages no longer wanted before any wanted one', () => {
    const cache = bitmapCache<ReturnType<typeof bitmap>>(1000)
    const gone = bitmap(10)
    const near = bitmap(10)

    cache.put('gone', gone)
    cache.put('near', near)
    cache.keep(['near'], 1000)

    assert.isFalse(gone.closed)

    cache.keep(['near'], 40)

    assert.isTrue(gone.closed)
    assert.isFalse(near.closed)
  })

  it('never drops the pages on screen, even when they alone are over budget', () => {
    const cache = bitmapCache<ReturnType<typeof bitmap>>(1000)
    const left = bitmap(100)
    const right = bitmap(100)
    const next = bitmap(10)

    cache.put('left', left)
    cache.put('right', right)
    cache.put('next', next)
    cache.keep(['left', 'right', 'next'], 100, 2)

    assert.isTrue(next.closed)
    assert.isFalse(left.closed)
    assert.isFalse(right.closed)
  })

  it('gives React a new snapshot and a call whenever a page comes or goes', () => {
    const cache = bitmapCache<ReturnType<typeof bitmap>>(1000)
    const page = bitmap(10)
    let calls = 0
    const unsubscribe = cache.subscribe(() => calls++)
    const empty = cache.snapshot()

    cache.put('page', page)

    const filled = cache.snapshot()

    assert.notStrictEqual(filled, empty)
    assert.strictEqual(filled.get('page'), page)
    assert.strictEqual(cache.snapshot(), filled)

    cache.keep([], 0)
    unsubscribe()
    cache.put('other', bitmap(10))

    assert.isUndefined(cache.snapshot().get('page'))
    assert.strictEqual(calls, 2)
  })

  it('closes a page replaced by a new decode of it', () => {
    const cache = bitmapCache<ReturnType<typeof bitmap>>(1000)
    const small = bitmap(10)
    const large = bitmap(20)

    cache.put('page', small)
    cache.put('page', large)

    assert.isTrue(small.closed)
    assert.strictEqual(cache.get('page'), large)
  })
})
