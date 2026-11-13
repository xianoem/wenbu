import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  EditableField,
  FindState,
  GameType,
  type Genre,
  LinkedBy,
  MatchCandidate,
  type WorkLink,
} from '#contract/Details'
import { ListedHit, type Sales, Work } from './DLsite'

export interface StoredWork {
  readonly work: Work
  readonly rating: Option.Option<number>
  readonly ratingCount: Option.Option<number>
  readonly coverFile: Option.Option<string>
  readonly sampleFiles: ReadonlyArray<string>
  readonly translatedTitle: Option.Option<string>
  readonly translatedDescription: Option.Option<string>
  readonly fetchedAt: string
}

export interface FindRecord {
  readonly gameId: string
  readonly state: FindState
  readonly candidates: ReadonlyArray<MatchCandidate>
  readonly error: Option.Option<string>
}

export interface Watched {
  readonly code: string
  readonly title: string
  readonly releasedOn: Option.Option<string>
}

const WorkJson = Schema.fromJsonString(Work)

const Files = Schema.fromJsonString(Schema.Array(Schema.String))

const Candidates = Schema.fromJsonString(Schema.Array(MatchCandidate))

const Hits = Schema.fromJsonString(Schema.Array(ListedHit))

const WorkRow = Schema.Struct({
  code: Schema.String,
  work: WorkJson,
  rating: Schema.NullOr(Schema.Number),
  rating_count: Schema.NullOr(Schema.Number),
  cover_file: Schema.NullOr(Schema.String),
  sample_files: Files,
  translated_title: Schema.NullOr(Schema.String),
  translated_description: Schema.NullOr(Schema.String),
  fetched_at: Schema.String,
})

const LinkRow = Schema.Struct({
  game_id: Schema.String,
  code: Schema.String,
  linked_by: LinkedBy,
  confidence: Schema.Int,
  linked_at: Schema.String,
})

const EditRow = Schema.Struct({ field: EditableField, value: Schema.String })

const FindRow = Schema.Struct({
  game_id: Schema.String,
  state: FindState,
  candidates: Candidates,
  error: Schema.NullOr(Schema.String),
})

const ListRow = Schema.Struct({ works: Hits, fetched_at: Schema.String })

const TagRow = Schema.Struct({ genre_id: Schema.Int, name: Schema.String })

const GameTypeRow = Schema.Struct({ work_type: GameType })

const WatchedRow = Schema.Struct({
  code: Schema.String,
  title: Schema.String,
  released_on: Schema.NullOr(Schema.String),
})

const encodeWork = Schema.encodeEffect(WorkJson)

const encodeFiles = Schema.encodeEffect(Files)

const encodeCandidates = Schema.encodeEffect(Candidates)

const encodeHits = Schema.encodeEffect(Hits)

const toStored = (row: typeof WorkRow.Type): StoredWork => ({
  work: row.work,
  rating: Option.fromNullishOr(row.rating),
  ratingCount: Option.fromNullishOr(row.rating_count),
  coverFile: Option.fromNullishOr(row.cover_file),
  sampleFiles: row.sample_files,
  translatedTitle: Option.fromNullishOr(row.translated_title),
  translatedDescription: Option.fromNullishOr(row.translated_description),
  fetchedAt: row.fetched_at,
})

const toLink = (row: typeof LinkRow.Type): WorkLink & { readonly gameId: string } => ({
  gameId: row.game_id,
  code: row.code,
  linkedBy: row.linked_by,
  confidence: row.confidence,
  linkedAt: row.linked_at,
})

export type StoredLink = ReturnType<typeof toLink>

const now = Effect.map(DateTime.now, DateTime.formatIso)

export class DetailsStore extends Context.Service<
  DetailsStore,
  {
    readonly work: (code: string) => Effect.Effect<Option.Option<StoredWork>>
    readonly saveWork: (
      work: Work,
      sales: Sales,
      files: { readonly cover: Option.Option<string>; readonly samples: ReadonlyArray<string> },
    ) => Effect.Effect<void>
    readonly saveTranslation: (
      code: string,
      title: string,
      description: string,
    ) => Effect.Effect<void>
    readonly link: (gameId: string) => Effect.Effect<Option.Option<StoredLink>>
    readonly links: Effect.Effect<ReadonlyArray<StoredLink>>
    readonly setLink: (
      gameId: string,
      code: string,
      linkedBy: LinkedBy,
      confidence: number,
    ) => Effect.Effect<void>
    readonly removeLink: (gameId: string) => Effect.Effect<void>
    readonly edits: (gameId: string) => Effect.Effect<ReadonlyMap<EditableField, string>>
    readonly setEdit: (
      gameId: string,
      field: EditableField,
      value: Option.Option<string>,
    ) => Effect.Effect<void>
    readonly find: (gameId: string) => Effect.Effect<Option.Option<FindRecord>>
    readonly finds: Effect.Effect<ReadonlyArray<FindRecord>>
    readonly setFind: (
      gameId: string,
      state: FindState,
      candidates: ReadonlyArray<MatchCandidate>,
      error: Option.Option<string>,
    ) => Effect.Effect<void>
    readonly list: (
      key: string,
    ) => Effect.Effect<
      Option.Option<{ readonly hits: ReadonlyArray<ListedHit>; readonly fetchedAt: string }>
    >
    readonly saveList: (key: string, hits: ReadonlyArray<ListedHit>) => Effect.Effect<void>
    readonly filterTags: Effect.Effect<ReadonlyArray<Genre>>
    readonly setFilterTag: (tag: Genre, chosen: boolean) => Effect.Effect<void>
    readonly filterGameTypes: Effect.Effect<ReadonlyArray<GameType>>
    readonly setFilterGameType: (type: GameType, chosen: boolean) => Effect.Effect<void>
    readonly watched: Effect.Effect<ReadonlyArray<Watched>>
    readonly setWatched: (code: string, title: string, watched: boolean) => Effect.Effect<void>
    readonly markReleased: (code: string, releasedOn: string) => Effect.Effect<void>
  }
