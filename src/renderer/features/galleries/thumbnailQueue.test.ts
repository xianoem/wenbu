import { assert, describe, it } from '@effect/vitest'
import { thumbnailQueue, thumbnailSize } from './thumbnailQueue'

describe('thumbnailQueue', () => {
  it('starts a few at a time, in the order they were asked for', () => {
    const queue = thumbnailQueue(2)
    const started: Array<string> = []
    const done = ['a', 'b', 'c', 'd'].map((name) => queue.wait(() => started.push(name)))

    assert.deepStrictEqual(started, ['a', 'b'])

    done[0]?.finish()

    assert.deepStrictEqual(started, ['a', 'b', 'c'])
  })

  it('never starts a thumbnail whose tile left the screen while it waited', () => {
    const queue = thumbnailQueue(1)
    const started: Array<string> = []
    const first = queue.wait(() => started.push('first'))
    const scrolledAway = queue.wait(() => started.push('scrolled away'))

    queue.wait(() => started.push('visible'))
    scrolledAway.finish()
    first.finish()

    assert.deepStrictEqual(started, ['first', 'visible'])
  })

  it('frees a slot once, however often a thumbnail says it is done', () => {
    const queue = thumbnailQueue(1)
    const started: Array<string> = []
    const first = queue.wait(() => started.push('first'))

    queue.wait(() => started.push('second'))
    queue.wait(() => started.push('third'))
    first.finish()
    first.finish()

    assert.deepStrictEqual(started, ['first', 'second'])
  })
})

describe('thumbnailSize', () => {
  it('asks for the longest side at the screen scale, in steps, so near sizes share one', () => {
    assert.strictEqual(thumbnailSize(180, 252, 1), 256)
    assert.strictEqual(thumbnailSize(180, 252, 2), 512)
    assert.strictEqual(thumbnailSize(181, 254, 2), 512)
    assert.strictEqual(thumbnailSize(10, 10, 1), 64)
  })
})
