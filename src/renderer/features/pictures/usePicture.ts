import { useEffect, useState } from 'react'
import { pageImageUrl } from '#contract/PageImage'

const KEPT = 32

const keyOf = (file: string, version: string) => `${file}|${version}`

const loaded = new Map<string, Promise<ImageBitmap>>()

/** A stable number for a string, so a picture rewritten under the same name gets a new URL. */
export const versionOf = (text: string) => {
  let hash = 0

  for (const char of text) {
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0
  }

  return hash >>> 0
}

export const loadPicture = (file: string, version: string) => {
  const url = pageImageUrl(file, versionOf(version))
  const cached = loaded.get(url)

  if (cached !== undefined) {
    return cached
  }

  const image = new Image()

  // CORS keeps the canvas the picture is drawn on readable, so it can be saved as a PNG.
  image.crossOrigin = 'anonymous'
  image.src = url

  const loading = image.decode().then(() => createImageBitmap(image))

  loaded.set(url, loading)
  loading.catch(() => loaded.delete(url))

  if (loaded.size > KEPT) {
    const oldest = loaded.keys().next().value

    if (oldest !== undefined) {
      loaded.delete(oldest)
    }
  }

  return loading
}

export function usePicture(file: string | undefined, version: string) {
  const [image, setImage] = useState<{ readonly key: string; readonly bitmap: ImageBitmap }>()
  const key = file === undefined ? '' : keyOf(file, version)

  useEffect(() => {
    if (file === undefined) {
      return
    }

    let current = true

    loadPicture(file, version).then(
      (bitmap) => {
        if (current) {
          setImage({ key: keyOf(file, version), bitmap })
        }
      },
      () => undefined,
    )

    return () => {
      current = false
    }
  }, [file, version])

  return image?.key === key ? image.bitmap : undefined
}
