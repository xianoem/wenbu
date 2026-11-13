import { Context, DateTime, Effect, Layer, Predicate, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  LineChange,
  type LineCounts,
  type LineFilter,
  LineOrigin,
  type SourceChangeAction,
  type TranslationLine,
  WriteSkip,
} from '#contract/GameTranslation'
import { hasCjkOrKorean, type TextEntry } from '../rpgmaker/TextEntries'
import type { TextLocation } from '../rpgmaker/TextLocations'
import { type DiffCounts, type DiffedLine, diffSources } from './SourceDiff'

export type LineScope = 'missing' | 'changed'

export interface LineTranslation {
  readonly entryId: string
  readonly text: string
}

const Row = Schema.Struct({
  entry_id: Schema.String,
  file: Schema.String,
  pointer: Schema.String,
  context: Schema.String,
  source_text: Schema.String,
  translated_text: Schema.NullOr(Schema.String),
  origin: LineOrigin,
  locked: Schema.Int,
  applied: Schema.Int,
  change: Schema.NullOr(LineChange),
  previous_source: Schema.NullOr(Schema.String),
  previous_text: Schema.NullOr(Schema.String),
  write_skipped: Schema.NullOr(WriteSkip),
})

const toLine = (row: typeof Row.Type): TranslationLine => ({
  entryId: row.entry_id,
  file: row.file,
  pointer: row.pointer,
  context: row.context,
  sourceText: row.source_text,
  ...(row.translated_text === null ? {} : { translatedText: row.translated_text }),
  origin: row.origin,
  locked: row.locked !== 0,
  applied: row.applied !== 0,
  ...(row.write_skipped === null ? {} : { writeSkipped: row.write_skipped }),
  ...(row.change === null ? {} : { change: row.change }),
  ...(row.previous_source === null ? {} : { previousSource: row.previous_source }),
  ...(row.previous_text === null ? {} : { previousText: row.previous_text }),
})

// Stays under SQLite's limit on bound parameters.
const chunkSize = 500

const chunksOf = <A>(items: ReadonlyArray<A>) =>
  Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, index) =>
    items.slice(index * chunkSize, (index + 1) * chunkSize),
  )

const now = Effect.map(DateTime.now, (time) => DateTime.formatIso(time))

const columns =
  'entry_id, file, pointer, context, source_text, translated_text, origin, locked, applied, change, previous_source, previous_text, write_skipped'

const filterClauses: Record<LineFilter, string> = {
  all: '',
  review: "AND locked = 1 AND change = 'changed'",
  missing: 'AND translated_text IS NULL',
  skipped: 'AND write_skipped IS NOT NULL',
  'too-long': '',
  edited: "AND origin <> 'model'",
  locked: 'AND locked = 1',
}

const termsOf = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    .filter((term) => term !== '')

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (character) => `\\${character}`)

export const appliedTranslations = (
  entries: ReadonlyArray<TextEntry>,
  current: ReadonlyArray<TextLocation>,
): ReadonlyArray<LineTranslation> => {
  const values = new Map(
    current.map((location) => [`${location.file}::${location.pointer}`, location.value]),
  )

  return entries.flatMap((entry) => {
    const found = values.get(entry.id)

    if (!Predicate.isString(found)) {
      return []
    }

    const text = found.replace(/\n+$/, '')

    const kept = text === entry.src && !hasCjkOrKorean(entry.src)

    return text === '' || (text === entry.src && !kept) ? [] : [{ entryId: entry.id, text }]
  })
}

