import { Effect, FileSystem, Option, type Path, Schema } from 'effect'
import { type DownloadSettings, sourceName, type SourceId } from '#contract/Downloads'
import type { Gallery } from './GallerySource'

const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i

const longestName = 150

export const safeName = (text: string) => {
  const cleaned = [...text]
    .map((character) => ((character.codePointAt(0) ?? 0) < 32 ? ' ' : character))
    .join('')
    .replaceAll(/[<>:"/\\|?*]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, longestName)
    .replace(/[. ]+$/, '')

  if (cleaned === '') {
    return 'Gallery'
  }

  return reserved.test(cleaned) ? `${cleaned}_` : cleaned
}

export const titleFor = (gallery: Gallery, settings: DownloadSettings) =>
  settings.titleLanguage === 'japanese'
    ? Option.getOrElse(gallery.titleJapanese, () => gallery.title)
    : gallery.title

export const galleryFolder = (
  path: Path.Path,
  settings: DownloadSettings,
  source: SourceId,
  gallery: Gallery,
) => {
  const title = safeName(titleFor(gallery, settings))

  if (settings.folderName === 'id-title') {
    return path.join(settings.folder, safeName(`${gallery.id} ${title}`))
  }

  if (settings.folderName === 'source-title') {
    return path.join(settings.folder, sourceName(source), title)
  }

  return path.join(settings.folder, title)
}

export const pageStem = (number: number, total: number) =>
  String(number).padStart(Math.max(3, String(total).length), '0')

const imageFile = /^(\d+)\.(jpe?g|png|webp|gif|avif|jxl)$/i

export const savedPages = Effect.fnUntraced(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem

  if (!(yield* fs.exists(folder))) {
    return new Set<number>()
  }

  const names = yield* fs.readDirectory(folder)

  return new Set(
    names.flatMap((name) => {
      const match = imageFile.exec(name)

      return match === null ? [] : [Number(match[1])]
    }),
  )
})

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/jxl': 'jxl',
}

export const extensionFor = (contentType: string | undefined, url: string) => {
  const fromType = extensions[(contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '']

  if (fromType !== undefined) {
    return fromType
  }

  const fromUrl = /\.(jpe?g|png|webp|gif|avif|jxl)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase()

  return fromUrl === 'jpeg' ? 'jpg' : (fromUrl ?? 'jpg')
}

export const detailsFile = 'info.json'

export const GalleryDetails = Schema.Struct({
  source: Schema.String,
  url: Schema.String,
  id: Schema.String,
  title: Schema.String,
  titleJapanese: Schema.NullOr(Schema.String),
  artists: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  pages: Schema.Int,
  downloadedAt: Schema.String,
})

export const encodeDetails = Schema.encodeEffect(Schema.fromJsonString(GalleryDetails))

export const galleryDetails = (
  gallery: Gallery,
  source: SourceId,
  url: string,
  downloadedAt: string,
): typeof GalleryDetails.Type => ({
  source: sourceName(source),
  url,
  id: gallery.id,
  title: gallery.title,
  titleJapanese: Option.getOrNull(gallery.titleJapanese),
  artists: gallery.artists,
  tags: gallery.tags,
  pages: gallery.pages.length,
  downloadedAt,
})
