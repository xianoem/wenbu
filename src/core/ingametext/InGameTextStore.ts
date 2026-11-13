import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  type InGameTextEntry,
  type InGameTextFilter,
  InGameTextOrigin,
  TextFit,
} from '#contract/InGameText'
import { DiskSpace } from '../platform/DiskSpace'

export interface EntryKey {
  readonly gameId: string
  readonly targetLanguage: string
  readonly origin: InGameTextOrigin
  readonly key: string
}

export interface NewTranslation extends EntryKey {
  readonly translatedText: string
  readonly scene?: string | undefined
  readonly allowedWidth?: number | undefined
  readonly fontSize?: number | undefined
}

export interface StoredEntry extends InGameTextEntry {
  readonly shortened: boolean
}

export const ImageBox = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  w: Schema.Int,
  h: Schema.Int,
  key: Schema.String,
})

export type ImageBox = typeof ImageBox.Type

export interface ImageRecord {
  readonly imagePath: string
  readonly fileSize: number
  readonly modifiedAt: string
  readonly boxes: ReadonlyArray<ImageBox>
}

export interface StoredCounts {
  readonly strings: number
  readonly tooLong: number
  readonly images: { readonly withText: number; readonly total: number }
}

const Row = Schema.Struct({
  source_key: Schema.String,
  origin: InGameTextOrigin,
  translated_text: Schema.String,
  scene: Schema.NullOr(Schema.String),
  allowed_width: Schema.NullOr(Schema.Int),
  font_size: Schema.NullOr(Schema.Int),
  fit: TextFit,
  edited: Schema.Int,
  locked: Schema.Int,
  shortened: Schema.Int,
  first_seen_at: Schema.String,
  updated_at: Schema.String,
})

const BoxesJson = Schema.fromJsonString(Schema.Array(ImageBox))

const ImageRow = Schema.Struct({
  image_path: Schema.String,
  file_size: Schema.Int,
  modified_at: Schema.String,
  boxes: BoxesJson,
})

const Count = Schema.Struct({ count: Schema.Int })

const ByLanguage = Schema.Struct({ gameId: Schema.String, targetLanguage: Schema.String })

const Listing = Schema.Struct({
  ...ByLanguage.fields,
  filter: Schema.String,
  search: Schema.String,
})

const Key = Schema.Struct({
  ...ByLanguage.fields,
  origin: InGameTextOrigin,
  key: Schema.String,
})

const ByOrigin = Schema.Struct({ ...ByLanguage.fields, origin: InGameTextOrigin })

const toEntry = (row: typeof Row.Type): StoredEntry => ({
  key: row.source_key,
  origin: row.origin,
  translatedText: row.translated_text,
  ...(row.scene === null ? {} : { scene: row.scene }),
  ...(row.allowed_width === null ? {} : { allowedWidth: row.allowed_width }),
  ...(row.font_size === null ? {} : { fontSize: row.font_size }),
  fit: row.fit,
  edited: row.edited !== 0,
  locked: row.locked !== 0,
  shortened: row.shortened !== 0,
  firstSeenAt: row.first_seen_at,
  updatedAt: row.updated_at,
})

const filterClause = (filter: string) => {
  if (filter === 'too-long') {
    return "AND fit = 'too-long'"
  }

  if (filter === 'edited') {
    return 'AND edited = 1'
  }

  if (filter === 'images') {
    return "AND origin = 'image'"
  }

  return ''
}

const now = Effect.map(DateTime.now, (time) => DateTime.formatIso(time))