export class TranslationLines extends Context.Service<
  TranslationLines,
  {
    readonly lines: (gameId: string) => Effect.Effect<ReadonlyArray<TranslationLine>>
    readonly list: (
      gameId: string,
      filter: LineFilter,
      query: string,
      limit: number,
    ) => Effect.Effect<{ readonly lines: ReadonlyArray<TranslationLine>; readonly total: number }>
    readonly counts: (gameId: string) => Effect.Effect<Omit<LineCounts, 'tooLong'>>
    readonly line: (gameId: string, entryId: string) => Effect.Effect<TranslationLine | undefined>
    readonly before: (gameId: string, entryId: string) => Effect.Effect<TranslationLine | undefined>
    readonly sameSource: (
      gameId: string,
      entryId: string,
    ) => Effect.Effect<ReadonlyArray<TranslationLine>>
    readonly saveModelTranslation: (
      gameId: string,
      entryId: string,
      text: string,
    ) => Effect.Effect<void>
    readonly hasLines: (gameId: string) => Effect.Effect<boolean>
    readonly reconcile: (
      gameId: string,
      entries: ReadonlyArray<TextEntry>,
    ) => Effect.Effect<DiffCounts & { readonly removedLines: ReadonlyArray<TranslationLine> }>
    readonly changedLines: (gameId: string) => Effect.Effect<ReadonlyArray<TranslationLine>>
    readonly setChangeAction: (
      gameId: string,
      entryId: string,
      action: SourceChangeAction,
    ) => Effect.Effect<void>
    readonly saveTranslations: (
      gameId: string,
      translations: ReadonlyArray<LineTranslation>,
    ) => Effect.Effect<void>
    readonly pending: (gameId: string, scope: LineScope) => Effect.Effect<ReadonlySet<string>>
    readonly translations: (gameId: string) => Effect.Effect<ReadonlyMap<string, string>>
    readonly markApplied: (gameId: string, entryIds: ReadonlyArray<string>) => Effect.Effect<void>
    readonly markSkipped: (
      gameId: string,
      skipped: ReadonlyMap<string, WriteSkip>,
    ) => Effect.Effect<void>
    readonly edit: (gameId: string, entryId: string, text: string) => Effect.Effect<void>
    readonly setLocked: (gameId: string, entryId: string, locked: boolean) => Effect.Effect<void>
    readonly remove: (gameId: string) => Effect.Effect<void>
    readonly clearChanges: (gameId: string) => Effect.Effect<void>
  }
