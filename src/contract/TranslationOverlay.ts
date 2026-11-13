import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { StartLocale } from './Library'

const processor = <Tag extends string, Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) => Schema.TaggedStruct(tag, { id: Schema.String, enabled: Schema.Boolean, ...fields })

export const TextReplacementRule = Schema.Struct({
  id: Schema.String,
  regex: Schema.Boolean,
  escape: Schema.Boolean,
  key: Schema.String,
  value: Schema.String,
})

export type TextReplacementRule = typeof TextReplacementRule.Type

export const StringReplacement = processor('StringReplacement', {
  rules: Schema.Array(TextReplacementRule),
})

export type StringReplacement = typeof StringReplacement.Type

export const RemoveNonShiftJis = processor('RemoveNonShiftJis', {})
export const RemoveControlCharacters = processor('RemoveControlCharacters', {})
export const RemoveAsciiPunctuation = processor('RemoveAsciiPunctuation', {})
export const KeepJapaneseQuotes = processor('KeepJapaneseQuotes', {})
export const RemoveBraces = processor('RemoveBraces', {})

export const KeepLines = processor('KeepLines', {
  count: Schema.Int,
  from: Schema.Literals(['start', 'end']),
})

export type KeepLines = typeof KeepLines.Type

export const DedupeCharacters = processor('DedupeCharacters', {
  repeatCount: Schema.Int,
  preserveNonRepeated: Schema.Boolean,
})

export type DedupeCharacters = typeof DedupeCharacters.Type

export const DedupeWholeText = processor('DedupeWholeText', {
  repeatCount: Schema.Int,
})

export type DedupeWholeText = typeof DedupeWholeText.Type

export const DedupeVariableSegments = processor('DedupeVariableSegments', {})
export const RecoverShrinkingSuffix = processor('RecoverShrinkingSuffix', {})
export const RecoverGrowingPrefix = processor('RecoverGrowingPrefix', {})
export const RemoveAngleTags = processor('RemoveAngleTags', {})
export const RemoveLineBreaks = processor('RemoveLineBreaks', {})
export const RemoveNumbers = processor('RemoveNumbers', {})
export const RemoveLatinLetters = processor('RemoveLatinLetters', {})

export const TextProcessor = Schema.Union([
  StringReplacement,
  RemoveNonShiftJis,
  RemoveControlCharacters,
  RemoveAsciiPunctuation,
  KeepJapaneseQuotes,
  RemoveBraces,
  KeepLines,
  DedupeCharacters,
  DedupeWholeText,
  DedupeVariableSegments,
  RecoverShrinkingSuffix,
  RecoverGrowingPrefix,
  RemoveAngleTags,
  RemoveLineBreaks,
  RemoveNumbers,
  RemoveLatinLetters,
])

export type TextProcessor = typeof TextProcessor.Type

export const TextPipeline = Schema.Struct({ processors: Schema.Array(TextProcessor) })

export type TextPipeline = typeof TextPipeline.Type

export const defaultTextPipeline: TextPipeline = {
  processors: [
    StringReplacement.make({ id: 'string-replacement', enabled: false, rules: [] }),
    RemoveNonShiftJis.make({ id: 'remove-non-shift-jis', enabled: false }),
    RemoveControlCharacters.make({ id: 'remove-control-characters', enabled: false }),
    RemoveAsciiPunctuation.make({ id: 'remove-ascii-punctuation', enabled: false }),
    KeepJapaneseQuotes.make({ id: 'keep-japanese-quotes', enabled: false }),
    RemoveBraces.make({ id: 'remove-braces', enabled: false }),
    KeepLines.make({ id: 'keep-lines', enabled: false, count: 1, from: 'end' }),
    DedupeCharacters.make({
      id: 'dedupe-characters',
      enabled: true,
      repeatCount: 1,
      preserveNonRepeated: true,
    }),
    DedupeWholeText.make({ id: 'dedupe-whole-text', enabled: true, repeatCount: 1 }),
    DedupeVariableSegments.make({ id: 'dedupe-variable-segments', enabled: false }),
    RecoverShrinkingSuffix.make({ id: 'recover-shrinking-suffix', enabled: false }),
    RecoverGrowingPrefix.make({ id: 'recover-growing-prefix', enabled: false }),
    RemoveAngleTags.make({ id: 'remove-angle-tags', enabled: false }),
    RemoveLineBreaks.make({ id: 'remove-line-breaks', enabled: false }),
    RemoveNumbers.make({ id: 'remove-numbers', enabled: false }),
    RemoveLatinLetters.make({ id: 'remove-latin-letters', enabled: false }),
  ],
}

