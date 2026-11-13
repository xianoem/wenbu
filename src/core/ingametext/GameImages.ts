import { convertIndexedToRgb, decode } from 'fast-png'
import { DateTime, Effect, FileSystem, Option, Path } from 'effect'
import type { RgbaImage } from '#contract/Detections'
import { InGameTextError } from '#contract/InGameText'
import type { Game } from '#contract/Library'
import { encryptedImage, imageRoot, restorePng } from '../library/CgPack'
import { readArchive } from '../rpgmaker/Rgss3a'

export interface GameImage {
  readonly path: string
  readonly fileSize: number
  readonly modifiedAt: string
  readonly read: Effect.Effect<Uint8Array, InGameTextError>
}

const textFolders = new Set(['pictures', 'system', 'titles', 'titles1', 'titles2'])

const failed = (message: string) => () => new InGameTextError({ reason: 'failed', message })

const isRgss = (game: Game) =>
  game.engine === 'rpg-maker-xp' ||
  game.engine === 'rpg-maker-vx' ||
  game.engine === 'rpg-maker-vx-ace'

export const imageKey = (folder: string, file: string) =>
  `${folder}/${file}`
    .replace(/\\/g, '/')
    .replace(/\.(png|rpgmvp|png_)$/i, '')
    .toLowerCase()

const isImageFile = (file: string) => /\.png$/i.test(file) || encryptedImage.test(file)

const modifiedOf = (info: FileSystem.File.Info) =>
  Option.match(info.mtime, {
    onNone: () => '',
    onSome: (time) => DateTime.formatIso(DateTime.fromDateUnsafe(time)),
  })

const looseImages = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folders = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))
  const images: Array<GameImage> = []

  for (const folder of folders) {
    if (!textFolders.has(folder.toLowerCase())) {
      continue
    }

    const files = yield* fs
      .readDirectory(path.join(root, folder), { recursive: true })
      .pipe(Effect.orElseSucceed(() => []))

    for (const file of files) {
      const source = path.join(root, folder, file)
      const info = yield* fs.stat(source).pipe(Effect.option)

      if (Option.isNone(info) || info.value.type !== 'File' || !isImageFile(file)) {
        continue
      }

      const encrypted = encryptedImage.test(file)

      images.push({
        path: imageKey(folder, file),
        fileSize: Number(info.value.size),
        modifiedAt: modifiedOf(info.value),
        read: fs.readFile(source).pipe(
          Effect.map((bytes) => (encrypted ? restorePng(bytes) : bytes)),
          Effect.mapError(failed(`${file} could not be read.`)),
        ),
      })
    }
  }

  return images
})

/** VX Ace prefers what its archive holds over loose files, so the archive is read when present. */
const archiveImages = Effect.fnUntraced(function* (archivePath: string) {
  const fs = yield* FileSystem.FileSystem

  const info = yield* fs
    .stat(archivePath)
    .pipe(Effect.mapError(failed('Game.rgss3a could not be read.')))

  const bytes = yield* fs
    .readFile(archivePath)
    .pipe(Effect.mapError(failed('Game.rgss3a could not be read.')))

  const entries = yield* Effect.try({
    try: () => readArchive(bytes),
    catch: failed('Game.rgss3a could not be read.'),
  })

  return entries.flatMap((entry): ReadonlyArray<GameImage> => {
    const [graphics, folder, ...rest] = entry.path.split('\\')

    if (graphics?.toLowerCase() !== 'graphics' || folder === undefined) {
      return []
    }

    const file = rest.join('/')

    if (!textFolders.has(folder.toLowerCase()) || !isImageFile(file)) {
      return []
    }

    return [
      {
        path: imageKey(folder, file),
        fileSize: Number(info.size),
        modifiedAt: modifiedOf(info),
        read: Effect.try({
          try: () => entry.read(),
          catch: failed(`${file} could not be read.`),
        }),
      },
    ]
  })
})

export const listGameImages = Effect.fn('GameImages.list')(function* (game: Game) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  if (isRgss(game)) {
    const archive = path.join(game.folderPath, 'Game.rgss3a')

    if (yield* fs.exists(archive).pipe(Effect.orElseSucceed(() => false))) {
      return yield* archiveImages(archive)
    }

    return yield* looseImages(path.join(game.folderPath, 'Graphics'))
  }

  const root = yield* imageRoot(game).pipe(
    Effect.mapError(
      (error) => new InGameTextError({ reason: 'not-found', message: error.message }),
    ),
  )

  return yield* looseImages(root)
})

const to8Bit = (value: number, depth: number) => (depth === 16 ? value >> 8 : value)

export const decodeRgba = (bytes: Uint8Array) =>
  Effect.try({
    try: (): RgbaImage => {
      const png = decode(bytes)
      const count = png.width * png.height
      const pixels = new Uint8Array(count * 4)
      const indexed = png.palette !== undefined
      const data = indexed ? convertIndexedToRgb(png) : png.data
      const channels = indexed ? data.length / Math.max(1, count) : png.channels
      const depth = indexed ? 8 : png.depth

      for (let index = 0; index < count; index++) {
        const at = index * channels
        const gray = channels <= 2
        const red = to8Bit(data[at] ?? 0, depth)
        const green = gray ? red : to8Bit(data[at + 1] ?? 0, depth)
        const blue = gray ? red : to8Bit(data[at + 2] ?? 0, depth)
        const hasAlpha = channels === 2 || channels === 4
        const alpha = hasAlpha ? to8Bit(data[gray ? at + 1 : at + 3] ?? 255, depth) : 255

        pixels.set([red, green, blue, alpha], index * 4)
      }

      return { width: png.width, height: png.height, pixels }
    },
    catch: failed('An image could not be decoded.'),
  })
