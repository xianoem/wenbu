import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { RgbaImage } from './Detections'
import { MangaLanguage, MangaRunUsage } from './Manga'

export const BlockKind = Schema.Literals(['dialogue', 'thought', 'narration', 'sfx', 'sign'])

export type BlockKind = typeof BlockKind.Type

export const BlockStatus = Schema.Literals([
  'reading',
  'translating',
  'draft',
  'approved',
  'failed',
])

export type BlockStatus = typeof BlockStatus.Type

/** Page pixels. */
export const PageBox = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
})

export type PageBox = typeof PageBox.Type

export const CleanMethod = Schema.Literals(['fill', 'inpaint'])

export type CleanMethod = typeof CleanMethod.Type

export const BreakMode = Schema.Literals(['balanced', 'greedy', 'manual'])

export type BreakMode = typeof BreakMode.Type

export const LetterStyle = Schema.Literals([
  'dialogue',
  'thought',
  'shout',
  'whisper',
  'narration',
  'sfx',
])

export type LetterStyle = typeof LetterStyle.Type

export const Sizing = Schema.Literals(['kind', 'custom', 'fill'])

export type Sizing = typeof Sizing.Type

export const Lettering = Schema.Struct({
  breakMode: BreakMode,
  avoidOrphans: Schema.Boolean,
  hyphenate: Schema.Boolean,
  style: LetterStyle,
  sizing: Schema.optional(Sizing),
  /** In the gallery's size units. */
  size: Schema.optional(Schema.Int),
  /** A step from its kind's size, in percent. */
  emphasis: Schema.optional(Schema.Finite),
  shrink: Schema.optional(Schema.Boolean),
  leading: Schema.optional(Schema.Finite),
  textBox: Schema.optional(PageBox),
  font: Schema.optional(Schema.String),
})

export type Lettering = typeof Lettering.Type

export const sizingOf = (lettering: Lettering): Sizing =>
  lettering.sizing ?? (lettering.size === undefined ? 'kind' : 'custom')

export const defaultLettering: Lettering = {
  breakMode: 'balanced',
  avoidOrphans: true,
  hyphenate: true,
  style: 'dialogue',
}

export const BubbleLayout = Schema.Struct({
  size: Schema.Int,
  lines: Schema.Array(Schema.String),
})

export type BubbleLayout = typeof BubbleLayout.Type

export const TextBlock = Schema.Struct({
  id: Schema.String,
  box: PageBox,
  origin: Schema.Literals(['scan', 'drawn']),
  kind: BlockKind,
  source: Schema.String,
  romaji: Schema.String,
  translation: Schema.String,
  status: BlockStatus,
  error: Schema.optional(Schema.String),
  joined: Schema.Boolean,
  clean: Schema.Boolean,
  cleanMethod: CleanMethod,
  lettering: Lettering,
  ink: Schema.optional(Schema.Tuple([Schema.Int, Schema.Int, Schema.Int])),
})

export type TextBlock = typeof TextBlock.Type

export const PageStep = Schema.Literals(['scan', 'translate', 'clean', 'letter'])

export type PageStep = typeof PageStep.Type

export const EditorPage = Schema.Struct({
  name: Schema.String,
  width: Schema.optional(Schema.Int),
  height: Schema.optional(Schema.Int),
  blocks: Schema.Array(TextBlock),
  done: Schema.Array(PageStep),
  running: Schema.optional(PageStep),
  error: Schema.optional(Schema.String),
  cleanVersion: Schema.Int,
  renderVersion: Schema.Int,
  brushVersion: Schema.Int,
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
})

export type EditorPage = typeof EditorPage.Type

export const MangaEditorState = Schema.Struct({
  folder: Schema.String,
  outputFolder: Schema.String,
  pages: Schema.Array(EditorPage),
  usage: MangaRunUsage,
})

export type MangaEditorState = typeof MangaEditorState.Type

export const MangaEditorSettings = Schema.Struct({
  presetId: Schema.String,
  targetLanguage: MangaLanguage,
  seriesNotes: Schema.String,
  font: Schema.String,
  minFontSize: Schema.Int,
  maxFontSize: Schema.Int,
  /** In size units. */
  kindSizes: Schema.Struct({
    dialogue: Schema.optional(Schema.Int),
    thought: Schema.optional(Schema.Int),
    narration: Schema.optional(Schema.Int),
    sfx: Schema.optional(Schema.Int),
    sign: Schema.optional(Schema.Int),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  /** The page height sizes are measured at; without one, a size is the page's own pixels. */
  sizeReference: Schema.optional(Schema.Int),
  outline: Schema.Boolean,
  outlineColor: Schema.String,
  uppercase: Schema.Boolean,
  cleanMethod: CleanMethod,
})

export type MangaEditorSettings = typeof MangaEditorSettings.Type

export class MangaEditorError extends Schema.TaggedError<MangaEditorError>()('MangaEditorError', {
  reason: Schema.Literals(['invalid', 'not-found', 'not-ready', 'failed']),
  message: Schema.String,
}) {}

export const BreakCandidate = Schema.Struct({
  lines: Schema.Array(Schema.String),
  fontSize: Schema.Int,
})

export type BreakCandidate = typeof BreakCandidate.Type

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})

export type ChatMessage = typeof ChatMessage.Type

