import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const GameEngine = Schema.Literals([
  'rpg-maker-mv',
  'rpg-maker-mz',
  'rpg-maker-vx-ace',
  'rpg-maker-vx',
  'rpg-maker-xp',
  'wolf-rpg',
  'windows',
])

export type GameEngine = typeof GameEngine.Type

export const engineLabels: Record<GameEngine, string> = {
  'rpg-maker-mv': 'RPG Maker MV',
  'rpg-maker-mz': 'RPG Maker MZ',
  'rpg-maker-vx-ace': 'RPG Maker VX Ace',
  'rpg-maker-vx': 'RPG Maker VX',
  'rpg-maker-xp': 'RPG Maker XP',
  'wolf-rpg': 'WOLF RPG Editor',
  windows: 'Windows game',
}

/** RPG Maker games whose data Wenbu reads directly: the Game Guide and Memories need these. */
export const isReadableRpgMaker = (engine: GameEngine) =>
  engine === 'rpg-maker-mv' || engine === 'rpg-maker-mz' || engine === 'rpg-maker-vx-ace'

export const isTranslatable = (engine: GameEngine) =>
  isReadableRpgMaker(engine) || engine === 'wolf-rpg'

export const TranslationState = Schema.Literals(['original', 'translated', 'partial'])

export type TranslationState = typeof TranslationState.Type

export const StartLocale = Schema.Literals(['system', 'ntleas', 'locale-remulator'])

export type StartLocale = typeof StartLocale.Type

export const GameLocale = Schema.Literals(['auto', ...StartLocale.literals])

export type GameLocale = typeof GameLocale.Type

export const localeLabels: Record<GameLocale, string> = {
  auto: 'Automatic',
  system: 'System locale',
  ntleas: 'Japanese (Ntleas)',
  'locale-remulator': 'Japanese (Locale Remulator)',
}

/** A game's message window, measured from its original text: width in ems, and how many lines show. */
export const MessageWindow = Schema.Struct({
  width: Schema.Finite,
  lines: Schema.Int,
})

export type MessageWindow = typeof MessageWindow.Type

export const TextProfile = Schema.Struct({
  language: Schema.String,
  dialogueCharacters: Schema.Int,
  readingMinutes: Schema.Int,
  window: Schema.optional(MessageWindow),
})

export type TextProfile = typeof TextProfile.Type

export class Game extends Schema.Class<Game>('Game')({
  id: Schema.String,
  title: Schema.String,
  notes: Schema.optional(Schema.String),
  folderPath: Schema.String,
  executablePath: Schema.String,
  engine: GameEngine,
  sizeBytes: Schema.Int,
  text: Schema.optional(TextProfile),
  translation: TranslationState,
  addedAt: Schema.String,
  lastPlayedAt: Schema.optional(Schema.String),
  playSeconds: Schema.Int,
  launchCount: Schema.Int,
  locale: GameLocale,
  needsJapaneseLocale: Schema.Boolean,
}) {}

export const startLocaleOf = (
  game: Pick<Game, 'locale' | 'needsJapaneseLocale'>,
  lunaHookInstalled: boolean,
): StartLocale => {
  if (game.locale !== 'auto') {
    return game.locale
  }

  return game.needsJapaneseLocale && lunaHookInstalled ? 'ntleas' : 'system'
}

export class GameCandidate extends Schema.Class<GameCandidate>('GameCandidate')({
  title: Schema.String,
  folderPath: Schema.String,
  executablePath: Schema.String,
  engine: GameEngine,
  sizeBytes: Schema.Int,
  text: Schema.optional(TextProfile),
  translation: TranslationState,
}) {}

export const GameProgram = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  sizeBytes: Schema.Int,
  tool: Schema.Boolean,
})

export type GameProgram = typeof GameProgram.Type

export const LaunchProblem = Schema.Struct({
  seconds: Schema.Int,
  program: GameProgram,
  suggestion: GameProgram,
})

export type LaunchProblem = typeof LaunchProblem.Type

export const CgPack = Schema.Struct({
  path: Schema.String,
  imageCount: Schema.Int,
  skippedCount: Schema.Int,
})

export type CgPack = typeof CgPack.Type

export class LibraryError extends Schema.TaggedError<LibraryError>()('LibraryError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'not-ready', 'failed']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ById = { id: Schema.String }

const ByPath = { path: Schema.String }

export class LibraryRpc extends RpcGroup.make(
  Rpc.make('listGames', { success: Schema.Array(Game) }),
  Rpc.make('inspectFolder', { payload: ByPath, success: GameCandidate, error: LibraryError }),
  Rpc.make('addGame', { payload: ByPath, success: Game, error: LibraryError }),
  Rpc.make('updateGame', {
    payload: { id: Schema.String, title: Schema.String, notes: Schema.String },
    success: Game,
    error: LibraryError,
  }),
  Rpc.make('removeGame', { payload: ById, error: LibraryError }),
  Rpc.make('launchGame', { payload: ById, error: LibraryError }),
  Rpc.make('listGamePrograms', {
    payload: ById,
    success: Schema.Array(GameProgram),
    error: LibraryError,
  }),
  Rpc.make('setGameProgram', {
    payload: { id: Schema.String, path: Schema.String },
    success: Game,
    error: LibraryError,
  }),
  Rpc.make('watchLaunchProblem', {
    payload: ById,
    success: Schema.OptionFromNullOr(LaunchProblem),
    stream: true,
  }),
  Rpc.make('dismissLaunchProblem', { payload: ById }),
  Rpc.make('setLaunchLocale', {
    payload: { id: Schema.String, locale: GameLocale },
    success: Game,
    error: LibraryError,
  }),
  Rpc.make('listImageFolders', {
    payload: ById,
    success: Schema.Array(Schema.String),
    error: LibraryError,
  }),
  Rpc.make('createCgPack', {
    payload: { id: Schema.String, folders: Schema.Array(Schema.String) },
    success: CgPack,
    error: LibraryError,
  }),
) {}
