import { Effect, Option, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  BlockKind,
  BlockStatus,
  CleanMethod,
  defaultLettering,
  Lettering,
  MangaEditorSettings,
  type PageBox,
  type TextBlock,
} from '#contract/MangaEditor'

export interface StoredBlock extends TextBlock {
  readonly page: string
  readonly fg: ReadonlyArray<number> | undefined
  readonly bg: ReadonlyArray<number> | undefined
  readonly fontSize: number | undefined
  readonly vertical: boolean
}

export interface StoredPage {
  readonly page: string
  readonly scannedAt: string | undefined
  readonly scanError: string | undefined
  readonly cleanKey: string | undefined
  readonly renderKey: string | undefined
  readonly cleanVersion: number
  readonly renderVersion: number
  readonly brushVersion: number
}

export interface StoredUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number | undefined
}

const Colour = Schema.NullOr(Schema.fromJsonString(Schema.Array(Schema.Int)))

const StoredLettering = Schema.NullOr(Schema.fromJsonString(Lettering))

const BlockRow = Schema.Struct({
  id: Schema.String,
  page: Schema.String,
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  origin: Schema.Literals(['scan', 'drawn']),
  kind: BlockKind,
  source: Schema.String,
  romaji: Schema.String,
  translation: Schema.String,
  status: BlockStatus,
  error: Schema.NullOr(Schema.String),
  joined: Schema.Int,
  clean: Schema.Int,
  clean_method: CleanMethod,
  lettering: StoredLettering,
  fg: Colour,
  bg: Colour,
  font_size: Schema.NullOr(Schema.Int),
  vertical: Schema.Int,
})

const PageRow = Schema.Struct({
  page: Schema.String,
  scanned_at: Schema.NullOr(Schema.String),
  scan_error: Schema.NullOr(Schema.String),
  clean_key: Schema.NullOr(Schema.String),
  render_key: Schema.NullOr(Schema.String),
  clean_version: Schema.Int,
  render_version: Schema.Int,
  brush_version: Schema.Int,
})

const UsageRow = Schema.Struct({
  input_tokens: Schema.Int,
  output_tokens: Schema.Int,
  cost_usd: Schema.NullOr(Schema.Finite),
})

const SettingsRow = Schema.Struct({
  settings: Schema.NullOr(Schema.fromJsonString(MangaEditorSettings)),
})

const encodeColour = Schema.encodeEffect(Colour)

const encodeLettering = Schema.encodeEffect(StoredLettering)

const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(MangaEditorSettings))

const orUndefined = <A>(value: A | null) => (value === null ? undefined : value)

const toBlock = (row: typeof BlockRow.Type): StoredBlock => ({
  id: row.id,
  page: row.page,
  box: { x: row.x, y: row.y, width: row.width, height: row.height },
  origin: row.origin,
  kind: row.kind,
  source: row.source,
  romaji: row.romaji,
  translation: row.translation,
  status: row.status,
  ...(row.error === null ? {} : { error: row.error }),
  joined: row.joined === 1,
  clean: row.clean === 1,
  cleanMethod: row.clean_method,
  lettering: row.lettering ?? defaultLettering,
  fg: orUndefined(row.fg),
  bg: orUndefined(row.bg),
  fontSize: orUndefined(row.font_size),
  vertical: row.vertical === 1,
})

export type BlockPatch = Partial<
  Pick<
    StoredBlock,
    | 'kind'
    | 'source'
    | 'romaji'
    | 'translation'
    | 'status'
    | 'joined'
    | 'clean'
    | 'cleanMethod'
    | 'lettering'
  >
