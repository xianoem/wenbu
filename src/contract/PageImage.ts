export const pageImageScheme = 'wenbu-image'

const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']

const fontExtensions = ['.ttf', '.otf']

const programExtensions = ['.exe']

export const pageImageUrl = (file: string, version: number) =>
  `${pageImageScheme}://page/${encodeURIComponent(file)}?v=${version}`

const thumbnailSizes = { default: 240, smallest: 32, largest: 1024 }

export const pageThumbnailUrl = (
  file: string,
  options: { readonly size?: number; readonly version?: number } = {},
) => {
  const query = new URLSearchParams()

  if (options.size !== undefined) {
    query.set('s', String(Math.ceil(options.size)))
  }

  if (options.version !== undefined) {
    query.set('v', String(options.version))
  }

  const search = query.size === 0 ? '' : `?${query.toString()}`

  return `${pageImageScheme}://thumbnail/${encodeURIComponent(file)}${search}`
}

const wholeNumber = (text: string | null, fallback: number) => {
  const value = Number(text ?? Number.NaN)

  return Number.isFinite(value) ? Math.ceil(value) : fallback
}

export const thumbnailWanted = (url: string) => {
  const query = parsed(url)?.searchParams
  const size = wholeNumber(query?.get('s') ?? null, thumbnailSizes.default)

  return {
    size: Math.min(thumbnailSizes.largest, Math.max(thumbnailSizes.smallest, size)),
    version: wholeNumber(query?.get('v') ?? null, 0),
  }
}

export const appIconUrl = (file: string) => `${pageImageScheme}://icon/${encodeURIComponent(file)}`

export const pageFontUrl = (file: string) => `${pageImageScheme}://font/${encodeURIComponent(file)}`

const parsed = (url: string) => {
  if (!URL.canParse(url)) {
    return undefined
  }

  const target = new URL(url)

  return target.protocol === `${pageImageScheme}:` ? target : undefined
}

const endsWithAny = (file: string, extensions: ReadonlyArray<string>) => {
  const lower = file.toLowerCase()

  return extensions.some((extension) => lower.endsWith(extension))
}

type Wanted = 'page' | 'thumbnail' | 'font' | 'icon'

const wantedAs = (host: string | undefined): Wanted | undefined => {
  if (host === 'page' || host === 'thumbnail' || host === 'font' || host === 'icon') {
    return host
  }

  return undefined
}

const extensionsFor = (as: Wanted) => {
  if (as === 'font') {
    return fontExtensions
  }

  if (as === 'icon') {
    return programExtensions
  }

  return imageExtensions
}

export const pageImageWanted = (url: string) => {
  const target = parsed(url)
  const as = wantedAs(target?.hostname)
  const file = target === undefined ? '' : decodeURIComponent(target.pathname.slice(1))

  if (as === undefined) {
    return undefined
  }

  const allowed = endsWithAny(file, extensionsFor(as))

  return allowed ? { file, as } : undefined
}

export const pageImageFile = (url: string) => pageImageWanted(url)?.file
