import {
  Context,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Schema,
} from 'effect'
import { Hex } from 'effect/encoding'
import type { GameEngine } from '#contract/Library'
import { DiskSpace, folderSize } from '../platform/DiskSpace'
import { assetNameOf, codeNamesOf, eventScriptsOf, type ProtectedText } from './ProtectedText'
import { readArchive } from './Rgss3a'
import type { RpgData } from './RpgData'
import { decodeRubyMarshal, encodeRubyMarshal } from './RubyMarshal'
import { isTextFile, type TextLocation, textLocations } from './TextLocations'

export class GameDataError extends Schema.TaggedError<GameDataError>()('GameDataError', {
  message: Schema.String,
}) {}

export interface GameFiles {
  readonly folderPath: string
  readonly engine: GameEngine
}

const dataFolders: Record<GameEngine, ReadonlyArray<string>> = {
  'rpg-maker-mv': ['www', 'data'],
  'rpg-maker-mz': ['data'],
  'rpg-maker-vx-ace': ['Data'],
  'rpg-maker-vx': ['Data'],
  'rpg-maker-xp': ['Data'],
  windows: [],
}

const codeFolders: Record<GameEngine, ReadonlyArray<ReadonlyArray<string>>> = {
  'rpg-maker-mv': [['www', 'js', 'plugins']],
  'rpg-maker-mz': [['js', 'plugins']],
  'rpg-maker-vx-ace': [],
  'rpg-maker-vx': [],
  'rpg-maker-xp': [],
  windows: [],
}

const assetFolders: Record<GameEngine, ReadonlyArray<ReadonlyArray<string>>> = {
  'rpg-maker-mv': [
    ['www', 'img'],
    ['www', 'audio'],
    ['www', 'movies'],
  ],
  'rpg-maker-mz': [['img'], ['audio'], ['movies']],
  'rpg-maker-vx-ace': [['Graphics'], ['Audio'], ['Movies']],
  'rpg-maker-vx': [['Graphics'], ['Audio']],
  'rpg-maker-xp': [['Graphics'], ['Audio']],
  windows: [],
}

const textDecoder = new TextDecoder()

const JsonText = Schema.fromJsonString(Schema.Unknown)

const decodeJson = Schema.decodeUnknownEffect(JsonText)

const encodeJson = Schema.encodeEffect(JsonText)

const failWith = (message: string) => () => new GameDataError({ message })

const isDataFile = (name: string) => /\.(json|rvdata2)$/i.test(name) && isTextFile(name)

const decode = Effect.fnUntraced(function* (name: string, bytes: Uint8Array) {
  if (/\.rvdata2$/i.test(name)) {
    return yield* Effect.try({
      try: () => decodeRubyMarshal(bytes),
      catch: failWith(`${name} is not a readable VX Ace data file.`),
    })
  }

  const json = yield* decodeJson(textDecoder.decode(bytes)).pipe(
    Effect.mapError(failWith(`${name} is not valid JSON.`)),
  )

  // SAFETY: parsed JSON holds only JSON values, and RpgData includes every JSON value. Validating
  // each node of a large map file with Schema.MutableJson would cost seconds for nothing.
  return json as RpgData
})

const encode = Effect.fnUntraced(function* (name: string, data: RpgData) {
  const cannotEncode = failWith(`${name} could not be encoded.`)

  if (/\.rvdata2$/i.test(name)) {
    return yield* Effect.try({ try: () => encodeRubyMarshal(data), catch: cannotEncode })
  }

  return new TextEncoder().encode(yield* encodeJson(data).pipe(Effect.mapError(cannotEncode)))
})

const isArchivedData = (entryPath: string) =>
  /^Data[\\/][^\\/]+$/i.test(entryPath) && isDataFile(entryPath.split(/[\\/]/).at(-1) ?? '')

