import { Crypto, Effect, FileSystem, Path, type PlatformError, Schema, Semaphore } from 'effect'
import { Hex } from 'effect/encoding'
import type { TranslationSettings } from '#contract/GameTranslation'
import { DiskSpace } from '../platform/DiskSpace'
import { type ApplySkipReason, applyTranslations } from '../rpgmaker/ApplyTranslations'
import { GameDataError } from '../rpgmaker/GameDataError'
import { noProtectedText } from '../rpgmaker/ProtectedText'
import type { RpgData } from '../rpgmaker/RpgData'
import type { TextEntry } from '../rpgmaker/TextEntries'
import type { TextLocation } from '../rpgmaker/TextLocations'
import {
  decodeWolfData,
  encodeWolfData,
  wolfProtectedText,
  wolfTextLocations,
  wolfWindowOf,
} from './WolfText'
import { WolfTools } from './WolfTools'

export interface WolfGame {
  readonly folderPath: string
}

export interface WrittenTranslations {
  readonly written: number
  readonly unchanged: number
  readonly skipped: Map<ApplySkipReason, number>
  readonly skippedIds: Map<string, ApplySkipReason>
}

const JsonText = Schema.fromJsonString(Schema.Unknown)

const decodeJson = Schema.decodeUnknownEffect(JsonText)

const encodeJson = Schema.encodeEffect(JsonText)

const UnpackedFolders = Schema.fromJsonString(Schema.Array(Schema.String))

const textFolders = ['BasicData', 'MapData'] as const

const dumpFolders = ['mps', 'common', 'db'] as const

const asideSuffix = '.wenbu-backup'

const failWith = (message: string) => () => new GameDataError({ message })

/**
 * WOLF RPG games keep their data in encrypted `.wolf` archives, which the game reads before any
 * loose files. Translating one unpacks the archives beside them, moves the archives aside and
 * writes the translated text into the loose files. Wenbu keeps the original text files and
 * their text, read by WolfTL, in `Data.wenbu-original`, and builds each translation in
 * `Data.wenbu-work`.
 */