export const ChatReply = Schema.Struct({
  text: Schema.String,
  suggestion: Schema.optional(
    Schema.Struct({ id: Schema.String, number: Schema.Int, translation: Schema.String }),
  ),
})

export type ChatReply = typeof ChatReply.Type

export const passageSeparator = '|'

export const linesOf = <B extends { readonly joined: boolean }>(blocks: ReadonlyArray<B>) => {
  const lines: Array<Array<B>> = []

  for (const block of blocks) {
    const last = lines.at(-1)

    if (block.joined && last !== undefined) {
      last.push(block)
    } else {
      lines.push([block])
    }
  }

  return lines
}

const ByFolder = { folder: Schema.String }

const ByPage = { folder: Schema.String, page: Schema.String }

const ByBlock = { ...ByPage, id: Schema.String }

export class MangaEditorRpc extends RpcGroup.make(
  Rpc.make('openMangaEditor', {
    payload: ByFolder,
    success: Schema.String,
    error: MangaEditorError,
  }),
  Rpc.make('closeMangaEditor', { payload: ByFolder }),
  Rpc.make('watchMangaEditor', {
    payload: ByFolder,
    success: MangaEditorState,
    error: MangaEditorError,
    stream: true,
  }),
  Rpc.make('getMangaEditorSettings', {
    payload: ByFolder,
    success: MangaEditorSettings,
    error: MangaEditorError,
  }),
  Rpc.make('saveMangaEditorSettings', {
    payload: { ...ByFolder, settings: MangaEditorSettings },
    success: MangaEditorSettings,
    error: MangaEditorError,
  }),
  Rpc.make('readMangaEditorImage', {
    payload: {
      ...ByPage,
      /** `brush` is the user's strokes: red to inpaint, green to keep. */
      kind: Schema.Literals(['original', 'result', 'cleaned', 'brush']),
      version: Schema.Int,
    },
    success: Schema.Uint8Array,
    error: MangaEditorError,
  }),
  Rpc.make('findMangaEditorImage', {
    payload: { ...ByPage, kind: Schema.Literals(['original', 'result', 'cleaned', 'brush']) },
    success: Schema.String,
    error: MangaEditorError,
  }),
  Rpc.make('scanMangaEditorPage', {
    payload: { ...ByPage, translate: Schema.Boolean },
    error: MangaEditorError,
  }),
  Rpc.make('translateMangaEditorPage', { payload: ByPage, error: MangaEditorError }),
  Rpc.make('cleanMangaEditorPage', { payload: ByPage, error: MangaEditorError }),
  Rpc.make('letterMangaEditorPage', { payload: ByPage, error: MangaEditorError }),
  Rpc.make('brushMangaEditorPage', {
    payload: { ...ByPage, image: Schema.Uint8Array },
    error: MangaEditorError,
  }),
  Rpc.make('addMangaEditorBlock', {
    payload: { ...ByPage, box: PageBox, image: RgbaImage },
    success: Schema.String,
    error: MangaEditorError,
  }),
  Rpc.make('updateMangaEditorLine', {
    payload: {
      ...ByBlock,
      /** The whole Passage's translation, its bubbles split by `|`. */
      translation: Schema.optional(Schema.String),
      approved: Schema.optional(Schema.Boolean),
      kind: Schema.optional(BlockKind),
      clean: Schema.optional(Schema.Boolean),
      cleanMethod: Schema.optional(CleanMethod),
    },
    error: MangaEditorError,
  }),
  Rpc.make('letterMangaEditorBlock', {
    payload: { ...ByBlock, lettering: Lettering, everyBubble: Schema.Boolean },
    error: MangaEditorError,
  }),
  Rpc.make('removeMangaEditorBlock', { payload: ByBlock, error: MangaEditorError }),
  Rpc.make('orderMangaEditorLines', {
    payload: { ...ByPage, ids: Schema.Array(Schema.String) },
    error: MangaEditorError,
  }),
  Rpc.make('mergeMangaEditorLines', {
    payload: { ...ByPage, ids: Schema.Array(Schema.String) },
    error: MangaEditorError,
  }),
  Rpc.make('splitMangaEditorLine', { payload: ByBlock, error: MangaEditorError }),
  Rpc.make('undoMangaEditor', { payload: ByPage, error: MangaEditorError }),
  Rpc.make('redoMangaEditor', { payload: ByPage, error: MangaEditorError }),
  Rpc.make('breaksMangaEditorBlock', {
    payload: ByBlock,
    success: Schema.Array(BreakCandidate),
    error: MangaEditorError,
  }),
  Rpc.make('suggestMangaEditorAlternatives', {
    payload: ByBlock,
    success: Schema.Array(Schema.String),
    error: MangaEditorError,
  }),
  Rpc.make('chatMangaEditor', {
    payload: {
      ...ByPage,
      id: Schema.optional(Schema.String),
      messages: Schema.Array(ChatMessage),
    },
    success: ChatReply,
    error: MangaEditorError,
  }),
  Rpc.make('findMangaEditorFont', {
    payload: { font: Schema.String },
    success: Schema.optional(Schema.String),
  }),
  Rpc.make('exportMangaEditor', {
    payload: { ...ByFolder, layouts: Schema.Record(Schema.String, BubbleLayout) },
    success: Schema.String,
    error: MangaEditorError,
  }),
) {}
