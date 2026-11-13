import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { type KnowledgeIndex, knowledgeIndexVersion } from './KnowledgeIndex'

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

export interface StoredIndex {
  readonly stamp: string
  readonly index: KnowledgeIndex
}

export class GuideIndexStore extends Context.Service<
  GuideIndexStore,
  {
    readonly get: (gameId: string) => Effect.Effect<StoredIndex | undefined>
    readonly save: (gameId: string, stored: StoredIndex) => Effect.Effect<void>
  }
>()('wenbu/core/gameguide/GuideIndexStore') {
  static readonly layer = Layer.effect(
    GuideIndexStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const get = Effect.fn('GuideIndexStore.get')(function* (gameId: string) {
        const rows = yield* sql<{ readonly stamp: string; readonly data: string }>`
          SELECT stamp, data FROM guide_indexes
          WHERE game_id = ${gameId} AND version = ${knowledgeIndexVersion}
        `.pipe(Effect.orDie)

        const row = rows[0]

        if (row === undefined) {
          return undefined
        }

        // SAFETY: Wenbu wrote this JSON from a KnowledgeIndex of the same version, checked above.
        // Checking every node of a large game's index against its shape would cost seconds for nothing.
        const index = (yield* decodeJson(row.data).pipe(Effect.orDie)) as KnowledgeIndex

        return { stamp: row.stamp, index }
      })

      const save = Effect.fn('GuideIndexStore.save')(function* (
        gameId: string,
        stored: StoredIndex,
      ) {
        const builtAt = DateTime.formatIso(yield* DateTime.now)
        const data = yield* encodeJson(stored.index).pipe(Effect.orDie)

        yield* sql`
          INSERT INTO guide_indexes (game_id, version, stamp, built_at, data)
          VALUES (${gameId}, ${knowledgeIndexVersion}, ${stored.stamp}, ${builtAt}, ${data})
          ON CONFLICT (game_id) DO UPDATE SET
            version = excluded.version,
            stamp = excluded.stamp,
            built_at = excluded.built_at,
            data = excluded.data
        `.pipe(Effect.orDie)
      })

      return GuideIndexStore.of({ get, save })
    }),
  )
}
