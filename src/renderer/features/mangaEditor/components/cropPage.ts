import type { RgbaImage } from '#contract/Detections'
import type { PageBox } from '#contract/MangaEditor'

const MIN_SIDE = 96

const PADDING = 6

export const cropPage = (image: ImageBitmap, box: PageBox): RgbaImage => {
  const x = Math.max(0, box.x - PADDING)
  const y = Math.max(0, box.y - PADDING)
  const width = Math.min(image.width - x, box.width + PADDING * 2)
  const height = Math.min(image.height - y, box.height + PADDING * 2)
  const scale = Math.min(4, Math.max(1, Math.ceil(MIN_SIDE / Math.min(width, height))))
  const canvas = new OffscreenCanvas(width * scale, height * scale)
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('The page could not be read.')
  }

  context.imageSmoothingQuality = 'high'
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)

  return { width: pixels.width, height: pixels.height, pixels: new Uint8Array(pixels.data.buffer) }
}
