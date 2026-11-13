import { assert, describe, it } from '@effect/vitest'
import { thumbnailCache } from './thumbnailCache'

const bytes = (length: number) => Promise.resolve(new Uint8Array(length))

describe('thumbnailCache', () => {
  it('makes each thumbnail once, however many ask for it at the same time', async () => {
    const cache = thumbnailCache(1000)
    let made = 0

    const make = () => {
      made += 1

      return bytes(10)
    }

    await Promise.all([cache.get('a', make), cache.get('a', make), cache.get('a', make)])

    assert.strictEqual(made, 1)
  })

  it('drops the thumbnails used longest ago once over its budget', async () => {
    const cache = thumbnailCache(25)
    const made: Array<string> = []

    const make = (key: string) => () => {
      made.push(key)

      return bytes(10)
    }

    await cache.get('a', make('a'))
    await cache.get('b', make('b'))
    await cache.get('a', make('a'))
    await cache.get('c', make('c'))
    await cache.get('a', make('a'))
    await cache.get('b', make('b'))

    assert.deepStrictEqual(made, ['a', 'b', 'c', 'b'])
  })

  it('remembers a file that has no thumbnail, so a slow failure is not repeated', async () => {
    const cache = thumbnailCache(100)
    let tries = 0

    const make = () => {
      tries += 1

      return Promise.resolve(undefined)
    }

    assert.isUndefined(await cache.get('x.avif', make))
    assert.isUndefined(await cache.get('x.avif', make))
    assert.strictEqual(tries, 1)
  })
})
