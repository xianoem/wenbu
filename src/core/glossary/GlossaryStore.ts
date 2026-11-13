import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { type GlossaryTerm, TermGender, TermKind } from '#contract/Novels'
import type { TermSave } from '../novels/NovelStore'

const GlossaryRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  updated_at: Schema.String,
  terms: Schema.Int,
  novels: Schema.Int,
})

export type StoredGlossary = typeof GlossaryRow.Type

const TermRow = Schema.Struct({
  id: Schema.String,
  glossary_id: Schema.String,
  original: Schema.String,
  translation: Schema.String,
  kind: TermKind,
  gender: Schema.NullOr(TermGender),
  reading: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
})

const PickRow = Schema.Struct({ glossary_id: Schema.String })

const now = Effect.map(DateTime.now, DateTime.formatIso)

const toTerm = (row: typeof TermRow.Type, glossary: string): GlossaryTerm => ({
  id: row.id,
  original: row.original,
  translation: row.translation,
  kind: row.kind,
  gender: row.gender,
  note: row.note,
  reading: row.reading,
  suggested: false,
  glossary,
  chapters: [],
  origin: 'manual',
  count: 0,
})

export class GlossaryStore extends Context.Service<
  GlossaryStore,
  {
    readonly glossaries: Effect.Effect<ReadonlyArray<StoredGlossary>>
    readonly glossary: (id: string) => Effect.Effect<Option.Option<StoredGlossary>>
    readonly create: (id: string, name: string) => Effect.Effect<void>
    readonly rename: (id: string, name: string) => Effect.Effect<void>
    readonly remove: (id: string) => Effect.Effect<void>
    readonly terms: (glossaryId: string) => Effect.Effect<ReadonlyArray<GlossaryTerm>>
    readonly allTerms: Effect.Effect<
      ReadonlyArray<{ readonly glossaryId: string; readonly term: GlossaryTerm }>
    >
    readonly saveTerm: (glossaryId: string, id: string, term: TermSave) => Effect.Effect<void>
    readonly updateTerm: (glossaryId: string, id: string, term: TermSave) => Effect.Effect<void>
    readonly removeTerm: (glossaryId: string, id: string) => Effect.Effect<void>
    readonly picks: (novelId: string) => Effect.Effect<ReadonlyArray<string>>
    readonly setPicks: (novelId: string, glossaryIds: ReadonlyArray<string>) => Effect.Effect<void>
    readonly novelsUsing: (glossaryId: string) => Effect.Effect<ReadonlyArray<string>>
  }