export const TextPipelineStep = Schema.Struct({
  processorId: Schema.String,
  before: Schema.String,
  after: Schema.String,
  error: Schema.optional(Schema.String),
})

export type TextPipelineStep = typeof TextPipelineStep.Type

export const TextPipelineResult = Schema.Struct({
  text: Schema.String,
  steps: Schema.Array(TextPipelineStep),
})

export type TextPipelineResult = typeof TextPipelineResult.Type

export const OnNewLine = Schema.Literals(['cancel', 'finish'])

export type OnNewLine = typeof OnNewLine.Type

export const ContextMode = Schema.Literals(['off', 'recent', 'summary'])

export type ContextMode = typeof ContextMode.Type

export const OverlayContext = Schema.Struct({
  mode: ContextMode,
  lines: Schema.Int,
  maxTokens: Schema.Int,
  summaryEvery: Schema.Int,
})

export type OverlayContext = typeof OverlayContext.Type

export const uncataloguedContextWindow = 8000

export const contextBudget = (
  model: {
    readonly contextWindow?: number | undefined
    readonly maxOutputTokens?: number | undefined
  },
  context: OverlayContext,
  promptTokens: number,
) => {
  const window = model.contextWindow ?? uncataloguedContextWindow
  const room = Math.floor(window / 2) - (model.maxOutputTokens ?? 0) - promptTokens

  return Math.max(0, Math.min(context.maxTokens, room))
}

export const OverlaySettings = Schema.Struct({
  presetId: Schema.String,
  sourceLanguage: Schema.String,
  targetLanguage: Schema.String,
  timeoutSeconds: Schema.Int,
  retryRounds: Schema.Int,
  onNewLine: OnNewLine,
  context: OverlayContext,
})

export type OverlaySettings = typeof OverlaySettings.Type

export const defaultContextLines: Record<ContextMode, number> = { off: 0, recent: 10, summary: 3 }

export const defaultOverlaySettings: OverlaySettings = {
  presetId: '',
  sourceLanguage: 'Japanese',
  targetLanguage: 'English',
  timeoutSeconds: 120,
  retryRounds: 2,
  onNewLine: 'cancel',
  context: { mode: 'off', lines: 10, maxTokens: 2000, summaryEvery: 25 },
}

export const OverlayAppearance = Schema.Struct({
  fontSize: Schema.Int,
  fontColor: Schema.String,
  fontFamily: Schema.String,
  opacity: Schema.Finite,
  showOriginal: Schema.Boolean,
  locked: Schema.Boolean,
})

export type OverlayAppearance = typeof OverlayAppearance.Type

export const defaultOverlayAppearance: OverlayAppearance = {
  fontSize: 20,
  fontColor: '#ffffff',
  fontFamily: 'system',
  opacity: 0.86,
  showOriginal: false,
  locked: false,
}

export const overlayFontSizes = { min: 8, max: 36 } as const

export const overlayOpacity = { min: 0.25, max: 1 } as const

export const OverlayStatus = Schema.Literals([
  'idle',
  'launching',
  'attached',
  'waiting-for-text',
  'translating',
  'setup-required',
  'failed',
  'stopped',
])

export type OverlayStatus = typeof OverlayStatus.Type

export const DiagnosticLevel = Schema.Literals(['info', 'warn', 'error'])

export type DiagnosticLevel = typeof DiagnosticLevel.Type

export const OverlayDiagnostic = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  level: DiagnosticLevel,
  message: Schema.String,
})

export type OverlayDiagnostic = typeof OverlayDiagnostic.Type

export const OverlayUsage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.optional(Schema.Finite),
  modelName: Schema.optional(Schema.String),
})

export type OverlayUsage = typeof OverlayUsage.Type

export const OverlayOffer = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('locale'), locale: StartLocale }),
  Schema.Struct({ kind: Schema.Literal('elevated'), processId: Schema.Int }),
])

export type OverlayOffer = typeof OverlayOffer.Type

export const SelectedHook = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
})

export type SelectedHook = typeof SelectedHook.Type

