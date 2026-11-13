import { useLayoutEffect, useRef } from 'react'
import type { GalleryPage } from '#contract/Galleries'
import { pageImageUrl } from '#contract/PageImage'
import { Thumbnail } from '../components/Thumbnail'

export const placeholderSize = 384

const isAnimated = (page: GalleryPage) => page.name.toLowerCase().endsWith('.gif')

function Canvas({ bitmap }: { readonly bitmap: ImageBitmap }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const element = canvas.current

    if (element === null) {
      return
    }

    element.width = bitmap.width
    element.height = bitmap.height
    element.getContext('2d')?.drawImage(bitmap, 0, 0)
  }, [bitmap])

  return <canvas ref={canvas} className="absolute inset-0 size-full" />
}

export function PageView({
  page,
  width,
  height,
  bitmap,
}: {
  readonly page: GalleryPage
  readonly width: number
  readonly height: number
  readonly bitmap: ImageBitmap | undefined
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden bg-black/30 shadow-[0_10px_40px_rgb(0_0_0/0.6)]"
      style={{ width, height }}
    >
      <Thumbnail
        file={page.file}
        version={page.modifiedMs}
        size={placeholderSize}
        className="absolute inset-0 bg-transparent"
      />
      {isAnimated(page) ? (
        <img
          src={pageImageUrl(page.file, page.modifiedMs)}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      ) : null}
      {bitmap === undefined || isAnimated(page) ? null : <Canvas bitmap={bitmap} />}
    </div>
  )
}

export const isDecoded = (page: GalleryPage) => !isAnimated(page)