export class InGameTextStore extends Context.Service<
  InGameTextStore,
  {
    readonly entries: (
      gameId: string,
      targetLanguage: string,
      filter: InGameTextFilter,
      search: string,
    ) => Effect.Effect<ReadonlyArray<StoredEntry>>
    readonly entry: (key: EntryKey) => Effect.Effect<Option.Option<StoredEntry>>
    readonly dictionary: (
      gameId: string,
      targetLanguage: string,
      origin: InGameTextOrigin,
    ) => Effect.Effect<ReadonlyArray<readonly [string, string]>>
    readonly saveTranslation: (translation: NewTranslation) => Effect.Effect<void>
    readonly saveShortened: (key: EntryKey, translatedText: string) => Effect.Effect<void>
    readonly edit: (
      key: EntryKey,
      translatedText: string,
    ) => Effect.Effect<Option.Option<StoredEntry>>
    readonly setLocked: (
      key: EntryKey,
      locked: boolean,
    ) => Effect.Effect<Option.Option<StoredEntry>>
    readonly recordFit: (
      key: EntryKey,
      fit: TextFit,
      allowedWidth: number | undefined,
    ) => Effect.Effect<void>
    readonly counts: (gameId: string, targetLanguage: string) => Effect.Effect<StoredCounts>
    readonly images: (gameId: string) => Effect.Effect<ReadonlyArray<ImageRecord>>
    readonly saveImage: (gameId: string, image: ImageRecord) => Effect.Effect<void>
  }
