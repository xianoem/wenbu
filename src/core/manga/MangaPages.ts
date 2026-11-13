import { Effect, FileSystem, Path } from 'effect'
import { MangaError, type MangaSettings } from '#contract/Manga'

export interface MangaPage {
  readonly source: string
  readonly output: string
  readonly name: string
  readonly translated: boolean
}

const pageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])

const outputExtension = (extension: string, format: MangaSettings['outputFormat']) => {
  if (format === 'png') {
    return '.png'
  }

  if (format === 'webp') {
    return '.webp'
  }

  if (format === 'jpeg') {
    return '.jpg'
  }

  return extension === '.bmp' ? '.png' : extension
}

const naturally = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export const editorOutputFolder = 'editor-output'

const isInside = (entry: string, folder: string) =>
  entry === folder || entry.startsWith(`${folder}/`)

export const isValidFolderName = (name: string) =>
  name.trim() !== '' && !/[\\/:*?"<>|]/.test(name) && name.trim() !== '.' && name.trim() !== '..'

export const listPages = Effect.fn('MangaPages.listPages')(function* (
  folder: string,
  settings: Pick<MangaSettings, 'outputFolderName' | 'outputFormat'>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outputFolder = path.join(folder, settings.outputFolderName)

  const info = yield* fs
    .stat(folder)
    .pipe(
      Effect.mapError(
        () => new MangaError({ reason: 'not-found', message: 'The folder could not be found.' }),
      ),
    )

  if (info.type !== 'Directory') {
    return yield* new MangaError({ reason: 'invalid', message: 'Choose a folder, not a file.' })
  }

  const entries = yield* fs
    .readDirectory(folder, { recursive: true })
    .pipe(
      Effect.mapError(
        () => new MangaError({ reason: 'failed', message: 'The folder could not be read.' }),
      ),
    )

  const outputPrefix = settings.outputFolderName.toLowerCase()

  const names = entries
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => {
      const lower = entry.toLowerCase()

      return (
        pageExtensions.has(path.extname(lower)) &&
        !isInside(lower, outputPrefix) &&
        !isInside(lower, editorOutputFolder)
      )
    })
    .toSorted((left, right) => naturally.compare(left, right))

  const pages = yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const extension = path.extname(name).toLowerCase()
      const stem = name.slice(0, name.length - path.extname(name).length)

      const output = path.join(
        outputFolder,
        `${stem}${outputExtension(extension, settings.outputFormat)}`,
      )

      const translated = yield* Effect.orElseSucceed(fs.exists(output), () => false)

      return { source: path.join(folder, name), output, name, translated } satisfies MangaPage
    }),
  )

  return { outputFolder, pages }
})
