import type { UpdateCheck } from '#contract/GameTranslation'
import type { GameEngine } from '#contract/Library'
import type { ZipEntry } from '../platform/ZipIndex'

export interface UpdatePlanInput {
  readonly archiveName: string
  readonly engine: GameEngine
  readonly entries: ReadonlyArray<ZipEntry>
  readonly existing: ReadonlySet<string>
  readonly gameTitle: string | undefined
  readonly zipTitle: string | undefined
  readonly installedVersion: string | undefined
}

export interface PlannedFile {
  readonly entry: ZipEntry
  readonly path: string
}

const dataFolders: Record<GameEngine, string> = {
  'rpg-maker-mv': 'www/data',
  'rpg-maker-mz': 'data',
  'rpg-maker-vx-ace': 'Data',
  'rpg-maker-vx': 'Data',
  'rpg-maker-xp': 'Data',
  windows: '',
}

const systemFiles: Record<GameEngine, string> = {
  'rpg-maker-mv': 'www/data/System.json',
  'rpg-maker-mz': 'data/System.json',
  'rpg-maker-vx-ace': 'Data/System.rvdata2',
  'rpg-maker-vx': 'Data/System.rvdata',
  'rpg-maker-xp': 'Data/System.rxdata',
  windows: '',
}

const programPattern = /\.(?:exe|dll|bat|cmd|com|ps1|vbs|scr|msi)$/i

const savePattern = /(?:^|\/)save\/|\.(?:rpgsave|rmmzsave)$|(?:^|\/)save\d*\.(?:rvdata2?|rxdata)$/i

const unsafe = (name: string) =>
  name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some((part) => part === '..')

export const versionOf = (archiveName: string) =>
  /(?:ver|v)[\s._-]?(\d+(?:\.\d+)+)/i.exec(archiveName)?.[1] ??
  /(\d+(?:\.\d+)+)\s*版/.exec(archiveName)?.[1]

const compareVersions = (left: string, right: string) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

const rootOf = (engine: GameEngine, names: ReadonlyArray<string>) => {
  const markers = [systemFiles[engine], 'Game.exe', 'Game.rgss3a'].map((marker) =>
    marker.toLowerCase(),
  )

  const data = `${dataFolders[engine].toLowerCase()}/`
  const found: Array<string> = []

  for (const name of names) {
    const lower = name.toLowerCase()

    for (const marker of markers) {
      if (lower === marker || lower.endsWith(`/${marker}`)) {
        found.push(name.slice(0, name.length - marker.length))
      }
    }
  }

  if (found.length === 0) {
    for (const name of names) {
      const lower = name.toLowerCase()
      const at = lower.startsWith(data) ? 0 : lower.indexOf(`/${data}`) + 1

      if (at === 0 && !lower.startsWith(data)) {
        continue
      }

      found.push(name.slice(0, at))
    }
  }

  return found.toSorted((left, right) => left.length - right.length)[0]
}

const count = (value: number, noun: string) =>
  `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`

export const planUpdate = (input: UpdatePlanInput) => {
  const names = input.entries.filter((entry) => !entry.directory).map((entry) => entry.name)
  const root = rootOf(input.engine, names)
  const files: Array<PlannedFile> = []
  let saves = 0

  for (const entry of input.entries) {
    if (entry.directory || root === undefined || !entry.name.startsWith(root)) {
      continue
    }

    const path = entry.name.slice(root.length)

    if (savePattern.test(path)) {
      saves++
      continue
    }

    files.push({ entry, path })
  }

  const replaced = files.filter((file) => input.existing.has(file.path.toLowerCase())).length
  const checks: Array<UpdateCheck> = []

  const check = (
    id: UpdateCheck['id'],
    status: UpdateCheck['status'],
    title: string,
    detail: string,
  ) => checks.push({ id, status, title, detail })

  if (input.zipTitle !== undefined && input.gameTitle !== undefined) {
    if (input.zipTitle.trim() === input.gameTitle.trim()) {
      check('same-game', 'ok', 'Same game', `Title ${input.gameTitle.trim()}`)
    } else {
      check(
        'same-game',
        'blocked',
        'Not this game',
        `The zip holds ${input.zipTitle.trim()}, not ${input.gameTitle.trim()}.`,
      )
    }
  } else if (files.length > 0 && replaced / files.length >= 0.6) {
    check(
      'same-game',
      'ok',
      'Same game',
      replaced === files.length
        ? `All ${count(files.length, 'file')} are already in the game`
        : `${replaced.toLocaleString('en-US')} of ${count(files.length, 'file')} are already in the game`,
    )
  } else {
    check('same-game', 'blocked', 'Not this game', 'Most of its files aren’t in this game.')
  }

  if (root === undefined) {
    check(
      'fits',
      'blocked',
      'Doesn’t fit the folder',
      'Wenbu couldn’t find this game’s files in it.',
    )
  } else {
    check(
      'fits',
      'ok',
      'Fits the folder',
      root === ''
        ? 'Its files map straight onto the game folder'
        : `Its folder ${root.slice(0, -1)} maps onto the game folder`,
    )
  }

  const newPrograms = files
    .filter(
      (file) => programPattern.test(file.path) && !input.existing.has(file.path.toLowerCase()),
    )
    .map((file) => file.path)

  if (input.entries.some((entry) => unsafe(entry.name))) {
    check(
      'safe',
      'blocked',
      'Unsafe paths',
      'It has paths that would land outside the game folder.',
    )
  } else if (newPrograms.length > 0) {
    check(
      'safe',
      'blocked',
      'Adds programs',
      `It adds a program the game doesn’t have: ${newPrograms.slice(0, 3).join(', ')}`,
    )
  } else {
    check('safe', 'ok', 'Nothing outside the game', 'No paths outside the folder, no new programs')
  }

  const version = versionOf(input.archiveName)

  if (version !== undefined && input.installedVersion !== undefined) {
    const order = compareVersions(version, input.installedVersion)

    if (order < 0) {
      check(
        'newer',
        'warning',
        'Older than yours',
        `Version ${version} is older than ${input.installedVersion}. Installing it would undo fixes.`,
      )
    } else {
      check(
        'newer',
        'ok',
        order === 0 ? 'Same version' : 'Newer than yours',
        `Version ${input.installedVersion} → ${version}`,
      )
    }
  } else {
    check(
      'newer',
      'ok',
      'Version',
      version === undefined ? 'No version number in its name to compare' : `Version ${version}`,
    )
  }

  if (saves > 0) {
    check(
      'saves',
      'warning',
      'Has save files',
      `${count(saves, 'save file')} in the zip ${saves === 1 ? 'is' : 'are'} skipped; yours stay as they are`,
    )
  } else {
    check('saves', 'ok', 'Your saves stay', 'The zip has no save files')
  }

  return {
    root: root ?? '',
    version,
    files,
    replaced,
    added: files.length - replaced,
    saves,
    bytes: files.reduce((total, file) => total + file.entry.size, 0),
    checks,
    blocked: checks.some((entry) => entry.status === 'blocked'),
  }
}

export type UpdatePlan = ReturnType<typeof planUpdate>
