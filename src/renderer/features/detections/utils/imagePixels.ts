import type { RgbaImage } from '#contract/Detections'

export const imagePixels = async (file: Blob): Promise<RgbaImage> => {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')

  if (context === null) {
    bitmap.close()

    throw new Error('The image could not be read.')
  }

  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  const data = context.getImageData(0, 0, canvas.width, canvas.height)

  return { width: data.width, height: data.height, pixels: new Uint8Array(data.data.buffer) }
}