>()('wenbu/core/glossary/GlossaryStore') {
  static readonly layer = Layer.effect(
    GlossaryStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const summaries = sql`
        SELECT g.id, g.name, g.updated_at,
          (SELECT COUNT(*) FROM glossary_terms t WHERE t.glossary_id = g.id) AS terms,
          (SELECT COUNT(*) FROM novel_glossaries n WHERE n.glossary_id = g.id) AS novels
        FROM glossaries g
      `

      const allGlossaries = SqlSchema.findAll({
        Request: Schema.Void,
        Result: GlossaryRow,
        execute: () => sql`SELECT * FROM (${summaries}) ORDER BY name COLLATE NOCASE`,
      })

      const findGlossary = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: GlossaryRow,
        execute: (id) => sql`SELECT * FROM (${summaries}) WHERE id = ${id}`,
      })

      const termsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: TermRow,
        execute: (glossaryId) =>
          sql`SELECT * FROM glossary_terms WHERE glossary_id = ${glossaryId} ORDER BY created_at`,
      })

      const everyTerm = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ ...TermRow.fields, glossary_name: Schema.String }),
        execute: () => sql`
          SELECT t.*, g.name AS glossary_name FROM glossary_terms t JOIN glossaries g ON g.id = t.glossary_id
        `,
      })

      const picksOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: PickRow,
        execute: (novelId) =>
          sql`SELECT glossary_id FROM novel_glossaries WHERE novel_id = ${novelId} ORDER BY position`,
      })

      const usersOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ novel_id: Schema.String }),
        execute: (glossaryId) =>
          sql`SELECT novel_id FROM novel_glossaries WHERE glossary_id = ${glossaryId}`,
      })

      const touch = (id: string) =>
        Effect.flatMap(now, (at) =>
          Effect.orDie(sql`UPDATE glossaries SET updated_at = ${at} WHERE id = ${id}`),
        )

      const nameOf = (glossaryId: string) =>
        Effect.map(Effect.orDie(findGlossary(glossaryId)), (found) =>
          Option.match(found, {
            onNone: () => 'General glossary',
            onSome: (glossary) => glossary.name,
          }),
        )

      return GlossaryStore.of({
        glossaries: Effect.orDie(allGlossaries()),
        glossary: (id) => Effect.orDie(findGlossary(id)),
        create: Effect.fn('GlossaryStore.create')(function* (id, name) {
          const at = yield* now

          yield* Effect.orDie(
            sql`INSERT INTO glossaries ${sql.insert({ id, name, created_at: at, updated_at: at })}`,
          )
        }),
        rename: (id, name) =>
          Effect.orDie(sql`UPDATE glossaries SET name = ${name} WHERE id = ${id}`).pipe(
            Effect.andThen(touch(id)),
          ),
        remove: (id) =>
          Effect.orDie(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`DELETE FROM glossary_terms WHERE glossary_id = ${id}`
                yield* sql`DELETE FROM novel_glossaries WHERE glossary_id = ${id}`
                yield* sql`DELETE FROM glossaries WHERE id = ${id}`
              }),
            ),
          ),
        terms: Effect.fn('GlossaryStore.terms')(function* (glossaryId) {
          const name = yield* nameOf(glossaryId)

          return (yield* Effect.orDie(termsOf(glossaryId))).map((row) => toTerm(row, name))
        }),
        allTerms: Effect.map(Effect.orDie(everyTerm()), (rows) =>
          rows.map((row) => ({
            glossaryId: row.glossary_id,
            term: toTerm(row, row.glossary_name),
          })),
        ),
        saveTerm: Effect.fn('GlossaryStore.saveTerm')(function* (glossaryId, id, term) {
          const row = {
            id,
            glossary_id: glossaryId,
            original: term.original,
            translation: term.translation,
            kind: term.kind,
            gender: term.gender,
            reading: term.reading ?? null,
            note: term.note,
            created_at: yield* now,
          }

          yield* Effect.orDie(sql`
            INSERT INTO glossary_terms ${sql.insert(row)}
            ON CONFLICT (glossary_id, original) DO UPDATE SET
              translation = excluded.translation, kind = excluded.kind, gender = excluded.gender,
              reading = COALESCE(excluded.reading, glossary_terms.reading), note = excluded.note
          `)

          yield* touch(glossaryId)
        }),
        updateTerm: Effect.fn('GlossaryStore.updateTerm')(function* (glossaryId, id, term) {
          const { reading, ...rest } = term

          yield* Effect.orDie(sql`
            UPDATE glossary_terms SET ${sql.update(reading === undefined ? rest : { ...rest, reading })}
            WHERE glossary_id = ${glossaryId} AND id = ${id}
          `)

          yield* touch(glossaryId)
        }),
        removeTerm: (glossaryId, id) =>
          Effect.orDie(
            sql`DELETE FROM glossary_terms WHERE glossary_id = ${glossaryId} AND id = ${id}`,
          ).pipe(Effect.andThen(touch(glossaryId))),
        picks: (novelId) =>
          Effect.map(Effect.orDie(picksOf(novelId)), (rows) => rows.map((row) => row.glossary_id)),
        setPicks: (novelId, glossaryIds) =>
          Effect.orDie(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`DELETE FROM novel_glossaries WHERE novel_id = ${novelId}`

                for (const [position, glossaryId] of glossaryIds.entries()) {
                  yield* sql`INSERT INTO novel_glossaries ${sql.insert({ novel_id: novelId, glossary_id: glossaryId, position })}`
                }
              }),
            ),
          ),
        novelsUsing: (glossaryId) =>
          Effect.map(Effect.orDie(usersOf(glossaryId)), (rows) => rows.map((row) => row.novel_id)),
      })
    }),
  )
}
