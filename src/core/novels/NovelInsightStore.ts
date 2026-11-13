import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { NovelAnswer } from '#contract/Novels'

const DigestFlag = Schema.Struct({ id: Schema.String, note: Schema.String })

const DigestRow = Schema.Struct({
  number: Schema.Int,
  summary: Schema.String,
  characters: Schema.fromJsonString(Schema.Array(Schema.String)),
  flags: Schema.fromJsonString(Schema.Array(DigestFlag)),
  cost_usd: Schema.NullOr(Schema.Number),
})

export type StoredDigest = typeof DigestRow.Type

export interface DigestSave {
  readonly number: number
  readonly summary: string
  readonly characters: ReadonlyArray<string>
  readonly flags: ReadonlyArray<typeof DigestFlag.Type>
  readonly costUsd: number | null
}

const HitRow = Schema.Struct({
  number: Schema.Int,
  paragraph: Schema.Int,
  body: Schema.String,
})

export type TextHit = typeof HitRow.Type

const AnswerRow = Schema.Struct({ answer: Schema.fromJsonString(NovelAnswer) })

const encodeAnswer = Schema.encodeEffect(Schema.fromJsonString(NovelAnswer))

const encodeDigest = Schema.encodeEffect(
  Schema.Struct({
    characters: Schema.fromJsonString(Schema.Array(Schema.String)),
    flags: Schema.fromJsonString(Schema.Array(DigestFlag)),
  }),
)

const TRIGRAM = 3

export class NovelInsightStore extends Context.Service<
  NovelInsightStore,
  {
    readonly digests: (novelId: string) => Effect.Effect<ReadonlyArray<StoredDigest>>
    readonly saveDigest: (novelId: string, digest: DigestSave) => Effect.Effect<void>
    readonly search: (
      novelId: string,
      words: ReadonlyArray<string>,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<TextHit>>
    readonly answers: (novelId: string, limit: number) => Effect.Effect<ReadonlyArray<NovelAnswer>>
    readonly saveAnswer: (novelId: string, answer: NovelAnswer) => Effect.Effect<void>
  }
>()('wenbu/core/novels/NovelInsightStore') {
  static readonly layer = Layer.effect(
    NovelInsightStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const allDigests = SqlSchema.findAll({
        Request: Schema.String,
        Result: DigestRow,
        execute: (novelId) => sql`
          SELECT number, summary, characters, flags, cost_usd FROM novel_digests
          WHERE novel_id = ${novelId} ORDER BY number
        `,
      })

      const latestAnswers = SqlSchema.findAll({
        Request: Schema.Struct({ novelId: Schema.String, limit: Schema.Int }),
        Result: AnswerRow,
        execute: ({ novelId, limit }) => sql`
          SELECT answer FROM novel_answers WHERE novel_id = ${novelId}
          ORDER BY asked_at DESC LIMIT ${limit}
        `,
      })

      const findWord = SqlSchema.findAll({
        Request: Schema.Struct({ novelId: Schema.String, word: Schema.String, limit: Schema.Int }),
        Result: HitRow,
        execute: ({ novelId, word, limit }) =>
          word.length >= TRIGRAM
            ? sql`
                SELECT number, paragraph, body FROM novel_text_index
                WHERE novel_text_index MATCH ${`"${word.replaceAll('"', '""')}"`} AND novel_id = ${novelId}
                ORDER BY number, paragraph LIMIT ${limit}
              `
            : sql`
                SELECT number, paragraph, body FROM novel_text_index
                WHERE novel_id = ${novelId} AND instr(body, ${word}) > 0
                ORDER BY number, paragraph LIMIT ${limit}
              `,
      })

      return NovelInsightStore.of({
        digests: (novelId) => Effect.orDie(allDigests(novelId)),
        saveDigest: Effect.fn('NovelInsightStore.saveDigest')(function* (novelId, digest) {
          const encoded = yield* Effect.orDie(
            encodeDigest({ characters: digest.characters, flags: digest.flags }),
          )

          const row = {
            novel_id: novelId,
            number: digest.number,
            summary: digest.summary,
            characters: encoded.characters,
            flags: encoded.flags,
            cost_usd: digest.costUsd,
            made_at: DateTime.formatIso(yield* DateTime.now),
          }

          yield* Effect.orDie(sql`
            INSERT INTO novel_digests ${sql.insert(row)}
            ON CONFLICT (novel_id, number) DO UPDATE SET
              summary = excluded.summary, characters = excluded.characters, flags = excluded.flags,
              cost_usd = excluded.cost_usd, made_at = excluded.made_at
          `)
        }),
        search: Effect.fn('NovelInsightStore.search')(function* (novelId, words, limit) {
          const hits = new Map<string, TextHit>()

          for (const word of words) {
            for (const hit of yield* Effect.orDie(findWord({ novelId, word, limit }))) {
              hits.set(`${hit.number}:${hit.paragraph}`, hit)
            }
          }

          return [...hits.values()]
            .toSorted((a, b) => a.number - b.number || a.paragraph - b.paragraph)
            .slice(0, limit)
        }),
        answers: (novelId, limit) =>
          Effect.map(Effect.orDie(latestAnswers({ novelId, limit })), (rows) =>
            rows.map((row) => row.answer),
          ),
        saveAnswer: Effect.fn('NovelInsightStore.saveAnswer')(function* (novelId, answer) {
          const row = {
            id: answer.id,
            novel_id: novelId,
            answer: yield* Effect.orDie(encodeAnswer(answer)),
            asked_at: answer.askedAt,
          }

          yield* Effect.orDie(sql`INSERT INTO novel_answers ${sql.insert(row)}`)
        }),
      })
    }),
  )
}
