import { describe, expect, it } from '@effect/vitest'
import { unzlibSync } from 'fflate'
import { encodePng, fitWithin } from './RgbaImages'

const solid = (width: number, height: number, rgba: readonly [number, number, number, number]) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, index) => rgba[index % 4] ?? 0),
})

describe('fitWithin', () => {
  it('keeps an image that already fits', () => {
    const image = solid(4, 2, [10, 20, 30, 255])

    expect(fitWithin(image, 4)).toBe(image)
  })

  it('scales the longer side down to the limit, averaging the pixels it merges', () => {
    const image = solid(8, 4, [200, 100, 50, 255])
    const fitted = fitWithin(image, 4)

    expect([fitted.width, fitted.height]).toEqual([4, 2])
    expect([...fitted.pixels.subarray(0, 4)]).toEqual([200, 100, 50, 255])
  })
})

describe('encodePng', () => {
  it('writes a PNG whose image data inflates back to the pixels, row by row', () => {
    const image = solid(2, 2, [1, 2, 3, 255])
    const png = encodePng(image)

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const idat = Buffer.from(png).indexOf('IDAT')
    const length = new DataView(png.buffer, png.byteOffset + idat - 4, 4).getUint32(0)
    const rows = unzlibSync(png.subarray(idat + 4, idat + 4 + length))

    expect([...rows]).toEqual([0, 1, 2, 3, 255, 1, 2, 3, 255, 0, 1, 2, 3, 255, 1, 2, 3, 255])
  })
})
