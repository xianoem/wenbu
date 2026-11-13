import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'

export interface FileHashes {
  readonly original: string
  readonly written?: string
}

const Row = Schema.Struct({
  file: Schema.String,
  original_hash: Schema.String,
  written_hash: Schema.NullOr(Schema.String),
})

export const changedFiles = (
  stored: ReadonlyMap<string, FileHashes>,
  current: ReadonlyMap<string, string>,
) =>
  [...current]
    .filter(([file, hash]) => {
      const known = stored.get(file)

      return known === undefined || (hash !== known.original && hash !== known.written)
    })
    .map(([file]) => file)

export class GameFileHashes extends Context.Service<
  GameFileHashes,
  {
    readonly get: (gameId: string) => Effect.Effect<ReadonlyMap<string, FileHashes>>
    readonly record: (
      gameId: string,
      originals: ReadonlyMap<string, string>,
      written: ReadonlyMap<string, string>,
    ) => Effect.Effect<void>
    readonly saveOriginals: (
      gameId: string,
      hashes: ReadonlyMap<string, string>,
    ) => Effect.Effect<void>
    readonly saveWritten: (
      gameId: string,
      written: ReadonlyMap<string, string>,
    ) => Effect.Effect<void>
    readonly remove: (gameId: string) => Effect.Effect<void>
  }
>()('wenbu/core/translation/GameFileHashes') {
  static readonly layer = Layer.effect(
    GameFileHashes,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const findRows = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (gameId) =>
          sql`SELECT file, original_hash, written_hash FROM game_file_hashes WHERE game_id = ${gameId}`,
      })

      const get = (gameId: string) =>
        findRows(gameId).pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.map((row) => [
                  row.file,
                  {
                    original: row.original_hash,
                    ...(row.written_hash === null ? {} : { written: row.written_hash }),
                  },
                ]),
              ),
          ),
          Effect.orDie,
        )

      const upsertOriginal = (gameId: string, file: string, hash: string) =>
        sql`
          INSERT INTO game_file_hashes ${sql.insert({ game_id: gameId, file, original_hash: hash })}
          ON CONFLICT (game_id, file) DO UPDATE SET
            original_hash = excluded.original_hash, written_hash = NULL
        `

      const record = (
        gameId: string,
        originals: ReadonlyMap<string, string>,
        written: ReadonlyMap<string, string>,
      ) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM game_file_hashes WHERE game_id = ${gameId}`

              for (const [file, hash] of originals) {
                yield* sql`INSERT INTO game_file_hashes ${sql.insert({
                  game_id: gameId,
                  file,
                  original_hash: hash,
                  written_hash: written.get(file) ?? null,
                })}`
              }
            }),
          )
          .pipe(Effect.orDie)

      const saveOriginals = (gameId: string, hashes: ReadonlyMap<string, string>) =>
        sql
          .withTransaction(
            Effect.forEach(hashes, ([file, hash]) => upsertOriginal(gameId, file, hash), {
              discard: true,
            }),
          )
          .pipe(Effect.orDie)

      const saveWritten = (gameId: string, written: ReadonlyMap<string, string>) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE game_file_hashes SET written_hash = NULL WHERE game_id = ${gameId}`

              for (const [file, hash] of written) {
                yield* sql`
                  UPDATE game_file_hashes SET written_hash = ${hash}
                  WHERE game_id = ${gameId} AND file = ${file}
                `
              }
            }),
          )
          .pipe(Effect.orDie)

      const remove = (gameId: string) =>
        Effect.orDie(sql`DELETE FROM game_file_hashes WHERE game_id = ${gameId}`)

      return GameFileHashes.of({ get, record, saveOriginals, saveWritten, remove })
    }),
  )
}