>()('wenbu/core/ingametext/InGameTextStore') {
  static readonly layer = Layer.effect(
    InGameTextStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const disk = yield* DiskSpace

      const findEntries = SqlSchema.findAll({
        Request: Listing,
        Result: Row,
        execute: (request) => {
          const pattern = `%${request.search.trim()}%`

          return sql`
            SELECT * FROM ingame_texts
            WHERE game_id = ${request.gameId}
              AND target_language = ${request.targetLanguage}
              ${sql.unsafe(filterClause(request.filter))}
              AND (source_key LIKE ${pattern} OR translated_text LIKE ${pattern})
            ORDER BY fit = 'too-long' DESC, first_seen_at DESC, source_key
          `
        },
      })

      const findEntry = SqlSchema.findOneOption({
        Request: Key,
        Result: Row,
        execute: (key) => sql`
          SELECT * FROM ingame_texts
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND origin = ${key.origin}
            AND source_key = ${key.key}
        `,
      })

      const findDictionary = SqlSchema.findAll({
        Request: ByOrigin,
        Result: Schema.Struct({ source_key: Schema.String, translated_text: Schema.String }),
        execute: (request) => sql`
          SELECT source_key, translated_text FROM ingame_texts
          WHERE game_id = ${request.gameId}
            AND target_language = ${request.targetLanguage}
            AND origin = ${request.origin}
        `,
      })

      const countWhere = (request: typeof ByLanguage.Type, clause: string) =>
        SqlSchema.findOne({
          Request: ByLanguage,
          Result: Count,
          execute: (by) => sql`
            SELECT COUNT(*) AS count FROM ingame_texts
            WHERE game_id = ${by.gameId} AND target_language = ${by.targetLanguage}
            ${sql.unsafe(clause)}
          `,
        })(request).pipe(Effect.map((row) => row.count))

      const findImages = SqlSchema.findAll({
        Request: Schema.String,
        Result: ImageRow,
        execute: (gameId) => sql`
          SELECT image_path, file_size, modified_at, boxes FROM ingame_images
          WHERE game_id = ${gameId}
          ORDER BY image_path
        `,
      })

      const entries = (
        gameId: string,
        targetLanguage: string,
        filter: InGameTextFilter,
        search: string,
      ) =>
        findEntries({ gameId, targetLanguage, filter, search }).pipe(
          Effect.map((rows) => rows.map(toEntry)),
          Effect.orDie,
        )

      const entry = (key: EntryKey) =>
        findEntry(key).pipe(Effect.map(Option.map(toEntry)), Effect.orDie)

      const dictionary = (gameId: string, targetLanguage: string, origin: InGameTextOrigin) =>
        findDictionary({ gameId, targetLanguage, origin }).pipe(
          Effect.map((rows) => rows.map((row) => [row.source_key, row.translated_text] as const)),
          Effect.orDie,
        )

      const saveTranslation = Effect.fn('InGameTextStore.saveTranslation')(function* (
        translation: NewTranslation,
      ) {
        if ((yield* disk.dataLevel) === 'critical') {
          return
        }

        const time = yield* now

        const row = {
          game_id: translation.gameId,
          target_language: translation.targetLanguage,
          source_key: translation.key,
          origin: translation.origin,
          translated_text: translation.translatedText,
          scene: translation.scene ?? null,
          allowed_width: translation.allowedWidth ?? null,
          font_size: translation.fontSize ?? null,
          fit: 'as-is',
          first_seen_at: time,
          updated_at: time,
        }

        yield* sql`
          INSERT INTO ingame_texts ${sql.insert(row)}
          ON CONFLICT (game_id, target_language, source_key, origin) DO UPDATE SET
            translated_text = excluded.translated_text,
            updated_at = excluded.updated_at
          WHERE edited = 0 AND locked = 0
        `
      }, Effect.orDie)

      const saveShortened = Effect.fn('InGameTextStore.saveShortened')(function* (
        key: EntryKey,
        translatedText: string,
      ) {
        const time = yield* now

        yield* sql`
          UPDATE ingame_texts
          SET translated_text = ${translatedText}, shortened = 1, updated_at = ${time}
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND origin = ${key.origin}
            AND source_key = ${key.key}
            AND edited = 0 AND locked = 0
        `
      }, Effect.orDie)

      const edit = Effect.fn('InGameTextStore.edit')(function* (
        key: EntryKey,
        translatedText: string,
      ) {
        const time = yield* now

        yield* sql`
          UPDATE ingame_texts
          SET translated_text = ${translatedText}, edited = 1, updated_at = ${time}
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND origin = ${key.origin}
            AND source_key = ${key.key}
        `

        return yield* entry(key)
      }, Effect.orDie)

      const setLocked = Effect.fn('InGameTextStore.setLocked')(function* (
        key: EntryKey,
        locked: boolean,
      ) {
        yield* sql`
          UPDATE ingame_texts SET locked = ${locked ? 1 : 0}
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND origin = ${key.origin}
            AND source_key = ${key.key}
        `

        return yield* entry(key)
      }, Effect.orDie)

      const recordFit = Effect.fn('InGameTextStore.recordFit')(function* (
        key: EntryKey,
        fit: TextFit,
        allowedWidth: number | undefined,
      ) {
        yield* sql`
          UPDATE ingame_texts
          SET fit = ${fit}, allowed_width = COALESCE(${allowedWidth ?? null}, allowed_width)
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND origin = ${key.origin}
            AND source_key = ${key.key}
        `
      }, Effect.orDie)

      const counts = Effect.fn('InGameTextStore.counts')(function* (
        gameId: string,
        targetLanguage: string,
      ) {
        const by = { gameId, targetLanguage }
        const images = yield* findImages(gameId)

        return {
          strings: yield* countWhere(by, ''),
          tooLong: yield* countWhere(by, "AND fit = 'too-long'"),
          images: {
            withText: images.filter((image) => image.boxes.length > 0).length,
            total: images.length,
          },
        }
      }, Effect.orDie)

      const images = (gameId: string) =>
        findImages(gameId).pipe(
          Effect.map((rows) =>
            rows.map((row): ImageRecord => ({
              imagePath: row.image_path,
              fileSize: row.file_size,
              modifiedAt: row.modified_at,
              boxes: row.boxes,
            })),
          ),
          Effect.orDie,
        )

      const saveImage = Effect.fn('InGameTextStore.saveImage')(function* (
        gameId: string,
        image: ImageRecord,
      ) {
        if ((yield* disk.dataLevel) === 'critical') {
          return
        }

        const row = {
          game_id: gameId,
          image_path: image.imagePath,
          file_size: image.fileSize,
          modified_at: image.modifiedAt,
          boxes: yield* Schema.encodeEffect(BoxesJson)(image.boxes),
          scanned_at: yield* now,
        }

        yield* sql`
          INSERT INTO ingame_images ${sql.insert(row)}
          ON CONFLICT (game_id, image_path) DO UPDATE SET
            file_size = excluded.file_size,
            modified_at = excluded.modified_at,
            boxes = excluded.boxes,
            scanned_at = excluded.scanned_at
        `
      }, Effect.orDie)

      return InGameTextStore.of({
        entries,
        entry,
        dictionary,
        saveTranslation,
        saveShortened,
        edit,
        setLocked,
        recordFit,
        counts,
        images,
        saveImage,
      })
    }),
  )
}
