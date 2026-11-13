import { Context, DateTime, Effect, Layer, type Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  type GlossaryTerm,
  NovelLanguage,
  SiteEntry,
  TermGender,
  TermKind,
  TermOrigin,
} from '#contract/Novels'

const Strings = Schema.fromJsonString(Schema.Array(Schema.String))

const Numbers = Schema.fromJsonString(Schema.Array(Schema.Int))

const SiteJson = Schema.fromJsonString(SiteEntry)

const Status = Schema.NullOr(Schema.Literals(['ongoing', 'finished']))

const NovelRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  title_translated: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  cover_url: Schema.NullOr(Schema.String),
  synopsis: Schema.NullOr(Schema.String),
  synopsis_translated: Schema.NullOr(Schema.String),
  tags: Strings,
  status: Status,
  language: NovelLanguage,
  site: Schema.NullOr(Schema.String),
  book_url: Schema.NullOr(Schema.String),
  added_at: Schema.String,
  updated_at: Schema.String,
  checked_at: Schema.NullOr(Schema.String),
})

export type StoredNovel = typeof NovelRow.Type

const ChapterRow = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  title_translated: Schema.NullOr(Schema.String),
  origin: Schema.Literals(['site', 'manual']),
  site: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  extra: Schema.BooleanFromBit,
  is_new: Schema.BooleanFromBit,
  locked: Schema.BooleanFromBit,
  text_site: Schema.NullOr(Schema.String),
  text_url: Schema.NullOr(Schema.String),
  released_at: Schema.NullOr(Schema.String),
  has_text: Schema.BooleanFromBit,
  translated: Schema.BooleanFromBit,
})

export type StoredChapter = typeof ChapterRow.Type

const TextRow = Schema.Struct({
  paragraphs: Strings,
  note: Schema.NullOr(Schema.String),
})

const TranslationRow = Schema.Struct({
  preset_id: Schema.String,
  glossary_key: Schema.String,
  paragraphs: Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String))),
  title: Schema.NullOr(Schema.String),
  cost_usd: Schema.NullOr(Schema.Number),
})

export type StoredTranslation = typeof TranslationRow.Type

const ReadingRow = Schema.Struct({
  novel_id: Schema.String,
  chapter: Schema.Int,
  paragraph: Schema.Int,
  read_at: Schema.String,
})

const TermRow = Schema.Struct({
  id: Schema.String,
  original: Schema.String,
  translation: Schema.String,
  kind: TermKind,
  gender: Schema.NullOr(TermGender),
  note: Schema.NullOr(Schema.String),
  suggested: Schema.BooleanFromBit,
  chapters: Numbers,
  origin: TermOrigin,
  count: Schema.Int,
  reading: Schema.NullOr(Schema.String),
})

const CountRow = Schema.Struct({
  novel_id: Schema.String,
  chapters: Schema.Int,
  new_chapters: Schema.Int,
  translated: Schema.Int,
  terms: Schema.Int,
  suggested: Schema.Int,
  spent: Schema.Number,
})

export type NovelCounts = typeof CountRow.Type

const SiteRow = Schema.Struct({ entry: SiteJson })

export interface NovelInsert {
  readonly id: string
  readonly title: string
  readonly author: string | null
  readonly coverUrl: string | null
  readonly synopsis: string | null
  readonly tags: ReadonlyArray<string>
  readonly status: 'ongoing' | 'finished' | null
  readonly language: NovelLanguage
  readonly site: string | null
  readonly bookUrl: string | null
}

export interface ChapterListing {
  readonly title: string
  readonly url: string | null
  readonly site: string | null
  readonly extra: boolean
  readonly locked: boolean
  readonly releasedAt: string | null
}

const TextSourceRow = Schema.Struct({
  site: Schema.String,
  book_url: Schema.String,
  checked_at: Schema.NullOr(Schema.String),
})

export type StoredTextSource = typeof TextSourceRow.Type

export interface ChapterText {
  readonly paragraphs: ReadonlyArray<string>
  readonly note: string | null
}

export interface TranslationSave {
  readonly presetId: string
  readonly glossaryKey: string
  readonly paragraphs: ReadonlyArray<string | null>
  readonly title: string | null
  readonly costUsd: number | null
}

export interface TermSuggestion {
  readonly origin: 'translation' | 'scan'
  readonly chapters: ReadonlyArray<number>
  readonly count: number
}

