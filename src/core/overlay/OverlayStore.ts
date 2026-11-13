import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  defaultTextPipeline,
  SavedHook,
  StorySummary,
  TextPipeline,
} from '#contract/TranslationOverlay'
import { DiskSpace } from '../platform/DiskSpace'

const SavedHookJson = Schema.fromJsonString(SavedHook)

const PipelineJson = Schema.fromJsonString(TextPipeline)

const StoryJson = Schema.fromJsonString(StorySummary)

const ByLanguage = Schema.Struct({ gameId: Schema.String, targetLanguage: Schema.String })

const CacheKey = Schema.Struct({ ...ByLanguage.fields, sourceText: Schema.String })

export class OverlayStore extends Context.Service<
  OverlayStore,
  {
    readonly savedHook: (gameId: string) => Effect.Effect<Option.Option<SavedHook>>
    readonly saveHook: (gameId: string, hook: SavedHook) => Effect.Effect<void>
    readonly pipeline: (gameId: string) => Effect.Effect<TextPipeline>
    readonly savePipeline: (gameId: string, pipeline: TextPipeline) => Effect.Effect<void>
    readonly resetPipeline: (gameId: string) => Effect.Effect<void>
    readonly cached: (key: typeof CacheKey.Type) => Effect.Effect<Option.Option<string>>
    readonly cache: (key: typeof CacheKey.Type, translatedText: string) => Effect.Effect<void>
    readonly story: (
      gameId: string,
      targetLanguage: string,
    ) => Effect.Effect<Option.Option<StorySummary>>
    readonly saveStory: (
      gameId: string,
      targetLanguage: string,
      story: StorySummary,
    ) => Effect.Effect<void>
    readonly resetStory: (gameId: string) => Effect.Effect<void>
  }
>()('wenbu/core/overlay/OverlayStore') {
  static readonly layer = Layer.effect(
    OverlayStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const disk = yield* DiskSpace

      const findHook = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ hook: SavedHookJson }),
        execute: (gameId) => sql`SELECT hook FROM overlay_saved_hooks WHERE game_id = ${gameId}`,
      })

      const findPipeline = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ pipeline: PipelineJson }),
        execute: (gameId) => sql`SELECT pipeline FROM overlay_pipelines WHERE game_id = ${gameId}`,
      })

      const findCached = SqlSchema.findOneOption({
        Request: CacheKey,
        Result: Schema.Struct({ translated_text: Schema.String }),
        execute: (key) => sql`
          SELECT translated_text FROM overlay_cache
          WHERE game_id = ${key.gameId}
            AND target_language = ${key.targetLanguage}
            AND source_text = ${key.sourceText}
        `,
      })

      const findStory = SqlSchema.findOneOption({
        Request: ByLanguage,
        Result: Schema.Struct({ story: StoryJson }),
        execute: (key) => sql`
          SELECT story FROM overlay_stories
          WHERE game_id = ${key.gameId} AND target_language = ${key.targetLanguage}
        `,
      })

      const savedHook = (gameId: string) =>
        findHook(gameId).pipe(
          Effect.map(Option.map((row) => row.hook)),
          Effect.orElseSucceed(() => Option.none()),
        )

      const saveHook = Effect.fn('OverlayStore.saveHook')(function* (
        gameId: string,
        hook: SavedHook,
      ) {
        const json = yield* Schema.encodeEffect(SavedHookJson)(hook)

        yield* sql`
          INSERT INTO overlay_saved_hooks ${sql.insert({ game_id: gameId, hook: json })}
          ON CONFLICT (game_id) DO UPDATE SET hook = excluded.hook
        `
      }, Effect.orDie)

      const pipeline = (gameId: string) =>
        findPipeline(gameId).pipe(
          Effect.map(
            Option.match({ onNone: () => defaultTextPipeline, onSome: (row) => row.pipeline }),
          ),
          Effect.orElseSucceed(() => defaultTextPipeline),
        )

      const savePipeline = Effect.fn('OverlayStore.savePipeline')(function* (
        gameId: string,
        value: TextPipeline,
      ) {
        const json = yield* Schema.encodeEffect(PipelineJson)(value)

        yield* sql`
          INSERT INTO overlay_pipelines ${sql.insert({ game_id: gameId, pipeline: json })}
          ON CONFLICT (game_id) DO UPDATE SET pipeline = excluded.pipeline
        `
      }, Effect.orDie)

      const resetPipeline = (gameId: string) =>
        Effect.orDie(sql`DELETE FROM overlay_pipelines WHERE game_id = ${gameId}`)

      const cached = (key: typeof CacheKey.Type) =>
        findCached(key).pipe(
          Effect.map(Option.map((row) => row.translated_text)),
          Effect.orElseSucceed(() => Option.none()),
        )

      const cache = Effect.fn('OverlayStore.cache')(function* (
        key: typeof CacheKey.Type,
        translatedText: string,
      ) {
        if ((yield* disk.dataLevel) === 'critical') {
          return
        }

        const row = {
          game_id: key.gameId,
          target_language: key.targetLanguage,
          source_text: key.sourceText,
          translated_text: translatedText,
          created_at: DateTime.formatIso(yield* DateTime.now),
        }

        yield* sql`
          INSERT INTO overlay_cache ${sql.insert(row)}
          ON CONFLICT (game_id, target_language, source_text)
          DO UPDATE SET translated_text = excluded.translated_text
        `
      }, Effect.orDie)

      const story = (gameId: string, targetLanguage: string) =>
        findStory({ gameId, targetLanguage }).pipe(
          Effect.map(Option.map((row) => row.story)),
          Effect.orElseSucceed(() => Option.none()),
        )

      const saveStory = Effect.fn('OverlayStore.saveStory')(function* (
        gameId: string,
        targetLanguage: string,
        value: StorySummary,
      ) {
        const json = yield* Schema.encodeEffect(StoryJson)(value)

        yield* sql`
          INSERT INTO overlay_stories ${sql.insert({ game_id: gameId, target_language: targetLanguage, story: json })}
          ON CONFLICT (game_id, target_language) DO UPDATE SET story = excluded.story
        `
      }, Effect.orDie)

      const resetStory = (gameId: string) =>
        Effect.orDie(sql`DELETE FROM overlay_stories WHERE game_id = ${gameId}`)

      return OverlayStore.of({
        savedHook,
        saveHook,
        pipeline,
        savePipeline,
        resetPipeline,
        cached,
        cache,
        story,
        saveStory,
        resetStory,
      })
    }),
  )
}
