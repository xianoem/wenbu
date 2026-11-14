import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { PictureStyle, ShownLine } from '#contract/Pictures'
import { letterLines } from '../lettering'

/** The style again once its font has loaded, since a canvas draws with a fallback until then. */
function useLoadedStyle(style: PictureStyle) {
  const [loaded, setLoaded] = useState<PictureStyle | undefined>(undefined)

  useEffect(() => {
    let current = true

    document.fonts.load(`16px "${style.font}"`).then(
      () => {
        if (current) {
          setLoaded({ ...style })
        }
      },
      () => undefined,
    )

    return () => {
      current = false
    }
  }, [style])

  return loaded?.font === style.font ? loaded : style
}

export function PictureCanvas({
  image,
  lines,
  pictureStyle,
  className,
  style,
}: {
  readonly image: ImageBitmap
  readonly lines: ReadonlyArray<ShownLine>
  readonly pictureStyle: PictureStyle
  readonly className?: string
  readonly style?: CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const shown = useLoadedStyle(pictureStyle)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')

    if (canvas === null || context === undefined || context === null) {
      return
    }

    canvas.width = image.width
    canvas.height = image.height
    context.clearRect(0, 0, image.width, image.height)
    context.drawImage(image, 0, 0)
    letterLines(context, lines, shown)
  }, [image, lines, shown])

  return <canvas ref={ref} className={className} style={style} />
}

const CROP_PADDING = 6

export function LineCrop({
  image,
  line,
  lines,
  pictureStyle,
}: {
  readonly image: ImageBitmap | undefined
  readonly line: ShownLine
  readonly lines?: ReadonlyArray<ShownLine>
  readonly pictureStyle: PictureStyle
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const shown = useLoadedStyle(pictureStyle)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')

    if (canvas === null || context === undefined || context === null || image === undefined) {
      return
    }

    const x = Math.max(0, line.x - CROP_PADDING)
    const y = Math.max(0, line.y - CROP_PADDING)
    const width = Math.min(image.width - x, line.w + CROP_PADDING * 2)
    const height = Math.min(image.height - y, line.h + CROP_PADDING * 2)

    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.translate(-x, -y)
    context.drawImage(image, 0, 0)

    if (lines !== undefined) {
      letterLines(context, lines, shown)
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
  }, [image, line, lines, shown])

  return (
    <div className="checker flex h-11 items-center justify-center overflow-hidden rounded-[10px]">
      {image === undefined ? null : <canvas ref={ref} className="max-h-full max-w-full" />}
    </div>
  )
}
