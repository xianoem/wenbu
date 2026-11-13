import { assert, describe, it } from '@effect/vitest'
import { Option } from 'effect'
import { chooseFormat } from './HDoujin'
import { extensionFor, pageStem, safeName } from './GalleryFiles'

describe('GalleryFiles', () => {
  it('makes titles safe as Windows folder names', () => {
    assert.strictEqual(safeName('Summer: Festival / Part 2?'), 'Summer Festival Part 2')
    assert.strictEqual(safeName('Ends with dots...'), 'Ends with dots')
    assert.strictEqual(safeName('CON'), 'CON_')
    assert.strictEqual(safeName('  '), 'Gallery')
    assert.strictEqual(safeName('a\u0007b'), 'a b')
  })

  it('pads page numbers so files sort in reading order', () => {
    assert.strictEqual(pageStem(7, 45), '007')
    assert.strictEqual(pageStem(12, 1200), '0012')
  })

  it('names the file after what the site sent', () => {
    assert.strictEqual(extensionFor('image/webp', 'https://x/1.jpg'), 'webp')
    assert.strictEqual(extensionFor(undefined, 'https://x/1.jpeg?x=1'), 'jpg')
    assert.strictEqual(extensionFor('application/octet-stream', 'https://x/1.png'), 'png')
  })

  it('picks the HDoujin format the user chose, or the next smaller one', () => {
    const formats = {
      '0': { id: null, key: 'a' },
      '1600': { id: 2, key: 'b' },
      '1280': { id: 3, key: 'c' },
    }

    assert.deepStrictEqual(
      chooseFormat(formats, '0'),
      Option.some({ width: '1600', id: 2, key: 'b' }),
    )

    assert.deepStrictEqual(
      chooseFormat(formats, '1280'),
      Option.some({ width: '1280', id: 3, key: 'c' }),
    )

    assert.isTrue(Option.isNone(chooseFormat(formats, '980')))
  })
})
