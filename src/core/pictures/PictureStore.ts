import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { PictureLine, PictureStatus } from '#contract/Pictures'
import { DiskSpace } from '../platform/DiskSpace'

export interface StoredPicture {
  readonly picture: string
  readonly fileSize: number
  readonly modifiedAt: string
  readonly width: number
  readonly height: number
  readonly lines: ReadonlyArray<PictureLine>
  readonly group: string
  readonly status: PictureStatus
  readonly cleanedKey: string | undefined
  readonly translatedFile: string | undefined
}

export type PictureChange = Partial<
  Pick<StoredPicture, 'lines' | 'group' | 'status' | 'cleanedKey' | 'translatedFile'>
>

const LinesJson = Schema.fromJsonString(Schema.Array(PictureLine))

const Row = Schema.Struct({
  picture: Schema.String,
  file_size: Schema.Int,
  modified_at: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  lines: LinesJson,
  group_key: Schema.String,
  status: PictureStatus,
  cleaned_key: Schema.NullOr(Schema.String),
  translated_file: Schema.NullOr(Schema.String),
})

const ByPicture = Schema.Struct({ gameId: Schema.String, picture: Schema.String })

const toPicture = (row: typeof Row.Type): StoredPicture => ({
  picture: row.picture,
  fileSize: row.file_size,
  modifiedAt: row.modified_at,
  width: row.width,
  height: row.height,
  lines: row.lines,
  group: row.group_key,
  status: row.status,
  cleanedKey: row.cleaned_key ?? undefined,
  translatedFile: row.translated_file ?? undefined,
})

const encodeLines = Schema.encodeEffect(LinesJson)

export class PictureStore extends Context.Service<
  PictureStore,
  {
    readonly pictures: (gameId: string) => Effect.Effect<ReadonlyArray<StoredPicture>>
    readonly picture: (
      gameId: string,
      picture: string,
    ) => Effect.Effect<Option.Option<StoredPicture>>
    readonly save: (gameId: string, picture: StoredPicture) => Effect.Effect<void>
    readonly update: (
      gameId: string,
      picture: string,
      change: PictureChange,
    ) => Effect.Effect<Option.Option<StoredPicture>>
    readonly remove: (gameId: string, pictures: ReadonlyArray<string>) => Effect.Effect<void>
  }
>()('wenbu/core/pictures/PictureStore') {
  static readonly layer = Layer.effect(
    PictureStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const disk = yield* DiskSpace

      const findAll = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (gameId) => sql`
          SELECT * FROM game_pictures WHERE game_id = ${gameId} ORDER BY picture
        `,
      })

      const findOne = SqlSchema.findOneOption({
        Request: ByPicture,
        Result: Row,
        execute: (key) => sql`
          SELECT * FROM game_pictures WHERE game_id = ${key.gameId} AND picture = ${key.picture}
        `,
      })

      const pictures = (gameId: string) =>
        findAll(gameId).pipe(
          Effect.map((rows) => rows.map((row) => toPicture(row))),
          Effect.orDie,
        )

      const picture = (gameId: string, key: string) =>
        findOne({ gameId, picture: key }).pipe(
          Effect.map(Option.map((row) => toPicture(row))),
          Effect.orDie,
        )

      const save = Effect.fn('PictureStore.save')(function* (
        gameId: string,
        stored: StoredPicture,
      ) {
        if ((yield* disk.dataLevel) === 'critical') {
          return
        }

        const row = {
          game_id: gameId,
          picture: stored.picture,
          file_size: stored.fileSize,
          modified_at: stored.modifiedAt,
          width: stored.width,
          height: stored.height,
          lines: yield* encodeLines(stored.lines),
          group_key: stored.group,
          status: stored.status,
          cleaned_key: stored.cleanedKey ?? null,
          translated_file: stored.translatedFile ?? null,
          scanned_at: DateTime.formatIso(yield* DateTime.now),
        }

        yield* sql`
          INSERT INTO game_pictures ${sql.insert(row)}
          ON CONFLICT (game_id, picture) DO UPDATE SET
            file_size = excluded.file_size,
            modified_at = excluded.modified_at,
            width = excluded.width,
            height = excluded.height,
            lines = excluded.lines,
            group_key = excluded.group_key,
            status = excluded.status,
            cleaned_key = excluded.cleaned_key,
            translated_file = excluded.translated_file,
            scanned_at = excluded.scanned_at
        `
      }, Effect.orDie)

      const update = Effect.fn('PictureStore.update')(function* (
        gameId: string,
        key: string,
        change: PictureChange,
      ) {
        const current = yield* picture(gameId, key)

        if (Option.isNone(current)) {
          return current
        }

        const next: StoredPicture = { ...current.value, ...change }

        yield* sql`
          UPDATE game_pictures SET
            lines = ${yield* encodeLines(next.lines)},
            group_key = ${next.group},
            status = ${next.status},
            cleaned_key = ${next.cleanedKey ?? null},
            translated_file = ${next.translatedFile ?? null}
          WHERE game_id = ${gameId} AND picture = ${key}
        `

        return Option.some(next)
      }, Effect.orDie)

      const remove = Effect.fn('PictureStore.remove')(function* (
        gameId: string,
        keys: ReadonlyArray<string>,
      ) {
        if (keys.length === 0) {
          return
        }

        yield* sql`
          DELETE FROM game_pictures WHERE game_id = ${gameId} AND ${sql.in('picture', keys)}
        `
      }, Effect.orDie)

      return PictureStore.of({ pictures, picture, save, update, remove })
    }),
  )
}