const safeSegments = (entryPath: string) => {
  const segments = entryPath.split(/[\\/]+/).filter((segment) => segment !== '')

  const unsafe = segments.some(
    (segment) => segment === '.' || segment === '..' || /^[A-Za-z]:$/.test(segment),
  )

  return unsafe || segments.length === 0 ? undefined : segments
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const disk = yield* DiskSpace
  const crypto = yield* Crypto.Crypto

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))

  const dataPathOf = (game: GameFiles) => path.join(game.folderPath, ...dataFolders[game.engine])

  const archiveOf = (game: GameFiles) => path.join(game.folderPath, 'Game.rgss3a')

  const archiveAsideOf = (game: GameFiles) => `${archiveOf(game)}.wenbu-backup`

  const originalDataOf = (game: GameFiles) => `${dataPathOf(game)}.wenbu-original`

  const fail = (message: string) => Effect.mapError(failWith(message))

  const failWrite =
    (target: string, message: string) =>
    <A, R>(effect: Effect.Effect<A, PlatformError.PlatformError, R>) =>
      effect.pipe(
        disk.refine(target),
        Effect.catchTag('PlatformError', () => Effect.fail(new GameDataError({ message }))),
      )

  const dataFiles = Effect.fnUntraced(function* (dataPath: string) {
    const names = yield* fs
      .readDirectory(dataPath)
      .pipe(fail('The game data folder could not be read.'))

    return names.filter(isDataFile).toSorted((left, right) => left.localeCompare(right))
  })

  const readData = Effect.fnUntraced(function* (filePath: string) {
    const bytes = yield* fs
      .readFile(filePath)
      .pipe(fail(`${path.basename(filePath)} could not be read.`))

    return yield* decode(path.basename(filePath), bytes)
  })

  const writeData = Effect.fnUntraced(function* (filePath: string, data: RpgData) {
    const name = path.basename(filePath)
    const bytes = yield* encode(name, data)

    yield* fs
      .writeFile(filePath, bytes)
      .pipe(failWrite(filePath, `${name} could not be written. Close the game and try again.`))
  })

  const readGameArchive = Effect.fnUntraced(function* (archivePath: string) {
    const bytes = yield* fs.readFile(archivePath).pipe(fail('Game.rgss3a could not be read.'))

    return yield* Effect.try({
      try: () => readArchive(bytes),
      catch: failWith('Game.rgss3a is damaged.'),
    })
  })

  const packedArchive = Effect.fnUntraced(function* (game: GameFiles) {
    if (game.engine !== 'rpg-maker-vx-ace' || !(yield* exists(archiveOf(game)))) {
      return undefined
    }

    return archiveOf(game)
  })

  const archiveDataFiles = Effect.fnUntraced(function* (archivePath: string) {
    return (yield* readGameArchive(archivePath)).flatMap((entry) => {
      const name = entry.path.split(/[\\/]/).at(-1) ?? ''

      return isArchivedData(entry.path) ? [{ name, read: () => entry.read() }] : []
    })
  })

  const archiveLocations = Effect.fnUntraced(function* (archivePath: string) {
    const found: Array<TextLocation> = []

    for (const file of yield* archiveDataFiles(archivePath)) {
      found.push(...textLocations(file.name, yield* decode(file.name, file.read())))
    }

    return found
  })

  const folderLocations = Effect.fnUntraced(function* (dataPath: string) {
    const found: Array<TextLocation> = []

    for (const name of yield* dataFiles(dataPath)) {
      found.push(...textLocations(name, yield* readData(path.join(dataPath, name))))
    }

    return found
  })

  const protectedText = Effect.fn('GameData.protectedText')(function* (game: GameFiles) {
    const sources: Array<string> = []
    const assetNames = new Set<string>()

    for (const folder of codeFolders[game.engine]) {
      const folderPath = path.join(game.folderPath, ...folder)
      const names = yield* fs.readDirectory(folderPath).pipe(Effect.orElseSucceed(() => []))

      for (const name of names.filter((file) => /\.js$/i.test(file))) {
        const source = yield* fs
          .readFileString(path.join(folderPath, name))
          .pipe(Effect.orElseSucceed(() => ''))

        sources.push(source)
      }
    }

    const dataPath = dataPathOf(game)

    for (const name of yield* dataFiles(dataPath).pipe(Effect.orElseSucceed(() => []))) {
      const data = yield* readData(path.join(dataPath, name)).pipe(Effect.option)

      if (Option.isSome(data)) {
        sources.push(eventScriptsOf(data.value).join('\n'))
      }
    }

    for (const folder of assetFolders[game.engine]) {
      const files = yield* fs
        .readDirectory(path.join(game.folderPath, ...folder), { recursive: true })
        .pipe(Effect.orElseSucceed(() => []))

      for (const file of files) {
        assetNames.add(assetNameOf(file))
      }
    }

    return { codeNames: codeNamesOf(sources), assetNames } satisfies ProtectedText
  })

  const locations = Effect.fn('GameData.locations')(function* (game: GameFiles) {
    const archive = yield* packedArchive(game)

    return archive === undefined
      ? yield* folderLocations(dataPathOf(game))
      : yield* archiveLocations(archive)
  })

  const originalLocations = Effect.fn('GameData.originalLocations')(function* (game: GameFiles) {
    yield* adoptLegacyBackup(game)

    if (yield* exists(archiveAsideOf(game))) {
      const overrides = yield* overrideFiles(game)

      const archived = (yield* archiveLocations(archiveAsideOf(game))).filter(
        (location) => !overrides.has(location.file),
      )

      return overrides.size === 0
        ? archived
        : [...archived, ...(yield* folderLocations(originalDataOf(game)))]
    }

    if (yield* exists(originalDataOf(game))) {
      return yield* folderLocations(originalDataOf(game))
    }

    return yield* locations(game)
  })

  const originalSources = Effect.fnUntraced(function* (game: GameFiles) {
    yield* adoptLegacyBackup(game)

    if (yield* exists(archiveAsideOf(game))) {
      return { archive: archiveAsideOf(game), folder: originalDataOf(game) }
    }

    if (yield* exists(originalDataOf(game))) {
      return { folder: originalDataOf(game) }
    }

    const archive = yield* packedArchive(game)

    return archive === undefined ? { folder: dataPathOf(game) } : { archive }
  })

  const forEachOriginal = Effect.fn('GameData.forEachOriginal')(function* <E, R>(
    game: GameFiles,
    accept: (file: string) => boolean,
    visit: (file: string, data: RpgData) => Effect.Effect<void, E, R>,
  ) {
    const sources = yield* originalSources(game)
    const wanted = (name: string) => /\.(json|rvdata2)$/i.test(name) && accept(name)

    const loose =
      sources.folder !== undefined && (yield* exists(sources.folder))
        ? (yield* fs
            .readDirectory(sources.folder)
            .pipe(fail('The game data folder could not be read.')))
            .filter(wanted)
            .toSorted((left, right) => left.localeCompare(right))
        : []

    if (sources.archive !== undefined) {
      for (const entry of yield* readGameArchive(sources.archive)) {
        const name = entry.path.split(/[\\/]/).at(-1) ?? ''

        if (/^Data[\\/][^\\/]+$/i.test(entry.path) && wanted(name) && !loose.includes(name)) {
          yield* visit(name, yield* decode(name, entry.read()))
        }
      }
    }

    for (const name of loose) {
      yield* visit(name, yield* readData(path.join(sources.folder ?? '', name)))
    }
  })

  const originalStamp = Effect.fn('GameData.originalStamp')(function* (game: GameFiles) {
    const sources = yield* originalSources(game)
    const parts: Array<string> = []

    const stampOf = (target: string) =>
      fs.stat(target).pipe(
        Effect.map(
          (info) =>
            `${path.basename(target)}:${info.size}:${Option.getOrElse(
              Option.map(info.mtime, (time) => time.getTime()),
              () => 0,
            )}`,
        ),
        fail(`${path.basename(target)} could not be read.`),
      )

    if (sources.archive !== undefined) {
      parts.push(yield* stampOf(sources.archive))
    }

    if (sources.folder !== undefined && (yield* exists(sources.folder))) {
      for (const name of yield* dataFiles(sources.folder)) {
        parts.push(yield* stampOf(path.join(sources.folder, name)))
      }
    }

    return parts.join('|')
  })

  const overrideFiles = Effect.fnUntraced(function* (game: GameFiles) {
    if (!(yield* exists(originalDataOf(game)))) {
      return new Set<string>()
    }

    return new Set(yield* dataFiles(originalDataOf(game)))
  })

  const keepOverride = Effect.fnUntraced(function* (game: GameFiles, file: string) {
    const target = path.join(originalDataOf(game), path.basename(file))

    yield* fs
      .makeDirectory(originalDataOf(game), { recursive: true })
      .pipe(failWrite(target, `${path.basename(file)} could not be saved as the original.`))

    yield* fs
      .copyFile(file, target)
      .pipe(failWrite(target, `${path.basename(file)} could not be saved as the original.`))
  })

  const adoptLegacyBackup = Effect.fnUntraced(function* (game: GameFiles) {
    const original = originalDataOf(game)

    if (yield* exists(original)) {
      return
    }

    const dataPath = dataPathOf(game)
    const parent = path.dirname(dataPath)
    const prefix = `${path.basename(dataPath)}.wenbu-backup-`
    const names = yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))
    const oldest = names.filter((name) => name.startsWith(prefix)).toSorted()[0]

    if (oldest !== undefined) {
      yield* fs
        .rename(path.join(parent, oldest), original)
        .pipe(fail('The old Wenbu backup could not be adopted.'))
    }
  })

  const hasOriginals = Effect.fn('GameData.hasOriginals')(function* (game: GameFiles) {
    yield* adoptLegacyBackup(game)

    return (yield* exists(originalDataOf(game))) || (yield* exists(archiveAsideOf(game)))
  })

  const saveOriginals = Effect.fn('GameData.saveOriginals')(function* (game: GameFiles) {
    yield* adoptLegacyBackup(game)

    const archive = yield* packedArchive(game)

    if (archive !== undefined) {
      for (const entry of yield* readGameArchive(archive)) {
        const segments = safeSegments(entry.path)

        if (segments === undefined) {
          continue
        }

        const target = path.join(game.folderPath, ...segments)

        if (yield* exists(target)) {
          if (isArchivedData(entry.path)) {
            yield* keepOverride(game, target)
          }

          continue
        }

        yield* fs
          .makeDirectory(path.dirname(target), { recursive: true })
          .pipe(failWrite(target, `${entry.path} could not be unpacked.`))

        yield* fs
          .writeFile(target, entry.read())
          .pipe(failWrite(target, `${entry.path} could not be unpacked.`))
      }

      yield* fs
        .rename(archive, archiveAsideOf(game))
        .pipe(fail('Game.rgss3a could not be moved aside. Close the game and try again.'))

      return 'unpacked' as const
    }

    if (yield* exists(originalDataOf(game))) {
      return 'kept' as const
    }

    yield* fs
      .copy(dataPathOf(game), originalDataOf(game))
      .pipe(failWrite(game.folderPath, 'The original game files could not be saved.'))

    return 'saved' as const
  })

  const hashOf = (bytes: Uint8Array) =>
    crypto.digest('SHA-256', bytes).pipe(
      Effect.map((digest) => Hex.encode(digest)),
      Effect.orDie,
    )

  const folderHashes = Effect.fnUntraced(function* (folderPath: string) {
    const hashes = new Map<string, string>()

    for (const name of yield* dataFiles(folderPath)) {
      const bytes = yield* fs
        .readFile(path.join(folderPath, name))
        .pipe(fail(`${name} could not be read.`))

      hashes.set(name, yield* hashOf(bytes))
    }

    return hashes
  })

  const dataHashes = Effect.fn('GameData.dataHashes')(function* (game: GameFiles) {
    return yield* folderHashes(dataPathOf(game))
  })

  const originalHashes = Effect.fn('GameData.originalHashes')(function* (game: GameFiles) {
    const aside = archiveAsideOf(game)

    if (!(yield* exists(aside))) {
      return yield* folderHashes(originalDataOf(game))
    }

    const hashes = new Map<string, string>()

    for (const file of yield* archiveDataFiles(aside)) {
      hashes.set(file.name, yield* hashOf(file.read()))
    }

    for (const [name, hash] of yield* folderHashes(originalDataOf(game)).pipe(
      Effect.orElseSucceed(() => new Map<string, string>()),
    )) {
      hashes.set(name, hash)
    }

    return hashes
  })

  const hasArchivedOriginals = (game: GameFiles) => exists(archiveAsideOf(game))

  const hasNewArchive = Effect.fn('GameData.hasNewArchive')(function* (game: GameFiles) {
    return (yield* packedArchive(game)) !== undefined && (yield* exists(archiveAsideOf(game)))
  })

  const removeUnpacked = Effect.fnUntraced(function* (game: GameFiles, archivePath: string) {
    for (const entry of yield* readGameArchive(archivePath)) {
      const segments = safeSegments(entry.path)

      if (segments !== undefined) {
        yield* fs
          .remove(path.join(game.folderPath, ...segments), { force: true })
          .pipe(fail(`${entry.path} could not be removed.`))
      }
    }
  })

  const restoreOriginals = Effect.fn('GameData.restoreOriginals')(function* (game: GameFiles) {
    yield* adoptLegacyBackup(game)

    const aside = archiveAsideOf(game)

    if (yield* exists(aside)) {
      yield* removeUnpacked(game, aside)

      yield* fs
        .rename(aside, archiveOf(game))
        .pipe(fail('Game.rgss3a could not be restored. Close the game and try again.'))

      for (const name of yield* overrideFiles(game)) {
        const target = path.join(dataPathOf(game), name)

        yield* fs
          .makeDirectory(dataPathOf(game), { recursive: true })
          .pipe(failWrite(target, `${name} could not be restored.`))

        yield* fs
          .copyFile(path.join(originalDataOf(game), name), target)
          .pipe(failWrite(target, `${name} could not be restored.`))
      }

      return true
    }

    const original = originalDataOf(game)

    if (!(yield* exists(original))) {
      return false
    }

    const dataPath = dataPathOf(game)

    yield* fs
      .remove(dataPath, { recursive: true, force: true })
      .pipe(fail('The translated files could not be removed. Close the game and try again.'))

    yield* fs
      .copy(original, dataPath)
      .pipe(failWrite(dataPath, 'The original game files could not be restored.'))

    return true
  })

  const discardOriginals = Effect.fn('GameData.discardOriginals')(function* (game: GameFiles) {
    yield* fs
      .remove(originalDataOf(game), { recursive: true, force: true })
      .pipe(fail('The saved original files could not be removed.'))
  })

  const spaceToTranslate = Effect.fn('GameData.spaceToTranslate')(function* (game: GameFiles) {
    const archive = yield* packedArchive(game)

    const dataBytes = yield* (
      archive === undefined
        ? folderSize(dataPathOf(game))
        : Effect.map(fs.stat(archive), (info) => Number(info.size))
    ).pipe(fail('The game data folder could not be read.'))

    const saved =
      archive === undefined &&
      ((yield* exists(originalDataOf(game))) || (yield* exists(archiveAsideOf(game))))

    return (saved ? 0 : dataBytes) + Math.ceil(dataBytes / 4)
  })

  return {
    spaceToTranslate,
    dataPathOf,
    dataFiles,
    readData,
    writeData,
    locations,
    originalLocations,
    forEachOriginal,
    originalStamp,
    protectedText,
    hasOriginals,
    saveOriginals,
    restoreOriginals,
    discardOriginals,
    dataHashes,
    originalHashes,
    hasArchivedOriginals,
    hasNewArchive,
  }
})

export class GameData extends Context.Service<GameData, Effect.Success<typeof make>>()(
  'wenbu/core/rpgmaker/GameData',
) {
  static readonly layer = Layer.effect(GameData, make)
}
