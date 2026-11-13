import type { GameProcess } from '#contract/TranslationOverlay'

export interface RunningProcess {
  readonly pid: number
  readonly parentPid: number
  readonly name: string
  readonly path: string
}

interface GamePaths {
  readonly executablePath: string
  readonly folderPath: string
}

const normalized = (path: string) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('\\')))

const fileOf = (path: string) => path.slice(path.lastIndexOf('\\') + 1)

const rankOf = (game: GamePaths, process: RunningProcess) => {
  const executable = normalized(game.executablePath)
  const folder = normalized(game.folderPath)
  const path = normalized(process.path)

  if (path !== '' && path === executable) {
    return { rank: 0, reason: 'Executable path matches this game.' }
  }

  if (path !== '' && folderOf(path) === folder) {
    return { rank: 1, reason: 'Process is running from this game folder.' }
  }

  if (path.startsWith(`${folder}\\`)) {
    return { rank: 2, reason: 'Process is running under this game folder.' }
  }

  if (process.name.toLowerCase() === fileOf(executable)) {
    return { rank: 3, reason: 'Process name matches this game executable.' }
  }

  return undefined
}

export const matchGameProcesses = (
  game: GamePaths,
  processes: ReadonlyArray<RunningProcess>,
  ownPid?: number,
): ReadonlyArray<GameProcess> =>
  processes
    .filter((process) => process.pid > 0 && process.pid !== ownPid)
    .flatMap((process) => {
      const match = rankOf(game, process)

      return match === undefined ? [] : [{ process, ...match }]
    })
    .toSorted(
      (left, right) =>
        left.rank - right.rank || left.process.name.localeCompare(right.process.name),
    )
    .slice(0, 24)
    .map(({ process, reason }) => ({
      processId: process.pid,
      name: process.name,
      executablePath: process.path,
      matchReason: reason,
    }))

export const descendantsOf = (
  roots: ReadonlyArray<number>,
  processes: ReadonlyArray<RunningProcess>,
): ReadonlySet<number> => {
  const found = new Set<number>()
  let frontier = new Set(roots)

  while (frontier.size > 0) {
    const next = new Set<number>()

    for (const process of processes) {
      if (
        frontier.has(process.parentPid) &&
        !found.has(process.pid) &&
        !roots.includes(process.pid)
      ) {
        found.add(process.pid)
        next.add(process.pid)
      }
    }

    frontier = next
  }

  return found
}