export interface TermSave {
  readonly original: string
  readonly translation: string
  readonly kind: TermKind
  readonly gender: 'm' | 'f' | null
  readonly note: string | null
  readonly reading?: string | null | undefined
}

const termColumns = (term: TermSave) => {
  const { reading, ...rest } = term

  return reading === undefined ? rest : { ...rest, reading }
}

const encodeStrings = Schema.encodeEffect(Strings)

const encodeNumbers = Schema.encodeEffect(Numbers)

const encodeSite = Schema.encodeEffect(SiteJson)

const encodeParagraphs = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String))),
)

const now = Effect.map(DateTime.now, DateTime.formatIso)

const toTerm = (row: typeof TermRow.Type): GlossaryTerm => ({
  ...row,
  glossary: 'Novel glossary',
})

export class NovelStore extends Context.Service<
  NovelStore,
  {
    readonly novels: Effect.Effect<ReadonlyArray<StoredNovel>>
    readonly novel: (id: string) => Effect.Effect<Option.Option<StoredNovel>>
    readonly insertNovel: (novel: NovelInsert) => Effect.Effect<void>
    readonly updateNovel: (
      id: string,
      fields: Partial<{
        readonly title_translated: string
        readonly synopsis_translated: string
        readonly checked_at: string
        readonly updated_at: string
      }>,
    ) => Effect.Effect<void>
    readonly removeNovel: (id: string) => Effect.Effect<void>
    readonly counts: Effect.Effect<ReadonlyArray<NovelCounts>>
    readonly chapters: (novelId: string) => Effect.Effect<ReadonlyArray<StoredChapter>>
    readonly chapter: (
      novelId: string,
      number: number,
    ) => Effect.Effect<Option.Option<StoredChapter>>
    readonly mergeChapters: (
      novelId: string,
      listing: ReadonlyArray<ChapterListing>,
      markNew: boolean,
    ) => Effect.Effect<ReadonlyArray<number>>
    readonly putManualChapter: (
      novelId: string,
      number: number,
      title: string,
      text: ChapterText,
    ) => Effect.Effect<void>
    readonly text: (novelId: string, number: number) => Effect.Effect<Option.Option<ChapterText>>
    readonly saveText: (novelId: string, number: number, text: ChapterText) => Effect.Effect<void>
    readonly translation: (
      novelId: string,
      number: number,
      targetLanguage: string,
    ) => Effect.Effect<Option.Option<StoredTranslation>>
    readonly saveTranslation: (
      novelId: string,
      number: number,
      targetLanguage: string,
      translation: TranslationSave,
    ) => Effect.Effect<void>
    readonly forgetTranslation: (
      novelId: string,
      numbers: ReadonlyArray<number>,
    ) => Effect.Effect<void>
    readonly readings: Effect.Effect<ReadonlyArray<typeof ReadingRow.Type>>
    readonly saveReading: (
      novelId: string,
      chapter: number,
      paragraph: number,
    ) => Effect.Effect<void>
    readonly terms: (novelId: string) => Effect.Effect<ReadonlyArray<GlossaryTerm>>
    readonly saveTerm: (
      novelId: string,
      id: string,
      term: TermSave,
      suggested: TermSuggestion | null,
    ) => Effect.Effect<void>
    readonly updateTerm: (novelId: string, id: string, term: TermSave) => Effect.Effect<void>
    readonly acceptTerms: (novelId: string, ids: ReadonlyArray<string>) => Effect.Effect<void>
    readonly removeTerm: (novelId: string, id: string) => Effect.Effect<void>
    readonly novelByUrl: (bookUrl: string) => Effect.Effect<Option.Option<StoredNovel>>
    readonly chaptersContaining: (
      novelId: string,
      text: string,
    ) => Effect.Effect<ReadonlyArray<number>>
    readonly renameInTranslations: (
      novelId: string,
      from: string,
      to: string,
    ) => Effect.Effect<ReadonlyArray<number>>
    readonly textSources: (novelId: string) => Effect.Effect<ReadonlyArray<StoredTextSource>>
    readonly saveTextSource: (novelId: string, site: string, bookUrl: string) => Effect.Effect<void>
    readonly setTextUrls: (
      novelId: string,
      site: string,
      urls: ReadonlyMap<number, string>,
    ) => Effect.Effect<number>
    readonly sites: Effect.Effect<ReadonlyArray<SiteEntry>>
    readonly saveSite: (entry: SiteEntry) => Effect.Effect<void>
    readonly removeSite: (id: string) => Effect.Effect<void>
  }
