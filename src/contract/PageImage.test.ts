import { assert, describe, it } from '@effect/vitest'
import {
  appIconUrl,
  pageFontUrl,
  pageImageFile,
  pageImageUrl,
  pageImageWanted,
  pageThumbnailUrl,
  thumbnailWanted,
} from './PageImage'

describe('PageImage', () => {
  it('names a page image file in a URL and reads it back', () => {
    const file = 'D:\\H\\Doujins\\[Sanbun Kyoden] Part 2\\original\\(5).jpg'

    assert.strictEqual(pageImageFile(pageImageUrl(file, 3)), file)
  })

  it('keeps a version out of the file it names', () => {
    assert.notStrictEqual(pageImageUrl('/a/b.png', 1), pageImageUrl('/a/b.png', 2))
    assert.strictEqual(pageImageFile(pageImageUrl('/a/b.png', 2)), '/a/b.png')
  })

  it('names only image files', () => {
    assert.isUndefined(pageImageFile(pageImageUrl('C:\\Users\\me\\secrets.txt', 0)))
    assert.isUndefined(pageImageFile('https://example.com/page.png'))
    assert.isUndefined(pageImageFile('not a url'))
  })

  it('asks for the whole page or a thumbnail of the same file', () => {
    const file = 'C:\\pages\\(1).jpg'

    assert.deepStrictEqual(pageImageWanted(pageImageUrl(file, 0)), { file, as: 'page' })
    assert.deepStrictEqual(pageImageWanted(pageThumbnailUrl(file)), { file, as: 'thumbnail' })
  })

  it('asks for a thumbnail at a size and version, within bounds', () => {
    const file = 'C:\\pages\\(1).jpg'

    assert.deepStrictEqual(thumbnailWanted(pageThumbnailUrl(file)), { size: 240, version: 0 })

    assert.deepStrictEqual(thumbnailWanted(pageThumbnailUrl(file, { size: 512.4, version: 7 })), {
      size: 513,
      version: 7,
    })

    assert.deepStrictEqual(thumbnailWanted(pageThumbnailUrl(file, { size: 99_999 })), {
      size: 1024,
      version: 0,
    })

    assert.deepStrictEqual(thumbnailWanted(`${pageThumbnailUrl(file)}?s=nope`), {
      size: 240,
      version: 0,
    })

    assert.strictEqual(pageImageFile(pageThumbnailUrl(file, { size: 360 })), file)
  })

  it('serves font files as fonts, and nothing else as one', () => {
    const font = 'C:\\fonts\\anime_ace.ttf'

    assert.deepStrictEqual(pageImageWanted(pageFontUrl(font)), { file: font, as: 'font' })
    assert.isUndefined(pageImageWanted(pageFontUrl('C:\\pages\\(1).jpg')))
    assert.isUndefined(pageImageWanted(pageImageUrl(font, 0)))
  })

  it('serves the icon of a program, and nothing else as one', () => {
    const program = 'C:\\Program Files\\Google\\Chrome\\chrome.exe'

    assert.deepStrictEqual(pageImageWanted(appIconUrl(program)), { file: program, as: 'icon' })
    assert.isUndefined(pageImageWanted(appIconUrl('C:\\pages\\(1).jpg')))
    assert.isUndefined(pageImageWanted(pageImageUrl(program, 0)))
  })
})