> & { readonly error?: string | null }

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const blocksOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: BlockRow,
    execute: (folder) =>
      sql`SELECT * FROM manga_editor_blocks WHERE folder = ${folder} ORDER BY page, position`,
  })

  const pagesOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: PageRow,
    execute: (folder) => sql`SELECT * FROM manga_editor_pages WHERE folder = ${folder}`,
  })

  const usageOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: UsageRow,
    execute: (folder) =>
      sql`SELECT input_tokens, output_tokens, cost_usd FROM manga_editor_galleries WHERE folder = ${folder}`,
  })

  const settingsOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: SettingsRow,
    execute: (folder) => sql`SELECT settings FROM manga_editor_galleries WHERE folder = ${folder}`,
  })

  const open = (folder: string, pages: ReadonlyArray<string>, now: string) =>
    Effect.gen(function* () {
      yield* sql`INSERT INTO manga_editor_galleries ${sql.insert({ folder, opened_at: now })}
        ON CONFLICT(folder) DO UPDATE SET opened_at = excluded.opened_at`

      for (const page of pages) {
        yield* sql`INSERT OR IGNORE INTO manga_editor_pages ${sql.insert({ folder, page })}`
      }

      yield* sql`UPDATE manga_editor_blocks
        SET status = 'failed', error = 'Wenbu closed before this box was read. Draw it again.'
        WHERE folder = ${folder} AND status = 'reading'`

      yield* sql`UPDATE manga_editor_blocks
        SET status = 'failed', error = 'Wenbu closed before this line was translated. Translate it again.'
        WHERE folder = ${folder} AND status = 'translating'`
    }).pipe(Effect.orDie)

  const blocks = (folder: string) =>
    Effect.map(Effect.orDie(blocksOf(folder)), (rows) => rows.map(toBlock))

  const pages = (folder: string) =>
    Effect.map(Effect.orDie(pagesOf(folder)), (rows): ReadonlyArray<StoredPage> =>
      rows.map((row) => ({
        page: row.page,
        scannedAt: orUndefined(row.scanned_at),
        scanError: orUndefined(row.scan_error),
        cleanKey: orUndefined(row.clean_key),
        renderKey: orUndefined(row.render_key),
        cleanVersion: row.clean_version,
        renderVersion: row.render_version,
        brushVersion: row.brush_version,
      })),
    )

  const usage = (folder: string) =>
    Effect.map(Effect.orDie(usageOf(folder)), ([row]): StoredUsage => ({
      inputTokens: row?.input_tokens ?? 0,
      outputTokens: row?.output_tokens ?? 0,
      costUsd: row?.cost_usd ?? undefined,
    }))

  const settings = (folder: string) =>
    Effect.map(Effect.orDie(settingsOf(folder)), ([row]) => Option.fromNullishOr(row?.settings))

  const saveSettings = (folder: string, value: MangaEditorSettings) =>
    Effect.gen(function* () {
      const json = yield* encodeSettings(value)

      yield* sql`UPDATE manga_editor_galleries SET settings = ${json} WHERE folder = ${folder}`
    }).pipe(Effect.orDie)

  const addUsage = (folder: string, added: StoredUsage) =>
    Effect.orDie(sql`UPDATE manga_editor_galleries SET
      input_tokens = input_tokens + ${added.inputTokens},
      output_tokens = output_tokens + ${added.outputTokens},
      cost_usd = CASE WHEN ${added.costUsd ?? null} IS NULL THEN cost_usd
        ELSE COALESCE(cost_usd, 0) + ${added.costUsd ?? 0} END
      WHERE folder = ${folder}`)

  const recordScan = (
    folder: string,
    page: string,
    outcome: { readonly scannedAt: string } | { readonly error: string },
  ) =>
    Effect.orDie(
      'error' in outcome
        ? sql`UPDATE manga_editor_pages SET scan_error = ${outcome.error}
            WHERE folder = ${folder} AND page = ${page}`
        : sql`UPDATE manga_editor_pages SET scanned_at = ${outcome.scannedAt}, scan_error = NULL
            WHERE folder = ${folder} AND page = ${page}`,
    )

  const insert = (folder: string, block: StoredBlock, position: number) =>
    Effect.gen(function* () {
      const fg = yield* encodeColour(block.fg ?? null)
      const bg = yield* encodeColour(block.bg ?? null)
      const lettering = yield* encodeLettering(block.lettering)

      yield* sql`INSERT INTO manga_editor_blocks ${sql.insert({
        id: block.id,
        folder,
        page: block.page,
        position,
        x: block.box.x,
        y: block.box.y,
        width: block.box.width,
        height: block.box.height,
        origin: block.origin,
        kind: block.kind,
        source: block.source,
        romaji: block.romaji,
        translation: block.translation,
        status: block.status,
        error: block.error ?? null,
        joined: block.joined ? 1 : 0,
        clean: block.clean ? 1 : 0,
        clean_method: block.cleanMethod,
        lettering,
        fg,
        bg,
        font_size: block.fontSize ?? null,
        vertical: block.vertical ? 1 : 0,
      })}`
    }).pipe(Effect.orDie)

  const update = (id: string, patch: BlockPatch) =>
    Effect.gen(function* () {
      const lettering =
        patch.lettering === undefined ? {} : { lettering: yield* encodeLettering(patch.lettering) }

      const columns = {
        ...(patch.kind === undefined ? {} : { kind: patch.kind }),
        ...(patch.source === undefined ? {} : { source: patch.source }),
        ...(patch.romaji === undefined ? {} : { romaji: patch.romaji }),
        ...(patch.translation === undefined ? {} : { translation: patch.translation }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        ...(patch.joined === undefined ? {} : { joined: patch.joined ? 1 : 0 }),
        ...(patch.clean === undefined ? {} : { clean: patch.clean ? 1 : 0 }),
        ...(patch.cleanMethod === undefined ? {} : { clean_method: patch.cleanMethod }),
        ...lettering,
      }

      if (Object.keys(columns).length > 0) {
        yield* sql`UPDATE manga_editor_blocks SET ${sql.update(columns)} WHERE id = ${id}`
      }
    }).pipe(Effect.orDie)

  const remove = (id: string) => Effect.orDie(sql`DELETE FROM manga_editor_blocks WHERE id = ${id}`)

  const reorder = (ids: ReadonlyArray<string>) =>
    Effect.orDie(
      Effect.forEach(
        ids,
        (id, position) =>
          sql`UPDATE manga_editor_blocks SET position = ${position} WHERE id = ${id}`,
        { discard: true },
      ),
    )

  const replacePage = (folder: string, page: string, saved: ReadonlyArray<StoredBlock>) =>
    Effect.gen(function* () {
      yield* Effect.orDie(
        sql`DELETE FROM manga_editor_blocks WHERE folder = ${folder} AND page = ${page}`,
      )

      for (const [position, block] of saved.entries()) {
        yield* insert(folder, block, position)
      }
    })

  const setPage = (
    folder: string,
    page: string,
    keys: {
      readonly cleanKey?: string
      readonly renderKey?: string
      readonly cleaned?: boolean
      readonly rendered?: boolean
      readonly brushed?: boolean
    },
  ) =>
    Effect.orDie(sql`UPDATE manga_editor_pages SET
      clean_key = COALESCE(${keys.cleanKey ?? null}, clean_key),
      render_key = COALESCE(${keys.renderKey ?? null}, render_key),
      clean_version = clean_version + ${keys.cleaned === true ? 1 : 0},
      render_version = render_version + ${keys.rendered === true ? 1 : 0},
      brush_version = brush_version + ${keys.brushed === true ? 1 : 0}
      WHERE folder = ${folder} AND page = ${page}`)

  return {
    open,
    blocks,
    pages,
    usage,
    settings,
    saveSettings,
    addUsage,
    recordScan,
    insert,
    update,
    remove,
    reorder,
    replacePage,
    setPage,
  }
})

export type MangaEditorStore = Effect.Success<typeof make>

export const boxOf = ([x1, y1, x2, y2]: readonly [number, number, number, number]): PageBox => ({
  x: Math.round(x1),
  y: Math.round(y1),
  width: Math.max(1, Math.round(x2 - x1)),
  height: Math.max(1, Math.round(y2 - y1)),
})