>()('wenbu/core/translation/TranslationLines') {
  static readonly layer = Layer.effect(
    TranslationLines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const findLines = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (gameId) => sql`
          SELECT ${sql.unsafe(columns)}
          FROM translation_lines WHERE game_id = ${gameId}
          ORDER BY file, rowid
        `,
      })

      const lines = (gameId: string) =>
        findLines(gameId).pipe(
          Effect.map((rows) => rows.map(toLine)),
          Effect.orDie,
        )

      const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))

      const rowsOf = <E>(query: Effect.Effect<ReadonlyArray<object>, E>) =>
        query.pipe(
          Effect.flatMap((rows) => decodeRows(rows)),
          Effect.map((rows) => rows.map(toLine)),
          Effect.orDie,
        )

      const matching = (gameId: string, filter: LineFilter, query: string) => {
        const terms = termsOf(query).map((term) => `%${escapeLike(term)}%`)

        const search =
          terms.length === 0
            ? sql``
            : sql`AND ${sql.and(
                terms.map(
                  (pattern) => sql`(
                    source_text LIKE ${pattern} ESCAPE '\\'
                    OR translated_text LIKE ${pattern} ESCAPE '\\'
                    OR file LIKE ${pattern} ESCAPE '\\'
                    OR context LIKE ${pattern} ESCAPE '\\'
                  )`,
                ),
              )}`

        return sql`
          FROM translation_lines
          WHERE game_id = ${gameId}
          ${sql.unsafe(filterClauses[filter])}
          ${search}
        `
      }

      const list = Effect.fn('TranslationLines.list')(function* (
        gameId: string,
        filter: LineFilter,
        query: string,
        limit: number,
      ) {
        const where = matching(gameId, filter, query)

        const page = yield* rowsOf(
          sql`SELECT ${sql.unsafe(columns)} ${where} ORDER BY file, rowid LIMIT ${limit}`,
        )

        const [total] = yield* Effect.orDie(
          sql<{ readonly total: number }>`SELECT COUNT(*) AS total ${where}`,
        )

        return { lines: page, total: total?.total ?? 0 }
      })

      const counts = (gameId: string) =>
        sql<Omit<LineCounts, 'tooLong'>>`
          SELECT
            COUNT(*) AS "all",
            COALESCE(SUM(locked = 1 AND change = 'changed'), 0) AS review,
            COALESCE(SUM(translated_text IS NULL), 0) AS missing,
            COALESCE(SUM(change IS NOT NULL AND translated_text IS NULL), 0) AS pending,
            COALESCE(SUM(write_skipped IS NOT NULL), 0) AS skipped,
            COALESCE(SUM(origin <> 'model'), 0) AS edited,
            COALESCE(SUM(locked = 1), 0) AS locked,
            COALESCE(SUM(translated_text IS NOT NULL AND applied = 0 AND write_skipped IS NULL), 0)
              AS unapplied
          FROM translation_lines WHERE game_id = ${gameId}
        `.pipe(
          Effect.map(
            ([row]) =>
              row ?? {
                all: 0,
                review: 0,
                missing: 0,
                pending: 0,
                skipped: 0,
                edited: 0,
                locked: 0,
                unapplied: 0,
              },
          ),
          Effect.orDie,
        )

      const line = (gameId: string, entryId: string) =>
        rowsOf(
          sql`SELECT ${sql.unsafe(columns)} FROM translation_lines WHERE game_id = ${gameId} AND entry_id = ${entryId}`,
        ).pipe(Effect.map((rows) => rows[0]))

      const before = (gameId: string, entryId: string) =>
        rowsOf(sql`
          SELECT ${sql.unsafe(columns)} FROM translation_lines AS other
          WHERE other.game_id = ${gameId}
            AND other.file = (SELECT file FROM translation_lines WHERE game_id = ${gameId} AND entry_id = ${entryId})
            AND other.rowid < (SELECT rowid FROM translation_lines WHERE game_id = ${gameId} AND entry_id = ${entryId})
          ORDER BY other.rowid DESC LIMIT 1
        `).pipe(Effect.map((rows) => rows[0]))

      const sameSource = (gameId: string, entryId: string) =>
        rowsOf(sql`
          SELECT ${sql.unsafe(columns)} FROM translation_lines
          WHERE game_id = ${gameId} AND entry_id <> ${entryId}
            AND source_text = (SELECT source_text FROM translation_lines WHERE game_id = ${gameId} AND entry_id = ${entryId})
          ORDER BY file, rowid
        `)

      const saveModelTranslation = Effect.fn('TranslationLines.saveModelTranslation')(function* (
        gameId: string,
        entryId: string,
        text: string,
      ) {
        const time = yield* now

        yield* sql`
          UPDATE translation_lines
          SET translated_text = ${text}, origin = 'model', applied = 0, write_skipped = NULL,
            updated_at = ${time}
          WHERE game_id = ${gameId} AND entry_id = ${entryId} AND locked = 0
        `
      }, Effect.orDie)

      const hasLines = (gameId: string) =>
        sql<{ readonly found: number }>`
          SELECT EXISTS (SELECT 1 FROM translation_lines WHERE game_id = ${gameId}) AS found
        `.pipe(
          Effect.map((rows) => rows[0]?.found === 1),
          Effect.orDie,
        )

      const reconcile = Effect.fn('TranslationLines.reconcile')(function* (
        gameId: string,
        entries: ReadonlyArray<TextEntry>,
      ) {
        const time = yield* now
        const stored = yield* lines(gameId)
        const diff = diffSources(stored, entries)
        const first = stored.length === 0

        const updated = diff.counts.changed > 0 || diff.counts.added > 0 || diff.counts.removed > 0

        const marksOf = (line: DiffedLine) => {
          if (first) {
            return { change: null, previous_source: null, previous_text: null }
          }

          const marked = updated ? line : (line.from ?? line)

          return {
            change: marked.change ?? null,
            previous_source: marked.previousSource ?? null,
            previous_text: marked.previousText ?? null,
          }
        }

        const rows = diff.lines.map((line) => ({
          game_id: gameId,
          entry_id: line.entry.id,
          file: line.entry.file,
          pointer: line.entry.pointer,
          context: line.entry.context,
          source_text: line.entry.src,
          translated_text: line.translatedText ?? null,
          origin: line.origin,
          locked: line.locked ? 1 : 0,
          applied: line.applied ? 1 : 0,
          write_skipped: line.from?.writeSkipped ?? null,
          ...marksOf(line),
          updated_at: time,
        }))

        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM translation_lines WHERE game_id = ${gameId}`

            for (const chunk of chunksOf(rows)) {
              yield* sql`INSERT INTO translation_lines ${sql.insert(chunk)}`
            }
          }),
        )

        return { ...diff.counts, removedLines: diff.removed }
      }, Effect.orDie)

      const saveTranslations = Effect.fn('TranslationLines.saveTranslations')(function* (
        gameId: string,
        translations: ReadonlyArray<LineTranslation>,
      ) {
        const time = yield* now

        yield* sql.withTransaction(
          Effect.forEach(
            translations,
            (translation) => sql`
              UPDATE translation_lines
              SET translated_text = ${translation.text}, applied = 0, write_skipped = NULL,
                updated_at = ${time}
              WHERE game_id = ${gameId} AND entry_id = ${translation.entryId}
                AND origin = 'model' AND locked = 0
            `,
            { discard: true },
          ),
        )
      }, Effect.orDie)

      const pending = (gameId: string, scope: LineScope) =>
        sql<{ readonly entry_id: string }>`
          SELECT entry_id FROM translation_lines
          WHERE game_id = ${gameId} AND translated_text IS NULL
            ${sql.unsafe(scope === 'changed' ? 'AND change IS NOT NULL' : '')}
          ORDER BY file, rowid
        `.pipe(
          Effect.map((rows) => new Set(rows.map((row) => row.entry_id))),
          Effect.orDie,
        )

      const translations = (gameId: string) =>
        sql<{ readonly entry_id: string; readonly translated_text: string }>`
          SELECT entry_id, translated_text FROM translation_lines
          WHERE game_id = ${gameId} AND translated_text IS NOT NULL
        `.pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.entry_id, row.translated_text]))),
          Effect.orDie,
        )

      const markApplied = (gameId: string, entryIds: ReadonlyArray<string>) =>
        sql
          .withTransaction(
            Effect.forEach(
              chunksOf(entryIds),
              (chunk) => sql`
                UPDATE translation_lines SET applied = 1, write_skipped = NULL
                WHERE game_id = ${gameId} AND translated_text IS NOT NULL AND ${sql.in('entry_id', chunk)}
              `,
              { discard: true },
            ),
          )
          .pipe(Effect.orDie)

      const edit = Effect.fn('TranslationLines.edit')(function* (
        gameId: string,
        entryId: string,
        text: string,
      ) {
        const time = yield* now

        yield* sql`
          UPDATE translation_lines
          SET translated_text = ${text}, origin = 'edited', applied = 0, write_skipped = NULL,
            updated_at = ${time}
          WHERE game_id = ${gameId} AND entry_id = ${entryId}
        `
      }, Effect.orDie)

      const setLocked = (gameId: string, entryId: string, locked: boolean) =>
        Effect.orDie(
          sql`
            UPDATE translation_lines SET locked = ${locked ? 1 : 0}
            WHERE game_id = ${gameId} AND entry_id = ${entryId}
          `,
        )

      const markSkipped = (gameId: string, skipped: ReadonlyMap<string, WriteSkip>) =>
        sql
          .withTransaction(
            Effect.forEach(
              skipped,
              ([entryId, reason]) => sql`
                UPDATE translation_lines SET applied = 0, write_skipped = ${reason}
                WHERE game_id = ${gameId} AND entry_id = ${entryId}
              `,
              { discard: true },
            ),
          )
          .pipe(Effect.orDie)

      const changedLines = (gameId: string) =>
        rowsOf(sql`
          SELECT ${sql.unsafe(columns)} FROM translation_lines
          WHERE game_id = ${gameId} AND change IS NOT NULL
          ORDER BY file, rowid
        `)

      // SQLite reads the old row in every SET expression.
      const setChangeAction = (gameId: string, entryId: string, action: SourceChangeAction) =>
        Effect.orDie(
          action === 'keep'
            ? sql`
                UPDATE translation_lines SET
                  translated_text = COALESCE(translated_text, previous_text),
                  applied = CASE WHEN translated_text IS NULL THEN 0 ELSE applied END,
                  change = NULL
                WHERE game_id = ${gameId} AND entry_id = ${entryId}
              `
            : sql`
                UPDATE translation_lines SET
                  previous_text = COALESCE(previous_text, translated_text),
                  translated_text = NULL,
                  origin = 'model',
                  locked = 0,
                  applied = 0,
                  write_skipped = NULL,
                  change = COALESCE(change, 'changed')
                WHERE game_id = ${gameId} AND entry_id = ${entryId}
              `,
        )

      const clearChanges = (gameId: string) =>
        Effect.orDie(
          sql`
            UPDATE translation_lines
            SET change = NULL, previous_source = NULL, previous_text = NULL
            WHERE game_id = ${gameId}
          `,
        )

      const remove = (gameId: string) =>
        Effect.orDie(sql`DELETE FROM translation_lines WHERE game_id = ${gameId}`)

      return TranslationLines.of({
        lines,
        list,
        counts,
        line,
        before,
        sameSource,
        saveModelTranslation,
        hasLines,
        reconcile,
        saveTranslations,
        pending,
        translations,
        markApplied,
        markSkipped,
        changedLines,
        setChangeAction,
        clearChanges,
        edit,
        setLocked,
        remove,
      })
    }),
  )
}
