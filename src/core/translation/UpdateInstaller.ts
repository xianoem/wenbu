import { Effect, FileSystem, Option, Path, Schema } from 'effect'
import type { GameEngine } from '#contract/Library'
import { extractZipEntry, readZipEntry, type ZipEntry } from '../platform/ZipIndex'
import type { PlannedFile } from './GameUpdate'

export const updatesFolder = '.wenbu-updates'

const Manifest = Schema.Struct({
  replaced: Schema.Array(Schema.String),
  added: Schema.Array(Schema.String),
})

const ManifestJson = Schema.fromJsonString(Manifest)

const SystemTitle = Schema.Struct({
  gameTitle: Schema.optional(Schema.String),
  game_title: Schema.optional(Schema.String),
})

const decodeSystem = Schema.decodeUnknownOption(Schema.fromJsonString(SystemTitle))

const shiftJis = new TextDecoder('shift_jis')

const iniTitle = (bytes: Uint8Array) =>
  /^\s*Title\s*=\s*(.+?)\s*$/im.exec(shiftJis.decode(bytes))?.[1]

const jsonTitle = (bytes: Uint8Array) =>
  Option.getOrUndefined(
    Option.flatMap(decodeSystem(new TextDecoder().decode(bytes)), (system) =>
      Option.fromNullishOr(system.gameTitle ?? system.game_title),
    ),
  )

const titleFiles: Partial<Record<GameEngine, string>> = {
  'rpg-maker-mv': 'www/data/System.json',
  'rpg-maker-mz': 'data/System.json',
}

const titleFile = (engine: GameEngine) => titleFiles[engine] ?? 'Game.ini'

const titleOf = (engine: GameEngine, bytes: Uint8Array) =>
  titleFile(engine) === 'Game.ini' ? iniTitle(bytes) : jsonTitle(bytes)

export const gameFiles = Effect.fnUntraced(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* fs.readDirectory(folder, { recursive: true })

  return new Set(
    names
      .map((name) => name.replace(/\\/g, '/').toLowerCase())
      .filter((name) => !name.startsWith(updatesFolder)),
  )
})

export const titleInGame = Effect.fnUntraced(function* (folder: string, engine: GameEngine) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = titleFile(engine)
  const original = file.replace(/data\//, 'data.wenbu-original/')

  for (const candidate of [original, file]) {
    const bytes = yield* fs.readFile(path.join(folder, ...candidate.split('/'))).pipe(Effect.option)

    if (Option.isSome(bytes)) {
      return titleOf(engine, bytes.value)
    }
  }

  return undefined
})

export const titleInZip = Effect.fnUntraced(function* (
  archive: string,
  entries: ReadonlyArray<ZipEntry>,
  root: string,
  engine: GameEngine,
) {
  const name = `${root}${titleFile(engine)}`.toLowerCase()
  const entry = entries.find((candidate) => candidate.name.toLowerCase() === name)

  if (entry === undefined) {
    return undefined
  }

  return titleOf(engine, yield* readZipEntry(archive, entry))
})

export const installFiles = Effect.fnUntraced(function* (
  folder: string,
  archive: string,
  files: ReadonlyArray<PlannedFile>,
  stamp: string,
  report: (step: 'unpack' | 'backup' | 'move', done: number, total: number) => Effect.Effect<void>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const backup = path.join(folder, updatesFolder, stamp)
  const staged = path.join(backup, 'new')
  const old = path.join(backup, 'old')
  const total = files.reduce((sum, file) => sum + file.entry.size, 0)
  let done = 0

  const inGame = (file: PlannedFile) => path.join(folder, ...file.path.split('/'))

  for (const file of files) {
    yield* extractZipEntry(archive, file.entry, path.join(staged, ...file.path.split('/')))
    done += file.entry.size
    yield* report('unpack', done, total)
  }

  const replaced: Array<string> = []
  const added: Array<string> = []

  for (const [index, file] of files.entries()) {
    yield* report('backup', index, files.length)

    if (yield* fs.exists(inGame(file))) {
      const target = path.join(old, ...file.path.split('/'))

      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.copyFile(inGame(file), target)
      replaced.push(file.path)
    } else {
      added.push(file.path)
    }
  }

  yield* fs.writeFileString(
    path.join(backup, 'manifest.json'),
    yield* Schema.encodeEffect(ManifestJson)({ replaced, added }),
  )

  const moved: Array<string> = []

  yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        yield* report('move', moved.length, files.length)
        yield* fs.makeDirectory(path.dirname(inGame(file)), { recursive: true })
        yield* fs.remove(inGame(file), { force: true })
        yield* fs.rename(path.join(staged, ...file.path.split('/')), inGame(file))
        moved.push(file.path)
      }),
    { discard: true },
  ).pipe(Effect.tapError(() => restoreFiles(folder, backup, moved).pipe(Effect.ignore)))

  yield* fs.remove(staged, { recursive: true, force: true })

  return { backup, replaced: replaced.length, added: added.length }
})

const restoreFiles = Effect.fnUntraced(function* (
  folder: string,
  backup: string,
  paths: ReadonlyArray<string> | undefined,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const manifest = yield* fs
    .readFileString(path.join(backup, 'manifest.json'))
    .pipe(Effect.flatMap((text) => Schema.decodeEffect(ManifestJson)(text)))

  const only = paths === undefined ? undefined : new Set(paths)

  for (const file of manifest.added) {
    if (only === undefined || only.has(file)) {
      yield* fs.remove(path.join(folder, ...file.split('/')), { force: true })
    }
  }

  for (const file of manifest.replaced) {
    if (only === undefined || only.has(file)) {
      yield* fs.copyFile(
        path.join(backup, 'old', ...file.split('/')),
        path.join(folder, ...file.split('/')),
      )
    }
  }
})

export const restoreBackup = (folder: string, backup: string) =>
  restoreFiles(folder, backup, undefined)
