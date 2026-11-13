import { Context, Crypto, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  Game,
  type GameCandidate,
  GameEngine,
  GameLocale,
  LibraryError,
  TranslationState,
} from '#contract/Library'

const GameRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  notes: Schema.NullOr(Schema.String),
  folder_path: Schema.String,
  executable_path: Schema.String,
  engine: GameEngine,
  size_bytes: Schema.Int,
  text_language: Schema.NullOr(Schema.String),
  dialogue_characters: Schema.NullOr(Schema.Int),
  reading_minutes: Schema.NullOr(Schema.Int),
  translation: TranslationState,
  added_at: Schema.String,
  last_played_at: Schema.NullOr(Schema.String),
  play_seconds: Schema.Int,
  launch_count: Schema.Int,
  launch_locale: GameLocale,
  needs_japanese_locale: Schema.NullOr(Schema.Int),
})

type GameRow = typeof GameRow.Type

const toGame = (row: GameRow) =>
  Game.make({
    id: row.id,
    title: row.title,
    folderPath: row.folder_path,
    executablePath: row.executable_path,
    engine: row.engine,
    sizeBytes: row.size_bytes,
    translation: row.translation,
    addedAt: row.added_at,
    playSeconds: row.play_seconds,
    launchCount: row.launch_count,
    locale: row.launch_locale,
    needsJapaneseLocale: row.needs_japanese_locale === 1,
    ...(row.notes === null ? {} : { notes: row.notes }),
    ...(row.last_played_at === null ? {} : { lastPlayedAt: row.last_played_at }),
    ...(row.text_language === null ||
    row.dialogue_characters === null ||
    row.reading_minutes === null
      ? {}
      : {
          text: {
            language: row.text_language,
            dialogueCharacters: row.dialogue_characters,
            readingMinutes: row.reading_minutes,
          },
        }),
  })

const folderKey = (folderPath: string) =>
  process.platform === 'win32' ? folderPath.toLocaleLowerCase() : folderPath

const notFound = new LibraryError({
  reason: 'not-found',
  message: 'This game is no longer in the library.',
})

export class Games extends Context.Service<
  Games,
  {
    readonly list: Effect.Effect<ReadonlyArray<Game>>
    readonly get: (id: string) => Effect.Effect<Game, LibraryError>
    readonly add: (candidate: GameCandidate) => Effect.Effect<Game, LibraryError>
    readonly update: (id: string, title: string, notes: string) => Effect.Effect<Game, LibraryError>
    readonly remove: (id: string) => Effect.Effect<void, LibraryError>
    readonly recordLaunch: (id: string) => Effect.Effect<void>
    readonly recordPlay: (id: string, seconds: number) => Effect.Effect<void>
    readonly setTranslation: (id: string, state: TranslationState) => Effect.Effect<void>
    readonly setLocale: (id: string, locale: GameLocale) => Effect.Effect<Game, LibraryError>
    readonly localeUnchecked: Effect.Effect<ReadonlyArray<Game>>
    readonly setNeedsJapaneseLocale: (id: string, needed: boolean) => Effect.Effect<void>
  }
