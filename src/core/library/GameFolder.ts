import { Effect, FileSystem, Option, Path, Predicate, Schema } from 'effect'
import { type GameEngine, GameCandidate, isTranslatable, LibraryError } from '#contract/Library'
import { GameData } from '../rpgmaker/GameData'
import { textProfile } from '../rpgmaker/TextProfile'

const helperExecutable = /^(unins\d*|setup|crashpad|notification_helper|vc_redist|dxwebsetup|nw)$/i

const SystemTitle = Schema.Struct({ gameTitle: Schema.optional(Schema.String) })

const decodeSystemTitle = Schema.decodeUnknownOption(Schema.fromJsonString(SystemTitle))

const invalid = (message: string) => new LibraryError({ reason: 'invalid', field: 'path', message })

const prettify = (name: string) =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()

const comparable = (text: string) => text.toLocaleLowerCase().replace(/\W+/g, '')

interface RgssEngine {
  readonly engine: GameEngine
  readonly library: RegExp
  readonly markers: ReadonlyArray<string>
}

const engineLibraries = (version: number) =>
  ['0', '1', '2', '3', '4'].flatMap((minor) =>
    ['', 'E', 'J'].map((edition) => `RGSS${version}0${minor}${edition}.dll`),
  )

const rgssEngines: ReadonlyArray<RgssEngine> = [
  {
    engine: 'rpg-maker-vx-ace',
    library: /Library=.*RGSS30\d\.dll/i,
    markers: [
      'Game.rgss3a',
      'Game.rgss3a.wenbu-backup',
      'Data/Scripts.rvdata2',
      ...engineLibraries(3).flatMap((dll) => [dll, `System/${dll}`]),
    ],
  },
  {
    engine: 'rpg-maker-vx',
    library: /Library=.*RGSS20\d[EJ]?\.dll/i,
    markers: ['Game.rgss2a', 'Data/Scripts.rvdata'],
  },
  {
    engine: 'rpg-maker-xp',
    library: /Library=.*RGSS10\d[EJ]?\.dll/i,
    markers: ['Game.rgssad', 'Data/Scripts.rxdata'],
  },
]

export const inspectFolder = Effect.fn('GameFolder.inspect')(function* (input: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const gameData = yield* GameData

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false))

  const readText = (target: string) =>
    fs.readFileString(target).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<string>()),
    )

  const trimmed = input.trim()

  if (trimmed === '') {
    return yield* invalid('Choose a game folder.')
  }

  const resolved = path.resolve(trimmed)

  const info = yield* fs
    .stat(resolved)
    .pipe(Effect.mapError(() => invalid("This folder doesn't exist.")))

  const folderPath = info.type === 'File' ? path.dirname(resolved) : resolved

  const files = yield* fs
    .readDirectory(folderPath, { recursive: true })
    .pipe(Effect.mapError(() => invalid("This folder can't be read.")))

  const sizes = yield* Effect.forEach(
    files,
    (file) =>
      fs.stat(path.join(folderPath, file)).pipe(
        Effect.map((stat) => (stat.type === 'File' ? Number(stat.size) : 0)),
        Effect.orElseSucceed(() => 0),
      ),
    { concurrency: 32 },
  )

  const executables = files.filter(
    (file) =>
      file.split(/[\\/]/).length <= 3 &&
      path.extname(file).toLowerCase() === '.exe' &&
      !helperExecutable.test(path.basename(file, path.extname(file))),
  )

  const gameIni = yield* readText(path.join(folderPath, 'Game.ini'))

  const hasAny = (markers: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(markers, (marker) => exists(path.join(folderPath, marker))),
      (found) => found.includes(true),
    )

  const isRgssGame = Effect.fnUntraced(function* (rgss: RgssEngine) {
    const usesLibrary = Option.exists(gameIni, (text) => rgss.library.test(text))

    return usesLibrary && (yield* hasAny(rgss.markers))
  })

  const detectEngine = Effect.fnUntraced(function* () {
    if (yield* exists(path.join(folderPath, 'www', 'data', 'System.json'))) {
      return 'rpg-maker-mv'
    }

    if (yield* exists(path.join(folderPath, 'data', 'System.json'))) {
      return 'rpg-maker-mz'
    }

    for (const rgss of rgssEngines) {
      if (yield* isRgssGame(rgss)) {
        return rgss.engine
      }
    }

    return 'windows'
  })

  const engine: GameEngine = yield* detectEngine()

  const systemJson =
    engine === 'rpg-maker-mv' || engine === 'rpg-maker-mz'
      ? yield* readText(path.join(gameData.dataPathOf({ folderPath, engine }), 'System.json'))
      : Option.none<string>()

  const projectTitle = Option.firstSomeOf([
    systemJson.pipe(
      Option.flatMap((text) => decodeSystemTitle(text)),
      Option.flatMap((system) => Option.fromNullishOr(system.gameTitle?.trim())),
    ),
    gameIni.pipe(
      Option.flatMap((text) => Option.fromNullishOr(/^Title=(.+)$/im.exec(text)?.[1]?.trim())),
    ),
  ]).pipe(Option.filter((title) => title !== ''))

  const title = Option.getOrElse(projectTitle, () => prettify(path.basename(folderPath)))

  const launcher =
    executables.find(
      (file) => comparable(path.basename(file, path.extname(file))) === comparable(title),
    ) ??
    executables.find((file) => !/[\\/]/.test(file)) ??
    executables[0]

  if (launcher === undefined) {
    return yield* invalid("This folder doesn't contain a Windows game (.exe).")
  }

  const game = { folderPath, engine }
  const translatable = isTranslatable(engine)

  const text = translatable
    ? yield* gameData.originalLocations(game).pipe(
        Effect.map((locations) => textProfile(locations)),
        Effect.orElseSucceed(() => undefined),
      )
    : undefined

  const translated =
    translatable && (yield* gameData.hasOriginals(game).pipe(Effect.orElseSucceed(() => false)))

  return GameCandidate.make({
    title,
    folderPath,
    executablePath: path.join(folderPath, launcher),
    engine,
    sizeBytes: sizes.reduce((total, size) => total + size, 0),
    translation: translated ? 'translated' : 'original',
    ...(Predicate.isNotUndefined(text) ? { text } : {}),
  })
})
