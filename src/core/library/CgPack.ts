import { Effect, FileSystem, Option, Path } from 'effect'
import { type Game, LibraryError } from '#contract/Library'

/** Encrypted MV and MZ images replace the PNG signature and IHDR header with 32 bytes of their own. */
const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])

export const encryptedImage = /\.(rpgmvp|png_)$/i

export const restorePng = (bytes: Uint8Array) => Buffer.concat([pngHeader, bytes.subarray(32)])

const failed = (message: string) => () => new LibraryError({ reason: 'failed', message })

export const imageRoot = Effect.fn('CgPack.imageRoot')(function* (game: Game) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  for (const folder of [['www', 'img'], ['img'], ['Graphics']]) {
    const candidate = path.join(game.folderPath, ...folder)
    const info = yield* fs.stat(candidate).pipe(Effect.option)

    if (Option.isSome(info) && info.value.type === 'Directory') {
      return candidate
    }
  }

  return yield* new LibraryError({
    reason: 'not-found',
    message:
      game.engine === 'rpg-maker-vx-ace'
        ? 'This game keeps its images inside Game.rgss3a. Translate it once to unpack them.'
        : "This game's image folder could not be found.",
  })
})

export const imageFolders = Effect.fn('CgPack.imageFolders')(function* (game: Game) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* imageRoot(game)

  const names = yield* fs
    .readDirectory(root)
    .pipe(Effect.mapError(failed('The image folders could not be read.')))

  const folders = yield* Effect.filter(names, (name) =>
    fs.stat(path.join(root, name)).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.orElseSucceed(() => false),
    ),
  )

  const rank = (name: string) => (name.toLowerCase() === 'pictures' ? 0 : 1)

  return folders.toSorted((left, right) => rank(left) - rank(right) || left.localeCompare(right))
})

export const createCgPack = Effect.fn('CgPack.create')(function* (
  game: Game,
  chosen: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* imageRoot(game)
  const available = yield* imageFolders(game)
  const folders = [...new Set(chosen)]

  if (folders.length === 0) {
    return yield* new LibraryError({
      reason: 'invalid',
      field: 'folders',
      message: 'Choose at least one folder.',
    })
  }

  const unknown = folders.filter((folder) => !available.includes(folder))

  if (unknown.length > 0) {
    return yield* new LibraryError({
      reason: 'invalid',
      field: 'folders',
      message: `These folders aren't in the game: ${unknown.join(', ')}.`,
    })
  }

  const packPath = path.join(game.folderPath, 'CGPack')
  let imageCount = 0
  let skippedCount = 0

  for (const folder of folders) {
    const files = yield* fs
      .readDirectory(path.join(root, folder), { recursive: true })
      .pipe(Effect.mapError(failed(`The ${folder} folder could not be read.`)))

    for (const file of files) {
      const source = path.join(root, folder, file)

      const info = yield* fs
        .stat(source)
        .pipe(Effect.mapError(failed(`${file} could not be read.`)))

      if (info.type !== 'File') {
        continue
      }

      const encrypted = encryptedImage.test(file)

      if (!encrypted && !imageExtensions.has(path.extname(file).toLowerCase())) {
        skippedCount++
        continue
      }

      const target = path.join(
        packPath,
        folder,
        encrypted ? file.replace(encryptedImage, '.png') : file,
      )

      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(Effect.mapError(failed('The CGPack folder could not be created.')))

      if (encrypted) {
        const bytes = yield* fs
          .readFile(source)
          .pipe(Effect.mapError(failed(`${file} could not be read.`)))

        yield* fs
          .writeFile(target, restorePng(bytes))
          .pipe(Effect.mapError(failed(`${file} could not be restored.`)))
      } else {
        yield* fs
          .copyFile(source, target)
          .pipe(Effect.mapError(failed(`${file} could not be copied.`)))
      }

      imageCount++
    }
  }

  return { path: packPath, imageCount, skippedCount }
})