>()('wenbu/core/details/DetailsStore') {
  static readonly layer = Layer.effect(
    DetailsStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const findWork = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: WorkRow,
        execute: (code) => sql`SELECT * FROM dlsite_works WHERE code = ${code}`,
      })

      const findLink = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: LinkRow,
        execute: (gameId) => sql`SELECT * FROM game_work_links WHERE game_id = ${gameId}`,
      })

      const allLinks = SqlSchema.findAll({
        Request: Schema.Void,
        Result: LinkRow,
        execute: () => sql`SELECT * FROM game_work_links`,
      })

      const findEdits = SqlSchema.findAll({
        Request: Schema.String,
        Result: EditRow,
        execute: (gameId) =>
          sql`SELECT field, value FROM game_detail_edits WHERE game_id = ${gameId}`,
      })

      const findFind = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: FindRow,
        execute: (gameId) => sql`SELECT * FROM game_detail_finds WHERE game_id = ${gameId}`,
      })

      const allFinds = SqlSchema.findAll({
        Request: Schema.Void,
        Result: FindRow,
        execute: () => sql`SELECT * FROM game_detail_finds ORDER BY updated_at`,
      })

      const findList = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: ListRow,
        execute: (key) => sql`SELECT works, fetched_at FROM dlsite_lists WHERE list = ${key}`,
      })

      const allFilterTags = SqlSchema.findAll({
        Request: Schema.Void,
        Result: TagRow,
        execute: () => sql`SELECT * FROM dlsite_filter_tags ORDER BY name COLLATE NOCASE`,
      })

      const allFilterGameTypes = SqlSchema.findAll({
        Request: Schema.Void,
        Result: GameTypeRow,
        execute: () => sql`SELECT * FROM dlsite_filter_game_types ORDER BY work_type`,
      })

      const allWatched = SqlSchema.findAll({
        Request: Schema.Void,
        Result: WatchedRow,
        execute: () => sql`SELECT code, title, released_on FROM dlsite_watched ORDER BY watched_at`,
      })

      const toFind = (row: typeof FindRow.Type): FindRecord => ({
        gameId: row.game_id,
        state: row.state,
        candidates: row.candidates,
        error: Option.fromNullishOr(row.error),
      })

      return DetailsStore.of({
        work: (code) => Effect.orDie(findWork(code)).pipe(Effect.map(Option.map(toStored))),
        saveWork: Effect.fn('DetailsStore.saveWork')(function* (work, sales, files) {
          const row = {
            code: work.code,
            work: yield* Effect.orDie(encodeWork(work)),
            rating: Option.getOrNull(sales.rating),
            rating_count: Option.getOrNull(sales.ratingCount),
            cover_file: Option.getOrNull(files.cover),
            sample_files: yield* Effect.orDie(encodeFiles(files.samples)),
            fetched_at: yield* now,
          }

          yield* Effect.orDie(sql`
            INSERT INTO dlsite_works ${sql.insert(row)}
            ON CONFLICT (code) DO UPDATE SET
              work = excluded.work,
              rating = excluded.rating,
              rating_count = excluded.rating_count,
              cover_file = excluded.cover_file,
              sample_files = excluded.sample_files,
              fetched_at = excluded.fetched_at
          `)
        }),
        saveTranslation: (code, title, description) =>
          Effect.orDie(sql`
            UPDATE dlsite_works SET translated_title = ${title}, translated_description = ${description}
            WHERE code = ${code}
          `),
        link: (gameId) => Effect.orDie(findLink(gameId)).pipe(Effect.map(Option.map(toLink))),
        links: Effect.orDie(allLinks()).pipe(Effect.map((rows) => rows.map(toLink))),
        setLink: Effect.fn('DetailsStore.setLink')(function* (gameId, code, linkedBy, confidence) {
          const row = {
            game_id: gameId,
            code,
            linked_by: linkedBy,
            confidence,
            linked_at: yield* now,
          }

          yield* Effect.orDie(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`DELETE FROM game_work_links WHERE game_id = ${gameId}`
                yield* sql`INSERT INTO game_work_links ${sql.insert(row)}`
                yield* sql`DELETE FROM game_detail_finds WHERE game_id = ${gameId}`
              }),
            ),
          )
        }),
        removeLink: (gameId) =>
          Effect.orDie(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`DELETE FROM game_work_links WHERE game_id = ${gameId}`
                yield* sql`DELETE FROM game_detail_edits WHERE game_id = ${gameId}`
              }),
            ),
          ),
        edits: (gameId) =>
          Effect.orDie(findEdits(gameId)).pipe(
            Effect.map((rows) => new Map(rows.map((row) => [row.field, row.value]))),
          ),
        setEdit: (gameId, field, value) =>
          Effect.orDie(
            Option.match(value, {
              onNone: () =>
                sql`DELETE FROM game_detail_edits WHERE game_id = ${gameId} AND field = ${field}`,
              onSome: (text) => sql`
                INSERT INTO game_detail_edits ${sql.insert({ game_id: gameId, field, value: text })}
                ON CONFLICT (game_id, field) DO UPDATE SET value = excluded.value
              `,
            }),
          ),
        find: (gameId) => Effect.orDie(findFind(gameId)).pipe(Effect.map(Option.map(toFind))),
        finds: Effect.orDie(allFinds()).pipe(Effect.map((rows) => rows.map(toFind))),
        setFind: Effect.fn('DetailsStore.setFind')(function* (gameId, state, candidates, error) {
          const row = {
            game_id: gameId,
            state,
            candidates: yield* Effect.orDie(encodeCandidates(candidates)),
            error: Option.getOrNull(error),
            updated_at: yield* now,
          }

          yield* Effect.orDie(sql`
            INSERT INTO game_detail_finds ${sql.insert(row)}
            ON CONFLICT (game_id) DO UPDATE SET
              state = excluded.state,
              candidates = excluded.candidates,
              error = excluded.error,
              updated_at = excluded.updated_at
          `)
        }),
        list: (key) =>
          Effect.orDie(findList(key)).pipe(
            Effect.map(Option.map((row) => ({ hits: row.works, fetchedAt: row.fetched_at }))),
          ),
        saveList: Effect.fn('DetailsStore.saveList')(function* (key, hits) {
          const row = {
            list: key,
            works: yield* Effect.orDie(encodeHits(hits)),
            fetched_at: yield* now,
          }

          yield* Effect.orDie(sql`
            INSERT INTO dlsite_lists ${sql.insert(row)}
            ON CONFLICT (list) DO UPDATE SET works = excluded.works, fetched_at = excluded.fetched_at
          `)
        }),
        filterTags: Effect.orDie(allFilterTags()).pipe(
          Effect.map((rows) => rows.map((row) => ({ id: row.genre_id, name: row.name }))),
        ),
        setFilterTag: (tag, chosen) =>
          Effect.orDie(
            chosen
              ? sql`
                  INSERT INTO dlsite_filter_tags ${sql.insert({ genre_id: tag.id, name: tag.name })}
                  ON CONFLICT (genre_id) DO UPDATE SET name = excluded.name
                `
              : sql`DELETE FROM dlsite_filter_tags WHERE genre_id = ${tag.id}`,
          ),
        filterGameTypes: Effect.orDie(allFilterGameTypes()).pipe(
          Effect.map((rows) => rows.map((row) => row.work_type)),
        ),
        setFilterGameType: (type, chosen) =>
          Effect.orDie(
            chosen
              ? sql`
                  INSERT INTO dlsite_filter_game_types ${sql.insert({ work_type: type })}
                  ON CONFLICT (work_type) DO NOTHING
                `
              : sql`DELETE FROM dlsite_filter_game_types WHERE work_type = ${type}`,
          ),
        watched: Effect.orDie(allWatched()).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              code: row.code,
              title: row.title,
              releasedOn: Option.fromNullishOr(row.released_on),
            })),
          ),
        ),
        setWatched: Effect.fn('DetailsStore.setWatched')(function* (code, title, watched) {
          if (!watched) {
            return yield* Effect.orDie(sql`DELETE FROM dlsite_watched WHERE code = ${code}`)
          }

          const row = { code, title, watched_at: yield* now }

          yield* Effect.orDie(sql`
            INSERT INTO dlsite_watched ${sql.insert(row)} ON CONFLICT (code) DO NOTHING
          `)
        }),
        markReleased: (code, releasedOn) =>
          Effect.orDie(
            sql`UPDATE dlsite_watched SET released_on = ${releasedOn} WHERE code = ${code}`,
          ),
      })
    }),
  )
}