>()('wenbu/core/library/Games') {
  static readonly layer = Layer.effect(
    Games,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const crypto = yield* Crypto.Crypto

      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const all = SqlSchema.findAll({
        Request: Schema.Void,
        Result: GameRow,
        execute: () => sql`SELECT * FROM games ORDER BY title COLLATE NOCASE, id`,
      })

      const find = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: GameRow,
        execute: (id) => sql`SELECT * FROM games WHERE id = ${id}`,
      })

      const findByFolder = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: GameRow,
        execute: (key) => sql`SELECT * FROM games WHERE folder_key = ${key}`,
      })

      const get = Effect.fn('Games.get')(function* (id: string) {
        const row = yield* Effect.orDie(find(id))

        if (Option.isNone(row)) {
          return yield* notFound
        }

        return toGame(row.value)
      })

      const add = Effect.fn('Games.add')(function* (candidate: GameCandidate) {
        const existing = yield* Effect.orDie(findByFolder(folderKey(candidate.folderPath)))

        if (Option.isSome(existing)) {
          return yield* new LibraryError({
            reason: 'conflict',
            field: 'path',
            message: `“${existing.value.title}” is already in the library.`,
          })
        }

        const id = yield* Effect.orDie(crypto.randomUUIDv7())

        yield* Effect.orDie(
          sql`INSERT INTO games ${sql.insert({
            id,
            title: candidate.title,
            notes: null,
            folder_path: candidate.folderPath,
            folder_key: folderKey(candidate.folderPath),
            executable_path: candidate.executablePath,
            engine: candidate.engine,
            size_bytes: candidate.sizeBytes,
            text_language: candidate.text?.language ?? null,
            dialogue_characters: candidate.text?.dialogueCharacters ?? null,
            reading_minutes: candidate.text?.readingMinutes ?? null,
            translation: candidate.translation,
            added_at: yield* now,
            last_played_at: null,
            play_seconds: 0,
            launch_count: 0,
            launch_locale: 'auto',
          })}`,
        )

        yield* Effect.logInfo('Game added').pipe(
          Effect.annotateLogs({
            game: id,
            engine: candidate.engine,
            sizeMb: Math.round(candidate.sizeBytes / 1024 ** 2),
          }),
        )

        return yield* get(id)
      })

      const update = Effect.fn('Games.update')(function* (
        id: string,
        title: string,
        notes: string,
      ) {
        yield* get(id)

        const name = title.trim()

        if (name === '') {
          return yield* new LibraryError({
            reason: 'invalid',
            field: 'title',
            message: 'Enter a name.',
          })
        }

        const note = notes.trim()

        yield* Effect.orDie(
          sql`UPDATE games SET ${sql.update({ title: name, notes: note === '' ? null : note })} WHERE id = ${id}`,
        )

        return yield* get(id)
      })

      const remove = Effect.fn('Games.remove')(function* (id: string) {
        yield* get(id)

        yield* Effect.orDie(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM translation_runs WHERE game_id = ${id}`
              yield* sql`DELETE FROM translation_lines WHERE game_id = ${id}`
              yield* sql`DELETE FROM game_file_hashes WHERE game_id = ${id}`
              yield* sql`DELETE FROM game_updates WHERE game_id = ${id}`
              yield* sql`DELETE FROM guide_indexes WHERE game_id = ${id}`
              yield* sql`DELETE FROM overlay_saved_hooks WHERE game_id = ${id}`
              yield* sql`DELETE FROM overlay_pipelines WHERE game_id = ${id}`
              yield* sql`DELETE FROM overlay_cache WHERE game_id = ${id}`
              yield* sql`DELETE FROM overlay_stories WHERE game_id = ${id}`
              yield* sql`DELETE FROM game_work_links WHERE game_id = ${id}`
              yield* sql`DELETE FROM game_detail_edits WHERE game_id = ${id}`
              yield* sql`DELETE FROM game_detail_finds WHERE game_id = ${id}`
              yield* sql`DELETE FROM games WHERE id = ${id}`
            }),
          ),
        )

        yield* Effect.logInfo('Game removed').pipe(Effect.annotateLogs({ game: id }))
      })

      const recordLaunch = Effect.fn('Games.recordLaunch')(function* (id: string) {
        yield* sql`UPDATE games SET last_played_at = ${yield* now}, launch_count = launch_count + 1 WHERE id = ${id}`
      }, Effect.orDie)

      const recordPlay = Effect.fn('Games.recordPlay')(function* (id: string, seconds: number) {
        yield* sql`UPDATE games SET play_seconds = play_seconds + ${seconds} WHERE id = ${id}`
      }, Effect.orDie)

      const setTranslation = Effect.fn('Games.setTranslation')(function* (
        id: string,
        state: TranslationState,
      ) {
        yield* sql`UPDATE games SET translation = ${state} WHERE id = ${id}`
      }, Effect.orDie)

      const setLocale = Effect.fn('Games.setLocale')(function* (id: string, locale: GameLocale) {
        yield* get(id)
        yield* Effect.orDie(sql`UPDATE games SET launch_locale = ${locale} WHERE id = ${id}`)

        return yield* get(id)
      })

      const unchecked = SqlSchema.findAll({
        Request: Schema.Void,
        Result: GameRow,
        execute: () => sql`SELECT * FROM games WHERE needs_japanese_locale IS NULL`,
      })

      const setNeedsJapaneseLocale = Effect.fn('Games.setNeedsJapaneseLocale')(function* (
        id: string,
        needed: boolean,
      ) {
        yield* sql`UPDATE games SET needs_japanese_locale = ${needed ? 1 : 0} WHERE id = ${id}`
      }, Effect.orDie)

      return Games.of({
        list: Effect.map(Effect.orDie(all()), (rows) => rows.map(toGame)),
        get,
        add,
        update,
        remove,
        recordLaunch,
        recordPlay,
        setTranslation,
        setLocale,
        localeUnchecked: Effect.map(Effect.orDie(unchecked()), (rows) => rows.map(toGame)),
        setNeedsJapaneseLocale,
      })
    }),
  )
}