export const makeWolfData = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const disk = yield* DiskSpace
  const tools = yield* WolfTools
  const lock = yield* Semaphore.make(1)

  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect)

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))

  const fail = (message: string) => Effect.mapError(failWith(message))

  const failWrite =
    (target: string, message: string) =>
    <A, R>(effect: Effect.Effect<A, PlatformError.PlatformError, R>) =>
      effect.pipe(
        disk.refine(target),
        Effect.catchTag('PlatformError', () => Effect.fail(new GameDataError({ message }))),
      )

  const dataFolderOf = (game: WolfGame) => path.join(game.folderPath, 'Data')

  const originalOf = (game: WolfGame) => path.join(game.folderPath, 'Data.wenbu-original')

  const originalDumpOf = (game: WolfGame) => path.join(originalOf(game), 'dump')

  const workOf = (game: WolfGame) => path.join(game.folderPath, 'Data.wenbu-work')

  const workDumpOf = (game: WolfGame) => path.join(workOf(game), 'dump')

  const unpackedListOf = (game: WolfGame) => path.join(originalOf(game), 'unpacked.json')

  const savedMarkOf = (game: WolfGame) => path.join(originalOf(game), 'saved')

  const filesIn = Effect.fnUntraced(function* (folder: string, suffix: string) {
    const names = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []))

    return names
      .filter((name) => name.toLowerCase().endsWith(suffix))
      .map((name) => path.join(folder, name))
  })

  const archivesOf = Effect.fnUntraced(function* (game: WolfGame) {
    return [
      ...(yield* filesIn(game.folderPath, '.wolf')),
      ...(yield* filesIn(dataFolderOf(game), '.wolf')),
    ]
  })

  const asideArchivesOf = Effect.fnUntraced(function* (game: WolfGame) {
    return [
      ...(yield* filesIn(game.folderPath, `.wolf${asideSuffix}`)),
      ...(yield* filesIn(dataFolderOf(game), `.wolf${asideSuffix}`)),
    ]
  })

  const programOf = Effect.fnUntraced(function* (game: WolfGame) {
    const pro = path.join(game.folderPath, 'GamePro.exe')

    return (yield* exists(pro)) ? pro : path.join(game.folderPath, 'Game.exe')
  })

  const unpackedFolders = Effect.fnUntraced(function* (game: WolfGame) {
    const text = yield* fs
      .readFileString(unpackedListOf(game))
      .pipe(Effect.orElseSucceed(() => '[]'))

    return yield* Schema.decodeUnknownEffect(UnpackedFolders)(text).pipe(
      Effect.orElseSucceed(() => []),
    )
  })

  /** Unpacks the archives beside themselves and notes the folders that did not exist before. */
  const unpack = Effect.fnUntraced(function* (game: WolfGame) {
    const archives = yield* archivesOf(game)
    const created: Array<string> = []

    for (const archive of archives) {
      const folder = archive.slice(0, -'.wolf'.length)

      if (!(yield* exists(folder))) {
        created.push(path.relative(game.folderPath, folder))
      }
    }

    yield* tools.unpack(yield* programOf(game))

    const known = yield* unpackedFolders(game)
    const all = [...new Set([...known, ...created])]

    yield* fs
      .makeDirectory(originalOf(game), { recursive: true })
      .pipe(failWrite(originalOf(game), 'The original game files could not be saved.'))

    yield* fs
      .writeFileString(unpackedListOf(game), yield* Effect.orDie(encodeJson(all)))
      .pipe(failWrite(unpackedListOf(game), 'The original game files could not be saved.'))

    return created
  })

  const removeUnpacked = Effect.fnUntraced(function* (game: WolfGame) {
    for (const folder of yield* unpackedFolders(game)) {
      yield* fs
        .remove(path.join(game.folderPath, folder), { recursive: true, force: true })
        .pipe(fail('The unpacked game files could not be removed. Close the game and try again.'))
    }

    yield* fs.remove(unpackedListOf(game), { force: true }).pipe(Effect.ignore)
  })

  const copyTextFolders = Effect.fnUntraced(function* (from: string, to: string) {
    for (const folder of textFolders) {
      if (yield* exists(path.join(from, folder))) {
        yield* fs
          .copy(path.join(from, folder), path.join(to, folder), { overwrite: true })
          .pipe(failWrite(to, "The game's text files could not be copied."))
      }
    }
  })

  /** Keeps the original text files and reads their text once, unpacking the archives if needed. */
  const ensureOriginalText = Effect.fnUntraced(function* (game: WolfGame, keepUnpacked: boolean) {
    if (yield* exists(originalDumpOf(game))) {
      return false
    }

    const packed = (yield* archivesOf(game)).length > 0
    const created = packed ? yield* unpack(game) : []

    if (!(yield* exists(path.join(dataFolderOf(game), 'BasicData')))) {
      return yield* new GameDataError({ message: "The game's data could not be found." })
    }

    yield* copyTextFolders(dataFolderOf(game), originalOf(game))
    yield* tools.dump(originalOf(game), originalOf(game))

    if (packed && !keepUnpacked) {
      for (const folder of created) {
        yield* fs
          .remove(path.join(game.folderPath, folder), { recursive: true, force: true })
          .pipe(Effect.ignore)
      }

      yield* fs.remove(unpackedListOf(game), { force: true }).pipe(Effect.ignore)
    }

    return true
  })

  /** Reading the text unpacks it at most once; running out of space there is a plain read error. */
  const ensureForReading = (game: WolfGame) =>
    locked(ensureOriginalText(game, false)).pipe(
      Effect.catchTag('NotEnoughSpace', () =>
        Effect.fail(
          new GameDataError({ message: "There is not enough space to read the game's text." }),
        ),
      ),
    )

  const dumpFiles = Effect.fnUntraced(function* (dump: string) {
    const files: Array<string> = []

    for (const folder of dumpFolders) {
      const names = yield* fs
        .readDirectory(path.join(dump, folder))
        .pipe(Effect.orElseSucceed(() => []))

      files.push(
        ...names.filter((name) => name.endsWith('.json')).map((name) => `${folder}/${name}`),
      )
    }

    return files.toSorted((left, right) => left.localeCompare(right))
  })

  const readDump = Effect.fnUntraced(function* (dump: string, file: string) {
    const text = yield* fs
      .readFileString(path.join(dump, ...file.split('/')))
      .pipe(fail(`${file} could not be read.`))

    const json = yield* decodeJson(text).pipe(fail(`${file} is not valid JSON.`))

    // SAFETY: parsed JSON holds only JSON values, and RpgData includes every JSON value.
    return decodeWolfData(json as RpgData)
  })

  const dumpLocations = Effect.fnUntraced(function* (dump: string) {
    const found: Array<TextLocation> = []

    for (const file of yield* dumpFiles(dump)) {
      found.push(...wolfTextLocations(file, yield* readDump(dump, file)))
    }

    return found
  })

  const originalLocations = Effect.fn('WolfData.originalLocations')(function* (game: WolfGame) {
    yield* ensureForReading(game)

    return yield* dumpLocations(originalDumpOf(game))
  })

  const locations = Effect.fn('WolfData.locations')(function* (game: WolfGame) {
    return (yield* exists(workDumpOf(game)))
      ? yield* dumpLocations(workDumpOf(game))
      : yield* originalLocations(game)
  })

  const forEachOriginal = Effect.fn('WolfData.forEachOriginal')(function* <E, R>(
    game: WolfGame,
    accept: (file: string) => boolean,
    visit: (file: string, data: RpgData) => Effect.Effect<void, E, R>,
  ) {
    yield* ensureForReading(game)

    for (const file of (yield* dumpFiles(originalDumpOf(game))).filter(accept)) {
      yield* visit(file, yield* readDump(originalDumpOf(game), file))
    }
  })

  const protectedText = Effect.fn('WolfData.protectedText')(function* (game: WolfGame) {
    return yield* Effect.gen(function* () {
      yield* ensureForReading(game)

      const files: Array<readonly [string, RpgData]> = []

      for (const file of yield* dumpFiles(originalDumpOf(game))) {
        files.push([file, yield* readDump(originalDumpOf(game), file)])
      }

      return wolfProtectedText(files)
    }).pipe(Effect.orElseSucceed(() => noProtectedText))
  })

  const originalStamp = Effect.fn('WolfData.originalStamp')(function* (game: WolfGame) {
    const parts: Array<string> = []

    for (const archive of [...(yield* archivesOf(game)), ...(yield* asideArchivesOf(game))]) {
      const info = yield* fs
        .stat(archive)
        .pipe(fail(`${path.basename(archive)} could not be read.`))

      parts.push(`${path.basename(archive)}:${info.size}`)
    }

    return parts.join('|')
  })

  const hasArchivedOriginals = (game: WolfGame) =>
    Effect.map(asideArchivesOf(game), (aside) => aside.length > 0)

  const hasNewArchive = Effect.fn('WolfData.hasNewArchive')(function* (game: WolfGame) {
    return (yield* archivesOf(game)).length > 0 && (yield* hasArchivedOriginals(game))
  })

  const hasOriginals = Effect.fn('WolfData.hasOriginals')(function* (game: WolfGame) {
    return (yield* hasArchivedOriginals(game)) || (yield* exists(savedMarkOf(game)))
  })

  const saveOriginals = Effect.fn('WolfData.saveOriginals')(function* (game: WolfGame) {
    return yield* locked(
      Effect.gen(function* () {
        const archives = yield* archivesOf(game)

        if (archives.length > 0) {
          if (!(yield* ensureOriginalText(game, true))) {
            yield* unpack(game)
          }

          for (const archive of archives) {
            yield* fs
              .rename(archive, `${archive}${asideSuffix}`)
              .pipe(
                fail(
                  `${path.basename(archive)} could not be moved aside. Close the game and try again.`,
                ),
              )
          }

          return 'unpacked' as const
        }

        if (yield* hasArchivedOriginals(game)) {
          return 'kept' as const
        }

        yield* ensureOriginalText(game, true)

        if (yield* exists(savedMarkOf(game))) {
          return 'kept' as const
        }

        yield* fs
          .writeFileString(savedMarkOf(game), '')
          .pipe(failWrite(savedMarkOf(game), 'The original game files could not be saved.'))

        return 'saved' as const
      }),
    )
  })

  const restoreText = Effect.fnUntraced(function* (game: WolfGame) {
    if (!(yield* exists(originalOf(game)))) {
      return false
    }

    const packed = (yield* archivesOf(game)).length > 0

    if (packed && !(yield* hasArchivedOriginals(game))) {
      return false
    }

    yield* copyTextFolders(originalOf(game), dataFolderOf(game))

    return true
  })

  const restoreOriginals = Effect.fn('WolfData.restoreOriginals')(function* (game: WolfGame) {
    return yield* locked(restoreText(game))
  })

  const discardOriginals = Effect.fn('WolfData.discardOriginals')(function* (game: WolfGame) {
    yield* locked(
      Effect.gen(function* () {
        const aside = yield* asideArchivesOf(game)

        if (aside.length > 0) {
          yield* removeUnpacked(game)

          for (const archive of aside) {
            yield* fs
              .rename(archive, archive.slice(0, -asideSuffix.length))
              .pipe(
                fail(
                  `${path.basename(archive.slice(0, -asideSuffix.length))} could not be restored. Close the game and try again.`,
                ),
              )
          }
        }

        for (const folder of [originalOf(game), workOf(game)]) {
          yield* fs
            .remove(folder, { recursive: true, force: true })
            .pipe(fail('The saved original files could not be removed.'))
        }
      }),
    )
  })

  const hashOf = (bytes: Uint8Array) =>
    crypto.digest('SHA-256', bytes).pipe(
      Effect.map((digest) => Hex.encode(digest)),
      Effect.orDie,
    )

  const dumpHashes = Effect.fnUntraced(function* (dump: string) {
    const hashes = new Map<string, string>()

    for (const file of yield* dumpFiles(dump)) {
      const bytes = yield* fs
        .readFile(path.join(dump, ...file.split('/')))
        .pipe(fail(`${file} could not be read.`))

      hashes.set(file, yield* hashOf(bytes))
    }

    return hashes
  })

  const dataHashes = Effect.fn('WolfData.dataHashes')(function* (game: WolfGame) {
    return yield* dumpHashes(workDumpOf(game))
  })

  const originalHashes = Effect.fn('WolfData.originalHashes')(function* (game: WolfGame) {
    return yield* dumpHashes(originalDumpOf(game))
  })

  const spaceToTranslate = Effect.fn('WolfData.spaceToTranslate')(function* (game: WolfGame) {
    let archived = 0

    for (const archive of yield* archivesOf(game)) {
      archived += Number(
        (yield* fs.stat(archive).pipe(fail('The game data could not be read.'))).size,
      )
    }

    return archived + Math.ceil(archived / 4) + 64 * 1024 ** 2
  })

  const writeDump = Effect.fnUntraced(function* (
    dump: string,
    file: string,
    data: RpgData,
    window: ReturnType<typeof wolfWindowOf>,
  ) {
    const target = path.join(dump, ...file.split('/'))

    const text = yield* encodeJson(encodeWolfData(data, window)).pipe(
      fail(`${file} could not be encoded.`),
    )

    yield* fs.writeFileString(target, text).pipe(failWrite(target, `${file} could not be written.`))
  })

  /**
   * Writes the translations into a copy of the original text, wraps each translated message to
   * the game's window, then has WolfTL patch the game's text files with it.
   */
  const writeTranslations = Effect.fn('WolfData.writeTranslations')(function* (
    game: WolfGame,
    entries: ReadonlyArray<TextEntry>,
    settings: TranslationSettings,
  ) {
    return yield* locked(
      Effect.gen(function* () {
        const original = originalDumpOf(game)
        const work = workOf(game)
        const window = wolfWindowOf(yield* dumpLocations(original))

        yield* fs
          .remove(work, { recursive: true, force: true })
          .pipe(fail('The last translation could not be cleared.'))

        yield* fs
          .copy(original, workDumpOf(game))
          .pipe(failWrite(work, 'The translation could not be prepared.'))

        // Wenbu lays every translated message out again, so the model's line breaks are a hint.
        const { maxLineLength: _ignored, ...formatting } = settings.formatting

        const wolfSettings = {
          ...settings,
          formatting: { ...formatting, preserveLineBreaks: false },
        }

        const skipped = new Map<ApplySkipReason, number>()
        const skippedIds = new Map<string, ApplySkipReason>()
        let written = 0
        let unchanged = 0

        for (const [file, fileEntries] of Map.groupBy(entries, (entry) => entry.file)) {
          const data = yield* readDump(workDumpOf(game), file)
          const result = applyTranslations(data, fileEntries, wolfSettings)

          written += result.written
          unchanged += result.unchanged

          for (const skip of result.skipped) {
            skipped.set(skip.reason, (skipped.get(skip.reason) ?? 0) + 1)
            skippedIds.set(skip.entryId, skip.reason)
          }

          if (result.written > 0) {
            yield* writeDump(workDumpOf(game), file, data, window)
          }
        }

        yield* tools.patch(originalOf(game), work)

        const patched = path.join(work, 'patched', 'data')

        yield* copyTextFolders(patched, dataFolderOf(game))

        yield* fs
          .remove(path.join(work, 'patched'), { recursive: true, force: true })
          .pipe(Effect.ignore)

        return { written, unchanged, skipped, skippedIds } satisfies WrittenTranslations
      }),
    )
  })

  return {
    dataPathOf: workDumpOf,
    spaceToTranslate,
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
    writeTranslations,
  }
})