>()('wenbu/core/novels/NovelStore') {
  static readonly layer = Layer.effect(
    NovelStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const allNovels = SqlSchema.findAll({
        Request: Schema.Void,
        Result: NovelRow,
        execute: () => sql`SELECT * FROM novels ORDER BY updated_at DESC`,
      })

      const findNovel = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: NovelRow,
        execute: (id) => sql`SELECT * FROM novels WHERE id = ${id}`,
      })

      const allCounts = SqlSchema.findAll({
        Request: Schema.Void,
        Result: CountRow,
        execute: () => sql`
          SELECT
            n.id AS novel_id,
            (SELECT COUNT(*) FROM novel_chapters c WHERE c.novel_id = n.id AND c.extra = 0) AS chapters,
            (SELECT COUNT(*) FROM novel_chapters c WHERE c.novel_id = n.id AND c.is_new = 1) AS new_chapters,
            (SELECT COUNT(*) FROM novel_chapter_translations t WHERE t.novel_id = n.id) AS translated,
            (SELECT COUNT(*) FROM novel_terms g WHERE g.novel_id = n.id AND g.suggested = 0) AS terms,
            (SELECT COUNT(*) FROM novel_terms g WHERE g.novel_id = n.id AND g.suggested = 1) AS suggested,
            (SELECT COALESCE(SUM(cost_usd), 0) FROM novel_chapter_translations t WHERE t.novel_id = n.id) AS spent
          FROM novels n
        `,
      })

      const chapterColumns = sql`
        c.number, c.title, c.title_translated, c.origin, c.site, c.url, c.extra, c.is_new, c.released_at,
        c.locked, c.text_site, c.text_url,
        EXISTS (SELECT 1 FROM novel_chapter_texts x WHERE x.novel_id = c.novel_id AND x.number = c.number) AS has_text,
        EXISTS (SELECT 1 FROM novel_chapter_translations t WHERE t.novel_id = c.novel_id AND t.number = c.number) AS translated
      `

      const allChapters = SqlSchema.findAll({
        Request: Schema.String,
        Result: ChapterRow,
        execute: (novelId) =>
          sql`SELECT ${chapterColumns} FROM novel_chapters c WHERE c.novel_id = ${novelId} ORDER BY c.number`,
      })

      const findChapter = SqlSchema.findOneOption({
        Request: Schema.Struct({ novelId: Schema.String, number: Schema.Int }),
        Result: ChapterRow,
        execute: ({ novelId, number }) =>
          sql`SELECT ${chapterColumns} FROM novel_chapters c WHERE c.novel_id = ${novelId} AND c.number = ${number}`,
      })

      const findText = SqlSchema.findOneOption({
        Request: Schema.Struct({ novelId: Schema.String, number: Schema.Int }),
        Result: TextRow,
        execute: ({ novelId, number }) =>
          sql`SELECT paragraphs, note FROM novel_chapter_texts WHERE novel_id = ${novelId} AND number = ${number}`,
      })

      const findTranslation = SqlSchema.findOneOption({
        Request: Schema.Struct({
          novelId: Schema.String,
          number: Schema.Int,
          language: Schema.String,
        }),
        Result: TranslationRow,
        execute: ({ novelId, number, language }) => sql`
          SELECT preset_id, glossary_key, paragraphs, title, cost_usd FROM novel_chapter_translations
          WHERE novel_id = ${novelId} AND number = ${number} AND target_language = ${language}
        `,
      })

      const allReadings = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ReadingRow,
        execute: () => sql`SELECT * FROM novel_reading`,
      })

      const allTerms = SqlSchema.findAll({
        Request: Schema.String,
        Result: TermRow,
        execute: (novelId) => sql`
          SELECT id, original, translation, kind, gender, note, suggested, chapters, origin, count, reading FROM novel_terms
          WHERE novel_id = ${novelId} ORDER BY suggested DESC, created_at
        `,
      })

      const findByUrl = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: NovelRow,
        execute: (bookUrl) => sql`SELECT * FROM novels WHERE book_url = ${bookUrl}`,
      })

      const containing = SqlSchema.findAll({
        Request: Schema.Struct({ novelId: Schema.String, text: Schema.String }),
        Result: Schema.Struct({ number: Schema.Int }),
        execute: ({ novelId, text }) => sql`
          SELECT number FROM novel_chapter_texts
          WHERE novel_id = ${novelId} AND instr(paragraphs, ${text}) > 0 ORDER BY number
        `,
      })

      const withText = SqlSchema.findAll({
        Request: Schema.Struct({ novelId: Schema.String, text: Schema.String }),
        Result: Schema.Struct({
          number: Schema.Int,
          target_language: Schema.String,
          paragraphs: Schema.String,
        }),
        execute: ({ novelId, text }) => sql`
          SELECT number, target_language, paragraphs FROM novel_chapter_translations
          WHERE novel_id = ${novelId} AND instr(paragraphs, ${text}) > 0
        `,
      })

      const allTextSources = SqlSchema.findAll({
        Request: Schema.String,
        Result: TextSourceRow,
        execute: (novelId) =>
          sql`SELECT site, book_url, checked_at FROM novel_text_sources WHERE novel_id = ${novelId} ORDER BY site`,
      })

      const allSites = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SiteRow,
        execute: () => sql`SELECT entry FROM novel_sites ORDER BY id`,
      })

      const saveText = Effect.fn('NovelStore.saveText')(function* (
        novelId: string,
        number: number,
        text: ChapterText,
      ) {
        const row = {
          novel_id: novelId,
          number,
          paragraphs: yield* Effect.orDie(encodeStrings(text.paragraphs)),
          note: text.note,
          fetched_at: yield* now,
        }

        yield* Effect.orDie(sql`
          INSERT INTO novel_chapter_texts ${sql.insert(row)}
          ON CONFLICT (novel_id, number) DO UPDATE SET
            paragraphs = excluded.paragraphs, note = excluded.note, fetched_at = excluded.fetched_at
        `)

        yield* Effect.orDie(
          sql`DELETE FROM novel_chapter_translations WHERE novel_id = ${novelId} AND number = ${number}`,
        )

        yield* Effect.orDie(
          sql`DELETE FROM novel_text_index WHERE novel_id = ${novelId} AND number = ${number}`,
        )

        for (const [paragraph, body] of text.paragraphs.entries()) {
          yield* Effect.orDie(
            sql`INSERT INTO novel_text_index ${sql.insert({ novel_id: novelId, number, paragraph, body })}`,
          )
        }
      })

      return NovelStore.of({
        novels: Effect.orDie(allNovels()),
        novel: (id) => Effect.orDie(findNovel(id)),
        insertNovel: Effect.fn('NovelStore.insertNovel')(function* (novel) {
          const at = yield* now

          yield* Effect.orDie(sql`
            INSERT INTO novels ${sql.insert({
              id: novel.id,
              title: novel.title,
              author: novel.author,
              cover_url: novel.coverUrl,
              synopsis: novel.synopsis,
              tags: yield* Effect.orDie(encodeStrings(novel.tags)),
              status: novel.status,
              language: novel.language,
              site: novel.site,
              book_url: novel.bookUrl,
              added_at: at,
              updated_at: at,
            })}
          `)
        }),
        updateNovel: (id, fields) =>
          Object.keys(fields).length === 0
            ? Effect.void
            : Effect.orDie(sql`UPDATE novels SET ${sql.update(fields)} WHERE id = ${id}`),
        removeNovel: (id) =>
          Effect.orDie(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`DELETE FROM novel_chapter_translations WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_chapter_texts WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_chapters WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_reading WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_terms WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_text_sources WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_text_index WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_digests WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novel_answers WHERE novel_id = ${id}`
                yield* sql`DELETE FROM novels WHERE id = ${id}`
              }),
            ),
          ),
        counts: Effect.orDie(allCounts()),
        chapters: (novelId) => Effect.orDie(allChapters(novelId)),
        chapter: (novelId, number) => Effect.orDie(findChapter({ novelId, number })),
        mergeChapters: Effect.fn('NovelStore.mergeChapters')(function* (novelId, listing, markNew) {
          const existing = yield* Effect.orDie(allChapters(novelId))

          const knownUrls = new Set(
            existing.flatMap((chapter) => (chapter.url === null ? [] : [chapter.url])),
          )

          const knownTitles = new Set(existing.map((chapter) => chapter.title))
          let number = existing.reduce((last, chapter) => Math.max(last, chapter.number), 0)
          const added: Array<number> = []
          const releasedAt = yield* now

          for (const chapter of listing) {
            const known =
              chapter.url === null ? knownTitles.has(chapter.title) : knownUrls.has(chapter.url)

            if (known) {
              continue
            }

            number += 1
            knownTitles.add(chapter.title)

            if (chapter.url !== null) {
              knownUrls.add(chapter.url)
            }

            added.push(number)

            yield* Effect.orDie(sql`
              INSERT INTO novel_chapters ${sql.insert({
                novel_id: novelId,
                number,
                title: chapter.title,
                origin: 'site',
                site: chapter.site,
                url: chapter.url,
                extra: chapter.extra ? 1 : 0,
                is_new: markNew && !chapter.extra ? 1 : 0,
                locked: chapter.locked ? 1 : 0,
                released_at: chapter.releasedAt ?? (markNew ? releasedAt : null),
              })}
            `)
          }

          if (added.length > 0) {
            yield* Effect.orDie(
              sql`UPDATE novels SET updated_at = ${releasedAt} WHERE id = ${novelId}`,
            )
          }

          return added
        }),
        putManualChapter: Effect.fn('NovelStore.putManualChapter')(
          function* (novelId, number, title, text) {
            const at = yield* now

            yield* Effect.orDie(sql`
            INSERT INTO novel_chapters ${sql.insert({
              novel_id: novelId,
              number,
              title,
              origin: 'manual',
              released_at: at,
            })}
            ON CONFLICT (novel_id, number) DO UPDATE SET origin = 'manual', title = excluded.title
          `)

            yield* saveText(novelId, number, text)
            yield* Effect.orDie(sql`UPDATE novels SET updated_at = ${at} WHERE id = ${novelId}`)
          },
        ),
        text: (novelId, number) => Effect.orDie(findText({ novelId, number })),
        saveText,
        translation: (novelId, number, language) =>
          Effect.orDie(findTranslation({ novelId, number, language })),
        saveTranslation: Effect.fn('NovelStore.saveTranslation')(
          function* (novelId, number, language, translation) {
            const row = {
              novel_id: novelId,
              number,
              target_language: language,
              preset_id: translation.presetId,
              glossary_key: translation.glossaryKey,
              paragraphs: yield* Effect.orDie(encodeParagraphs(translation.paragraphs)),
              title: translation.title,
              cost_usd: translation.costUsd,
              created_at: yield* now,
            }

            yield* Effect.orDie(sql`
            INSERT INTO novel_chapter_translations ${sql.insert(row)}
            ON CONFLICT (novel_id, number, target_language) DO UPDATE SET
              preset_id = excluded.preset_id, glossary_key = excluded.glossary_key,
              paragraphs = excluded.paragraphs, title = excluded.title,
              cost_usd = COALESCE(novel_chapter_translations.cost_usd, 0) + COALESCE(excluded.cost_usd, 0),
              created_at = excluded.created_at
          `)

            if (translation.title !== null) {
              yield* Effect.orDie(sql`
              UPDATE novel_chapters SET title_translated = ${translation.title}
              WHERE novel_id = ${novelId} AND number = ${number}
            `)
            }
          },
        ),
        forgetTranslation: (novelId, numbers) =>
          numbers.length === 0
            ? Effect.void
            : Effect.orDie(sql`
                DELETE FROM novel_chapter_translations
                WHERE novel_id = ${novelId} AND ${sql.in('number', numbers)}
              `),
        readings: Effect.orDie(allReadings()),
        saveReading: Effect.fn('NovelStore.saveReading')(function* (novelId, chapter, paragraph) {
          const row = { novel_id: novelId, chapter, paragraph, read_at: yield* now }

          yield* Effect.orDie(sql`
            INSERT INTO novel_reading ${sql.insert(row)}
            ON CONFLICT (novel_id) DO UPDATE SET
              chapter = excluded.chapter, paragraph = excluded.paragraph, read_at = excluded.read_at
          `)

          yield* Effect.orDie(sql`
            UPDATE novel_chapters SET is_new = 0 WHERE novel_id = ${novelId} AND number <= ${chapter}
          `)
        }),
        terms: (novelId) =>
          Effect.orDie(allTerms(novelId)).pipe(Effect.map((rows) => rows.map(toTerm))),
        saveTerm: Effect.fn('NovelStore.saveTerm')(function* (novelId, id, term, suggested) {
          const row = {
            id,
            novel_id: novelId,
            ...termColumns(term),
            suggested: suggested === null ? 0 : 1,
            origin: suggested === null ? 'manual' : suggested.origin,
            count: suggested?.count ?? 0,
            chapters: yield* Effect.orDie(encodeNumbers(suggested?.chapters ?? [])),
            created_at: yield* now,
          }

          yield* Effect.orDie(
            suggested === null
              ? sql`
                  INSERT INTO novel_terms ${sql.insert(row)}
                  ON CONFLICT (novel_id, original) DO UPDATE SET
                    translation = excluded.translation, kind = excluded.kind, gender = excluded.gender,
                    note = excluded.note, suggested = 0,
                    reading = COALESCE(excluded.reading, novel_terms.reading)
                `
              : sql`INSERT INTO novel_terms ${sql.insert(row)} ON CONFLICT (novel_id, original) DO NOTHING`,
          )
        }),
        updateTerm: (novelId, id, term) =>
          Effect.orDie(
            sql`UPDATE novel_terms SET ${sql.update(termColumns(term))} WHERE novel_id = ${novelId} AND id = ${id}`,
          ),
        acceptTerms: (novelId, ids) =>
          ids.length === 0
            ? Effect.void
            : Effect.orDie(
                sql`UPDATE novel_terms SET suggested = 0 WHERE novel_id = ${novelId} AND ${sql.in('id', ids)}`,
              ),
        removeTerm: (novelId, id) =>
          Effect.orDie(sql`DELETE FROM novel_terms WHERE novel_id = ${novelId} AND id = ${id}`),
        novelByUrl: (bookUrl) => Effect.orDie(findByUrl(bookUrl)),
        chaptersContaining: (novelId, text) =>
          Effect.orDie(containing({ novelId, text })).pipe(
            Effect.map((rows) => rows.map((row) => row.number)),
          ),
        renameInTranslations: Effect.fn('NovelStore.renameInTranslations')(
          function* (novelId, from, to) {
            if (from === '' || from === to) {
              return []
            }

            const rows = yield* Effect.orDie(withText({ novelId, text: from }))

            for (const row of rows) {
              yield* Effect.orDie(sql`
              UPDATE novel_chapter_translations SET paragraphs = ${row.paragraphs.replaceAll(from, to)}
              WHERE novel_id = ${novelId} AND number = ${row.number} AND target_language = ${row.target_language}
            `)
            }

            return rows.map((row) => row.number)
          },
        ),
        textSources: (novelId) => Effect.orDie(allTextSources(novelId)),
        saveTextSource: Effect.fn('NovelStore.saveTextSource')(function* (novelId, site, bookUrl) {
          const row = { novel_id: novelId, site, book_url: bookUrl, checked_at: yield* now }

          yield* Effect.orDie(sql`
            INSERT INTO novel_text_sources ${sql.insert(row)}
            ON CONFLICT (novel_id, site) DO UPDATE SET book_url = excluded.book_url, checked_at = excluded.checked_at
          `)
        }),
        setTextUrls: Effect.fn('NovelStore.setTextUrls')(function* (novelId, site, urls) {
          let changed = 0

          for (const [number, url] of urls) {
            const result = yield* Effect.orDie(sql`
              UPDATE novel_chapters SET text_site = ${site}, text_url = ${url}
              WHERE novel_id = ${novelId} AND number = ${number} AND origin = 'site' AND text_url IS NULL
              RETURNING number
            `)

            changed += result.length
          }

          return changed
        }),
        sites: Effect.orDie(allSites()).pipe(Effect.map((rows) => rows.map((row) => row.entry))),
        saveSite: Effect.fn('NovelStore.saveSite')(function* (entry) {
          const row = { id: entry.id, entry: yield* Effect.orDie(encodeSite(entry)) }

          yield* Effect.orDie(sql`
            INSERT INTO novel_sites ${sql.insert(row)} ON CONFLICT (id) DO UPDATE SET entry = excluded.entry
          `)
        }),
        removeSite: (id) => Effect.orDie(sql`DELETE FROM novel_sites WHERE id = ${id}`),
      })
    }),
  )
}