export const OverlayState = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  gameId: Schema.optional(Schema.String),
  gameTitle: Schema.optional(Schema.String),
  status: OverlayStatus,
  message: Schema.String,
  processIds: Schema.Array(Schema.Int),
  selectedHook: Schema.optional(SelectedHook),
  sourceText: Schema.optional(Schema.String),
  translatedText: Schema.optional(Schema.String),
  cacheHit: Schema.Boolean,
  translating: Schema.Boolean,
  canRetry: Schema.Boolean,
  paused: Schema.Boolean,
  visible: Schema.Boolean,
  usage: OverlayUsage,
  appearance: OverlayAppearance,
  offer: Schema.optional(OverlayOffer),
  diagnostics: Schema.Array(OverlayDiagnostic),
})

export type OverlayState = typeof OverlayState.Type

export const HookConfidence = Schema.Literals(['High', 'Medium', 'Low'])

export type HookConfidence = typeof HookConfidence.Type

export const HookSample = Schema.Struct({ raw: Schema.String, text: Schema.String })

export type HookSample = typeof HookSample.Type

export const OverlayHook = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  processId: Schema.Int,
  confidence: HookConfidence,
  score: Schema.Int,
  reasons: Schema.Array(Schema.String),
  signal: Schema.String,
  samples: Schema.Array(HookSample),
  updateCount: Schema.Int,
  lastSeenAt: Schema.String,
  selected: Schema.Boolean,
  manual: Schema.Boolean,
})

export type OverlayHook = typeof OverlayHook.Type

export const SavedHook = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  ctx: Schema.String,
  ctx2: Schema.String,
  inserted: Schema.Boolean,
  sample: Schema.optional(Schema.String),
  savedAt: Schema.String,
})

export type SavedHook = typeof SavedHook.Type

export const StorySummary = Schema.Struct({
  summary: Schema.String,
  lineCount: Schema.Int,
  updatedAt: Schema.String,
})

export type StorySummary = typeof StorySummary.Type

export const OverlayGame = Schema.Struct({
  savedHook: Schema.optional(SavedHook),
  pipeline: TextPipeline,
  story: Schema.optional(StorySummary),
})

export type OverlayGame = typeof OverlayGame.Type

export const GameProcess = Schema.Struct({
  processId: Schema.Int,
  name: Schema.String,
  executablePath: Schema.String,
  matchReason: Schema.String,
})

export type GameProcess = typeof GameProcess.Type

export class OverlayError extends Schema.TaggedError<OverlayError>()('OverlayError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'not-ready', 'elevated', 'failed']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ByGame = { gameId: Schema.String }

export class TranslationOverlayRpc extends RpcGroup.make(
  Rpc.make('getOverlaySettings', { success: OverlaySettings }),
  Rpc.make('saveOverlaySettings', {
    payload: OverlaySettings,
    success: OverlaySettings,
    error: OverlayError,
  }),
  Rpc.make('watchOverlay', { success: OverlayState, stream: true }),
  Rpc.make('watchOverlayHooks', { success: Schema.Array(OverlayHook), stream: true }),
  Rpc.make('getOverlayGame', { payload: ByGame, success: OverlayGame, error: OverlayError }),
  Rpc.make('saveTextPipeline', {
    payload: { gameId: Schema.String, pipeline: TextPipeline },
    success: TextPipeline,
    error: OverlayError,
  }),
  Rpc.make('resetTextPipeline', { payload: ByGame, success: TextPipeline }),
  Rpc.make('previewTextPipeline', {
    payload: { text: Schema.String, pipeline: TextPipeline },
    success: TextPipelineResult,
  }),
  Rpc.make('resetStory', { payload: ByGame }),
  Rpc.make('launchWithOverlay', { payload: ByGame, error: OverlayError }),
  Rpc.make('findGameProcesses', {
    payload: ByGame,
    success: Schema.Array(GameProcess),
    error: OverlayError,
  }),
  Rpc.make('attachOverlay', {
    payload: { gameId: Schema.String, processId: Schema.Int },
    error: OverlayError,
  }),
  Rpc.make('attachOverlayElevated', { payload: { processId: Schema.Int }, error: OverlayError }),
  Rpc.make('retryAttach', { error: OverlayError }),
  Rpc.make('stopOverlay'),
  Rpc.make('selectHook', { payload: { hookId: Schema.String }, error: OverlayError }),
  Rpc.make('insertHookCode', { payload: { code: Schema.String }, error: OverlayError }),
  Rpc.make('setOverlayVisible', { payload: { visible: Schema.Boolean } }),
  Rpc.make('setOverlayPaused', { payload: { paused: Schema.Boolean } }),
  Rpc.make('saveOverlayAppearance', { payload: OverlayAppearance, success: OverlayAppearance }),
  Rpc.make('retryTranslation', { error: OverlayError }),
) {}
