import { assert, describe, it } from '@effect/vitest'
import { bitmapCache } from './bitmapCache'
import { type DecodeRequest, pageLoader } from './pageLoader'

interface Fake {
  readonly width: number
  readonly height: number
  readonly close: () => void
}

const fakeWorker = () => {
  const asked: Array<DecodeRequest> = []
  const pending: Array<(bitmap: Fake) => void> = []

  return {
    asked,
    finish: () =>
      pending.shift()?.({ width: asked.at(-1)?.width ?? 1, height: 1, close: () => {} }),
    decode: (request: DecodeRequest) => {
      const { promise, resolve } = Promise.withResolvers<Fake>()

      asked.push(request)
      pending.push(resolve)

      return promise
    },
  }
}

const request = (key: string, width = 100): DecodeRequest => ({ key, url: `url/${key}`, width })

const settle = () => Promise.resolve().then(() => undefined)

describe('pageLoader', () => {
  it('decodes one page per worker at a time, most wanted first', () => {
    const one = fakeWorker()
    const two = fakeWorker()
    const loader = pageLoader([one, two], bitmapCache<Fake>(1e9))

    loader.want([request('a'), request('b'), request('c')])

    assert.deepStrictEqual(
      [...one.asked, ...two.asked].map((asked) => asked.key),
      ['a', 'b'],
    )
  })

  it('drops waiting pages that are no longer wanted, so a scrubber decodes where it stops', async () => {
    const worker = fakeWorker()
    const loader = pageLoader([worker], bitmapCache<Fake>(1e9))

    loader.want([request('1'), request('2'), request('3')])
    loader.want([request('90'), request('91')])
    worker.finish()
    await settle()

    assert.deepStrictEqual(
      worker.asked.map((asked) => asked.key),
      ['1', '90'],
    )
  })

  it('keeps what it decoded, and decodes a kept page again only when it is too small', async () => {
    const worker = fakeWorker()
    const cache = bitmapCache<Fake>(1e9)
    const loader = pageLoader([worker], cache)

    loader.want([request('a', 100)])
    worker.finish()
    await settle()
    loader.want([request('a', 95)])
    loader.want([request('a', 200)])

    assert.strictEqual(cache.get('a')?.width, 100)

    assert.deepStrictEqual(
      worker.asked.map((asked) => asked.width),
      [100, 200],
    )
  })
})
