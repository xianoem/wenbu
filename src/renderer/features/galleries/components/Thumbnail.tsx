import { cn } from 'cn'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pageImageUrl, pageThumbnailUrl } from '#contract/PageImage'
import { thumbnailQueue, thumbnailSize } from '../thumbnailQueue'

const queue = thumbnailQueue(4)

const loaded = new Set<string>()

const madeHere = new Map<string, Promise<string | undefined>>()

const makeThumbnail = (file: string, version: number, size: number) => {
  const key = `${file}|${size}|${version}`
  const known = madeHere.get(key)

  if (known !== undefined) {
    return known
  }

  const page = new Image()

  page.src = pageImageUrl(file, version)

  const making = page
    .decode()
    .then(() => createImageBitmap(page, { resizeHeight: size, resizeQuality: 'high' }))
    .then((bitmap) => {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)

      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close()

      return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
    })
    .then(
      (jpeg) => URL.createObjectURL(jpeg),
      () => undefined,
    )

  madeHere.set(key, making)

  return making
}

export function Thumbnail({
  file,
  version,
  size: fixedSize,
  className,
}: {
  readonly file: string
  readonly version: number
  readonly size?: number
  readonly className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [measured, setSize] = useState<number | undefined>(undefined)
  const size = fixedSize ?? measured
  const [allowed, setAllowed] = useState<string | undefined>(undefined)

  const [made, setMade] = useState<{ readonly url: string; readonly source: string } | undefined>(
    undefined,
  )

  const slot = useRef<{ readonly finish: () => void } | undefined>(undefined)
  const url = size === undefined ? undefined : pageThumbnailUrl(file, { size, version })

  useLayoutEffect(() => {
    const element = box.current

    if (element === null) {
      return
    }

    const measure = () =>
      setSize(thumbnailSize(element.clientWidth, element.clientHeight, window.devicePixelRatio))

    const observer = new ResizeObserver(measure)

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (url === undefined || loaded.has(url)) {
      return
    }

    const waiting = queue.wait(() => setAllowed(url))

    slot.current = waiting

    return () => waiting.finish()
  }, [url])

  const finish = () => slot.current?.finish()

  const fallBack = () => {
    if (url === undefined || size === undefined) {
      return
    }

    void makeThumbnail(file, version, size).then((source) => {
      finish()

      if (source !== undefined) {
        setMade({ url, source })
      }
    })
  }

  const shown = () => {
    if (url === undefined) {
      return undefined
    }

    if (made?.url === url) {
      return made.source
    }

    return loaded.has(url) || allowed === url ? url : undefined
  }

  const source = shown()

  return (
    <div ref={box} className={cn('overflow-hidden bg-muted', className)}>
      {source === undefined ? null : (
        <img
          src={source}
          alt=""
          draggable={false}
          decoding="async"
          className="size-full object-cover"
          onLoad={() => {
            loaded.add(source)
            finish()
          }}
          onError={source === url ? fallBack : finish}
        />
      )}
    </div>
  )
}
