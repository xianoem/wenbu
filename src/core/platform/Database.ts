import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import * as SqliteMigrator from '@effect/sql-sqlite-node/SqliteMigrator'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { backfillFromRuns } from '../llm/UsageLog'

const migrations = SqliteMigrator.fromRecord({
  '0001_llm': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE llm_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        api_url TEXT,
        api_key TEXT NOT NULL,
        verification TEXT NOT NULL,
        verification_message TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE llm_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        description TEXT,
        connection_id TEXT NOT NULL REFERENCES llm_connections(id),
        model_id TEXT NOT NULL,
        temperature REAL NOT NULL,
        top_p REAL NOT NULL,
        max_output_tokens INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  }),
  '0002_library': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        folder_path TEXT NOT NULL,
        folder_key TEXT NOT NULL UNIQUE,
        executable_path TEXT NOT NULL,
        engine TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        text_language TEXT,
        dialogue_characters INTEGER,
        reading_minutes INTEGER,
        translation TEXT NOT NULL,
        added_at TEXT NOT NULL,
        last_played_at TEXT,
        play_seconds INTEGER NOT NULL DEFAULT 0,
        launch_count INTEGER NOT NULL DEFAULT 0
      )
    `

    yield* sql`
      CREATE TABLE translation_runs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id),
        started_at TEXT NOT NULL,
        status TEXT NOT NULL,
        run TEXT NOT NULL
      )
    `

    yield* sql`CREATE INDEX translation_runs_by_game ON translation_runs(game_id, started_at)`
  }),
  '0003_detections': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE detections (
        id TEXT PRIMARY KEY,
        detected_at TEXT NOT NULL,
        detection TEXT NOT NULL
      )
    `
  }),
  '0004_translation_overlay': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE overlay_saved_hooks (
        game_id TEXT PRIMARY KEY REFERENCES games(id),
        hook TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE overlay_pipelines (
        game_id TEXT PRIMARY KEY REFERENCES games(id),
        pipeline TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE overlay_cache (
        game_id TEXT NOT NULL REFERENCES games(id),
        target_language TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, target_language, source_text)
      )
    `

    yield* sql`
      CREATE TABLE overlay_stories (
        game_id TEXT NOT NULL REFERENCES games(id),
        target_language TEXT NOT NULL,
        story TEXT NOT NULL,
        PRIMARY KEY (game_id, target_language)
      )
    `
  }),
  '0005_launch_locale': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE games ADD COLUMN launch_locale TEXT NOT NULL DEFAULT 'system'`
  }),
  '0006_manga': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE manga_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        status TEXT NOT NULL,
        run TEXT NOT NULL
      )
    `
  }),
  '0007_downloads': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE download_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        job TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE download_sessions (
        source TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        saved_at TEXT NOT NULL
      )
    `
  }),
  '0008_ingame_text': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE ingame_texts (
        game_id TEXT NOT NULL REFERENCES games(id),
        target_language TEXT NOT NULL,
        source_key TEXT NOT NULL,
        origin TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        scene TEXT,
        allowed_width INTEGER,
        font_size INTEGER,
        fit TEXT NOT NULL,
        edited INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        shortened INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, target_language, source_key, origin)
      )
    `

    yield* sql`
      CREATE TABLE ingame_images (
        game_id TEXT NOT NULL REFERENCES games(id),
        image_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_at TEXT NOT NULL,
        boxes TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        PRIMARY KEY (game_id, image_path)
      )
    `
  }),
  '0009_manga_editor': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE manga_editor_galleries (
        folder TEXT PRIMARY KEY,
        opened_at TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL
      )
    `

    yield* sql`
      CREATE TABLE manga_editor_pages (
        folder TEXT NOT NULL REFERENCES manga_editor_galleries(folder),
        page TEXT NOT NULL,
        scanned_at TEXT,
        scan_error TEXT,
        clean_key TEXT,
        render_key TEXT,
        render_version INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (folder, page)
      )
    `

    yield* sql`
      CREATE TABLE manga_editor_blocks (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        page TEXT NOT NULL,
        position INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        origin TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        romaji TEXT NOT NULL,
        translation TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        joined INTEGER NOT NULL,
        clean INTEGER NOT NULL,
        fg TEXT,
        bg TEXT,
        font_size INTEGER,
        vertical INTEGER NOT NULL,
        FOREIGN KEY (folder, page) REFERENCES manga_editor_pages(folder, page)
      )
    `

    yield* sql`CREATE INDEX manga_editor_blocks_page ON manga_editor_blocks (folder, page, position)`
  }),
  '0010_manga_editor_steps': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE manga_editor_galleries ADD COLUMN settings TEXT`
    yield* sql`ALTER TABLE manga_editor_pages ADD COLUMN clean_version INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE manga_editor_pages ADD COLUMN brush_version INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE manga_editor_blocks ADD COLUMN clean_method TEXT NOT NULL DEFAULT 'fill'`
    yield* sql`ALTER TABLE manga_editor_blocks ADD COLUMN lettering TEXT`
  }),
  '0011_galleries': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE gallery_roots (
        path TEXT PRIMARY KEY,
        added_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE gallery_listings (
        folder TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        modified_ms INTEGER NOT NULL,
        created_ms INTEGER,
        images TEXT NOT NULL,
        folders TEXT NOT NULL,
        details INTEGER NOT NULL
      )
    `

    yield* sql`CREATE INDEX gallery_listings_root ON gallery_listings (root)`

    yield* sql`
      CREATE TABLE gallery_entries (
        folder TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        parent TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        title_japanese TEXT,
        artists TEXT NOT NULL,
        tags TEXT NOT NULL,
        source TEXT,
        url TEXT,
        search TEXT NOT NULL,
        original_pages INTEGER NOT NULL,
        translated_pages INTEGER NOT NULL,
        cover TEXT,
        covers TEXT NOT NULL,
        galleries INTEGER NOT NULL,
        pages INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        downloaded INTEGER NOT NULL,
        pages_synced INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      )
    `

    yield* sql`CREATE INDEX gallery_entries_parent ON gallery_entries (parent)`
    yield* sql`CREATE INDEX gallery_entries_root ON gallery_entries (root)`

    yield* sql`
      CREATE TABLE gallery_pages (
        gallery TEXT NOT NULL,
        version TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        file TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        bytes INTEGER NOT NULL,
        modified_ms INTEGER NOT NULL,
        PRIMARY KEY (gallery, version, name)
      )
    `

    yield* sql`
      CREATE TABLE gallery_reading (
        gallery TEXT PRIMARY KEY,
        page INTEGER NOT NULL,
        version TEXT NOT NULL,
        direction TEXT NOT NULL,
        shift_spread INTEGER NOT NULL,
        layout TEXT NOT NULL,
        read_at TEXT NOT NULL
      )
    `
  }),
  '0012_translation_lines': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE translation_lines (
        game_id TEXT NOT NULL REFERENCES games(id),
        entry_id TEXT NOT NULL,
        file TEXT NOT NULL,
        pointer TEXT NOT NULL,
        context TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT,
        origin TEXT NOT NULL DEFAULT 'model',
        locked INTEGER NOT NULL DEFAULT 0,
        applied INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, entry_id)
      )
    `

    yield* sql`CREATE INDEX translation_lines_source ON translation_lines (game_id, source_text)`
  }),
  '0013_game_file_hashes': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE game_file_hashes (
        game_id TEXT NOT NULL REFERENCES games(id),
        file TEXT NOT NULL,
        original_hash TEXT NOT NULL,
        written_hash TEXT,
        PRIMARY KEY (game_id, file)
      )
    `
  }),
  '0014_translation_line_changes': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE translation_lines ADD COLUMN change TEXT`
    yield* sql`ALTER TABLE translation_lines ADD COLUMN previous_source TEXT`
    yield* sql`ALTER TABLE translation_lines ADD COLUMN previous_text TEXT`
  }),
  '0015_translation_line_write_skipped': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE translation_lines ADD COLUMN write_skipped TEXT`
  }),
  '0016_game_updates': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE game_updates (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id),
        detected_at TEXT NOT NULL,
        report TEXT NOT NULL
      )
    `

    yield* sql`CREATE INDEX game_updates_by_game ON game_updates (game_id, detected_at)`
  }),
  '0017_game_guide': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE guide_indexes (
        game_id TEXT PRIMARY KEY REFERENCES games(id),
        version INTEGER NOT NULL,
        stamp TEXT NOT NULL,
        built_at TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `
  }),
  '0018_llm_usage': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // Empty strings stand for "none" so the primary key can take the daily upsert.
    yield* sql`
      CREATE TABLE llm_usage (
        day TEXT NOT NULL,
        feature TEXT NOT NULL,
        preset_id TEXT NOT NULL,
        preset_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        requests INTEGER NOT NULL,
        unpriced_requests INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        PRIMARY KEY (day, feature, preset_id, model_id, game_id)
      )
    `

    yield* backfillFromRuns
  }),
  '0019_translation_line_counts': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE translation_line_counts (
        game_id TEXT PRIMARY KEY,
        lines INTEGER NOT NULL,
        translated INTEGER NOT NULL,
        pending INTEGER NOT NULL,
        skipped INTEGER NOT NULL
      )
    `

    yield* sql`
      INSERT INTO translation_line_counts
      SELECT game_id, COUNT(*), SUM(translated_text IS NOT NULL),
        SUM(change IS NOT NULL AND translated_text IS NULL), SUM(write_skipped IS NOT NULL)
      FROM translation_lines GROUP BY game_id
    `

    yield* sql`
      CREATE TRIGGER translation_line_counts_insert AFTER INSERT ON translation_lines BEGIN
        INSERT INTO translation_line_counts VALUES (
          NEW.game_id, 1, NEW.translated_text IS NOT NULL,
          NEW.change IS NOT NULL AND NEW.translated_text IS NULL, NEW.write_skipped IS NOT NULL
        )
        ON CONFLICT (game_id) DO UPDATE SET
          lines = lines + 1,
          translated = translated + excluded.translated,
          pending = pending + excluded.pending,
          skipped = skipped + excluded.skipped;
      END
    `

    yield* sql`
      CREATE TRIGGER translation_line_counts_delete AFTER DELETE ON translation_lines BEGIN
        UPDATE translation_line_counts SET
          lines = lines - 1,
          translated = translated - (OLD.translated_text IS NOT NULL),
          pending = pending - (OLD.change IS NOT NULL AND OLD.translated_text IS NULL),
          skipped = skipped - (OLD.write_skipped IS NOT NULL)
        WHERE game_id = OLD.game_id;
      END
    `

    yield* sql`
      CREATE TRIGGER translation_line_counts_update
      AFTER UPDATE OF translated_text, change, write_skipped ON translation_lines BEGIN
        UPDATE translation_line_counts SET
          translated = translated - (OLD.translated_text IS NOT NULL)
            + (NEW.translated_text IS NOT NULL),
          pending = pending - (OLD.change IS NOT NULL AND OLD.translated_text IS NULL)
            + (NEW.change IS NOT NULL AND NEW.translated_text IS NULL),
          skipped = skipped - (OLD.write_skipped IS NOT NULL) + (NEW.write_skipped IS NOT NULL)
        WHERE game_id = NEW.game_id;
      END
    `
  }),
  '0020_details': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE dlsite_works (
        code TEXT PRIMARY KEY,
        work TEXT NOT NULL,
        rating REAL,
        rating_count INTEGER,
        cover_file TEXT,
        sample_files TEXT NOT NULL DEFAULT '[]',
        translated_title TEXT,
        translated_description TEXT,
        fetched_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE game_work_links (
        game_id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        linked_by TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        linked_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE game_detail_edits (
        game_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (game_id, field)
      )
    `

    yield* sql`
      CREATE TABLE game_detail_finds (
        game_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        candidates TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        updated_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE dlsite_lists (
        list TEXT PRIMARY KEY,
        works TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE dlsite_genre_rules (
        genre_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        rule TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE dlsite_watched (
        code TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        watched_at TEXT NOT NULL,
        released_on TEXT
      )
    `
  }),
  '0021_novels': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE novels (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_translated TEXT,
        author TEXT,
        cover_url TEXT,
        synopsis TEXT,
        synopsis_translated TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        status TEXT,
        language TEXT NOT NULL,
        site TEXT,
        book_url TEXT,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        checked_at TEXT
      )
    `

    yield* sql`
      CREATE TABLE novel_chapters (
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        title_translated TEXT,
        origin TEXT NOT NULL,
        site TEXT,
        url TEXT,
        extra INTEGER NOT NULL DEFAULT 0,
        is_new INTEGER NOT NULL DEFAULT 0,
        released_at TEXT,
        PRIMARY KEY (novel_id, number)
      )
    `

    yield* sql`
      CREATE TABLE novel_chapter_texts (
        novel_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        paragraphs TEXT NOT NULL,
        note TEXT,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (novel_id, number),
        FOREIGN KEY (novel_id, number) REFERENCES novel_chapters(novel_id, number) ON DELETE CASCADE
      )
    `

    yield* sql`
      CREATE TABLE novel_chapter_translations (
        novel_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        target_language TEXT NOT NULL,
        preset_id TEXT NOT NULL,
        glossary_key TEXT NOT NULL,
        paragraphs TEXT NOT NULL,
        title TEXT,
        cost_usd REAL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (novel_id, number, target_language),
        FOREIGN KEY (novel_id, number) REFERENCES novel_chapters(novel_id, number) ON DELETE CASCADE
      )
    `

    yield* sql`
      CREATE TABLE novel_reading (
        novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
        chapter INTEGER NOT NULL,
        paragraph INTEGER NOT NULL,
        read_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE novel_terms (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        original TEXT NOT NULL,
        translation TEXT NOT NULL,
        kind TEXT NOT NULL,
        gender TEXT,
        note TEXT,
        suggested INTEGER NOT NULL DEFAULT 0,
        chapters TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE (novel_id, original)
      )
    `

    yield* sql`
      CREATE TABLE novel_sites (
        id TEXT PRIMARY KEY,
        entry TEXT NOT NULL
      )
    `
  }),
  '0022_novel_text_sources': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE novel_chapters ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE novel_chapters ADD COLUMN text_site TEXT`
    yield* sql`ALTER TABLE novel_chapters ADD COLUMN text_url TEXT`

    yield* sql`
      CREATE TABLE novel_text_sources (
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        book_url TEXT NOT NULL,
        checked_at TEXT,
        PRIMARY KEY (novel_id, site)
      )
    `
  }),
  '0023_novel_term_origin': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE novel_terms ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`
    yield* sql`ALTER TABLE novel_terms ADD COLUMN count INTEGER NOT NULL DEFAULT 0`
    yield* sql`UPDATE novel_terms SET origin = 'translation' WHERE suggested = 1`
  }),
  '0024_general_glossaries': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE novel_terms ADD COLUMN reading TEXT`

    yield* sql`
      CREATE TABLE glossaries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `

    yield* sql`
      CREATE TABLE glossary_terms (
        id TEXT PRIMARY KEY,
        glossary_id TEXT NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
        original TEXT NOT NULL,
        translation TEXT NOT NULL,
        kind TEXT NOT NULL,
        gender TEXT,
        reading TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (glossary_id, original)
      )
    `

    yield* sql`
      CREATE TABLE novel_glossaries (
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        glossary_id TEXT NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (novel_id, glossary_id)
      )
    `
  }),
  '0025_novel_chat': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE novel_digests (
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        summary TEXT NOT NULL,
        characters TEXT NOT NULL,
        flags TEXT NOT NULL,
        cost_usd REAL,
        made_at TEXT NOT NULL,
        PRIMARY KEY (novel_id, number)
      )
    `

    // Trigram tokens find Chinese, Japanese and Korean words without a word splitter.
    yield* sql`
      CREATE VIRTUAL TABLE novel_text_index USING fts5(
        novel_id UNINDEXED, number UNINDEXED, paragraph UNINDEXED, body, tokenize = 'trigram'
      )
    `

    yield* sql`
      INSERT INTO novel_text_index (novel_id, number, paragraph, body)
      SELECT t.novel_id, t.number, p.key, p.value
      FROM novel_chapter_texts t, json_each(t.paragraphs) p
    `

    yield* sql`
      CREATE TABLE novel_answers (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        answer TEXT NOT NULL,
        asked_at TEXT NOT NULL
      )
    `
  }),
  '0026_dlsite_game_type_rules': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE dlsite_game_type_rules (
        work_type TEXT PRIMARY KEY,
        rule TEXT NOT NULL
      )
    `
  }),
  '0027_automatic_launch_locale': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`ALTER TABLE games ADD COLUMN needs_japanese_locale INTEGER`

    yield* sql`UPDATE games SET launch_locale = 'auto' WHERE launch_locale = 'system'`
  }),
  '0028_dlsite_list_filters': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`DELETE FROM dlsite_genre_rules WHERE rule <> 'only'`
    yield* sql`ALTER TABLE dlsite_genre_rules DROP COLUMN rule`
    yield* sql`ALTER TABLE dlsite_genre_rules RENAME TO dlsite_filter_tags`

    yield* sql`DELETE FROM dlsite_game_type_rules WHERE rule <> 'only'`
    yield* sql`ALTER TABLE dlsite_game_type_rules DROP COLUMN rule`
    yield* sql`ALTER TABLE dlsite_game_type_rules RENAME TO dlsite_filter_game_types`

    yield* sql`DELETE FROM dlsite_lists`
  }),
  '0029_rescan_game_images': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`DELETE FROM ingame_images`
  }),
})

export const layer = (filename: string) =>
  SqliteMigrator.layer({ loader: migrations }).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename })),
  )
