import { Effect, FileSystem, Path } from 'effect'
import type { GameProgram } from '#contract/Library'

const helperExecutable = /^(unins\d*|setup|crashpad|notification_helper|vc_redist|dxwebsetup|nw)$/i

const toolExecutable =
  /config|setting|設定|setup|install|_inst$|unins|crash|redist|directx|patch|check|チェック|tool|ツール|wolftl|uberwolf|chromedriver|nwjc|payload|zsync|^pythonw?$/i

export const comparable = (text: string) => text.toLocaleLowerCase().replace(/\W+/g, '')

export interface RankedProgram {
  readonly file: string
  readonly tool: boolean
}

/** Best first: the picked file, one named like the game, top-level ones, nested ones, then tools. */
export const rankPrograms = (
  path: Path.Path,
  files: ReadonlyArray<string>,
  title: string,
  picked?: string,
): ReadonlyArray<RankedProgram> => {
  const programs = files.filter(
    (file) =>
      file.split(/[\\/]/).length <= 3 &&
      path.extname(file).toLowerCase() === '.exe' &&
      !helperExecutable.test(path.basename(file, path.extname(file))),
  )

  const rankOf = (file: string) => {
    const name = path.basename(file, path.extname(file))

    if (picked !== undefined && file.toLowerCase() === picked.toLowerCase()) {
      return 0
    }

    if (toolExecutable.test(name)) {
      return 4
    }

    if (comparable(name) === comparable(title)) {
      return 1
    }

    return /[\\/]/.test(file) ? 3 : 2
  }

  return programs
    .map((file) => ({ file, rank: rankOf(file) }))
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ file }) => ({
      file,
      tool: toolExecutable.test(path.basename(file, path.extname(file))),
    }))
}

export const isToolProgram = (path: Path.Path, file: string) =>
  toolExecutable.test(path.basename(file, path.extname(file)))

export const listPrograms = Effect.fnUntraced(function* (folderPath: string, title: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const files = yield* fs.readDirectory(folderPath, { recursive: true })

  return yield* Effect.forEach(
    rankPrograms(path, files, title),
    (program): Effect.Effect<GameProgram> =>
      fs.stat(path.join(folderPath, program.file)).pipe(
        Effect.map((stat) => Number(stat.size)),
        Effect.orElseSucceed(() => 0),
        Effect.map((sizeBytes) => ({
          path: path.join(folderPath, program.file),
          name: program.file,
          sizeBytes,
          tool: program.tool,
        })),
      ),
  )
})
