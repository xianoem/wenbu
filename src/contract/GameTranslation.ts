import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { ModelPrice } from './Llm'
import { NotEnoughSpace } from './Storage'

export const coverageKeys = [
  'messages',
  'scrollingText',
  'choices',
  'speakerNames',
  'nameChanges',
  'mapEvents',
  'commonEvents',
  'battleEvents',
  'mapDisplayNames',
  'mapListNames',
  'actors',
  'classes',
  'skills',
  'items',
  'weapons',
  'armors',
  'enemies',
  'states',
  'systemTerms',
] as const

export const CoverageKey = Schema.Literals(coverageKeys)

export type CoverageKey = typeof CoverageKey.Type

export const Coverage = Schema.Record(CoverageKey, Schema.Boolean)

export type Coverage = typeof Coverage.Type

export const TranslationMode = Schema.Literals(['stable', 'balanced', 'fast', 'custom'])

export type TranslationMode = typeof TranslationMode.Type

export const SpendLimit = Schema.Struct({
  usd: Schema.optional(Schema.Finite),
  tokens: Schema.optional(Schema.Int),
})

export type SpendLimit = typeof SpendLimit.Type

export const TranslationSettings = Schema.Struct({
  presetId: Schema.String,
  targetLanguage: Schema.String,
  mode: TranslationMode,
  workers: Schema.Int,
  chunkTokens: Schema.Int,
  timeoutSeconds: Schema.Int,
  retryRounds: Schema.Int,
  coverage: Coverage,
  filters: Schema.Struct({
    skipEmpty: Schema.Boolean,
    skipPluginTags: Schema.Boolean,
    skipFilenames: Schema.Boolean,
    skipNumbers: Schema.Boolean,
    skipPunctuationOnly: Schema.Boolean,
    skipCodeLike: Schema.Boolean,
    includeLatinText: Schema.Boolean,
  }),
  reuseDuplicates: Schema.Boolean,
  spendLimit: Schema.optional(SpendLimit),
  confirmAboveUsd: Schema.optional(Schema.Finite),
  formatting: Schema.Struct({
    preserveControlCodes: Schema.Boolean,
    preservePlaceholders: Schema.Boolean,
    preserveLineBreaks: Schema.Boolean,
    rejectBrokenFormatting: Schema.Boolean,
    maxLineLength: Schema.optional(Schema.Int),
  }),
})

export type TranslationSettings = typeof TranslationSettings.Type

export type ModeValues = Pick<
  TranslationSettings,
  'workers' | 'chunkTokens' | 'timeoutSeconds' | 'retryRounds'
>

export const modeValues: Record<Exclude<TranslationMode, 'custom'>, ModeValues> = {
  stable: { workers: 12, chunkTokens: 384, timeoutSeconds: 180, retryRounds: 16 },
  balanced: { workers: 64, chunkTokens: 512, timeoutSeconds: 120, retryRounds: 16 },
  fast: { workers: 112, chunkTokens: 768, timeoutSeconds: 120, retryRounds: 8 },
}

/** Everything except battle events and map list names, which some games use as labels. */
export const standardCoverage: Coverage = {
  messages: true,
  scrollingText: true,
  choices: true,
  speakerNames: true,
  nameChanges: true,
  mapEvents: true,
  commonEvents: true,
  battleEvents: false,
  mapDisplayNames: true,
  mapListNames: false,
  actors: true,
  classes: true,
  skills: true,
  items: true,
  weapons: true,
  armors: true,
  enemies: true,
  states: true,
  systemTerms: true,
}

export const defaultTranslationSettings: TranslationSettings = {
  presetId: '',
  targetLanguage: 'English',
  mode: 'balanced',
  ...modeValues.balanced,
  coverage: standardCoverage,
  filters: {
    skipEmpty: true,
    skipPluginTags: true,
    skipFilenames: true,
    skipNumbers: true,
    skipPunctuationOnly: true,
    skipCodeLike: true,
    includeLatinText: true,
  },
  reuseDuplicates: false,
  formatting: {
    preserveControlCodes: true,
    preservePlaceholders: true,
    preserveLineBreaks: true,
    rejectBrokenFormatting: true,
  },
}

export const StepId = Schema.Literals(['prepare', 'extract', 'translate', 'apply'])

export type StepId = typeof StepId.Type

export const stepIds: ReadonlyArray<StepId> = ['prepare', 'extract', 'translate', 'apply']

export const StepStatus = Schema.Literals([
  'pending',
  'running',
  'done',
  'warning',
  'failed',
  'cancelled',
])

export type StepStatus = typeof StepStatus.Type

export const TranslationStep = Schema.Struct({
  id: StepId,
  status: StepStatus,
  summary: Schema.optional(Schema.String),
  notes: Schema.Array(Schema.String),
})

export type TranslationStep = typeof TranslationStep.Type

export const RunStatus = Schema.Literals([
  'running',
  'translated',
  'partial',
  'failed',
  'cancelled',
])

export type RunStatus = typeof RunStatus.Type

export const TranslationScope = Schema.Literals(['missing', 'changed'])

export type TranslationScope = typeof TranslationScope.Type

export const RunUsage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.optional(Schema.Finite),
})

export type RunUsage = typeof RunUsage.Type

export const TranslationEstimate = Schema.Struct({
  scope: TranslationScope,
  lines: Schema.Int,
  batches: Schema.Int,
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.optional(Schema.Struct({ low: Schema.Finite, high: Schema.Finite })),
  price: Schema.optional(ModelPrice),
})

export type TranslationEstimate = typeof TranslationEstimate.Type

export class TranslationRun extends Schema.Class<TranslationRun>('TranslationRun')({
  id: Schema.String,
  gameId: Schema.String,
  status: RunStatus,
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  presetName: Schema.String,
  targetLanguage: Schema.String,
  scope: Schema.optional(TranslationScope),
  lines: Schema.Struct({ total: Schema.Int, translated: Schema.Int, written: Schema.Int }),
  usage: RunUsage,
  spendLimit: Schema.optional(SpendLimit),
  stopped: Schema.optional(
    Schema.Struct({ reason: Schema.Literal('spend-limit'), limit: SpendLimit }),
  ),
  steps: Schema.Array(TranslationStep),
  error: Schema.optional(Schema.String),
}) {}

export const LineOrigin = Schema.Literals(['model', 'edited', 'imported'])

export type LineOrigin = typeof LineOrigin.Type

export const LineChange = Schema.Literals(['new', 'changed'])

export type LineChange = typeof LineChange.Type

export const WriteSkip = Schema.Literals([
  'source-mismatch',
  'broken-formatting',
  'missing-location',
])

export type WriteSkip = typeof WriteSkip.Type

export const TranslationLine = Schema.Struct({
  entryId: Schema.String,
  file: Schema.String,
  pointer: Schema.String,
  context: Schema.String,
  sourceText: Schema.String,
  translatedText: Schema.optional(Schema.String),
  origin: LineOrigin,
  locked: Schema.Boolean,
  applied: Schema.Boolean,
  writeSkipped: Schema.optional(WriteSkip),
  change: Schema.optional(LineChange),
  previousSource: Schema.optional(Schema.String),
  previousText: Schema.optional(Schema.String),
})

export type TranslationLine = typeof TranslationLine.Type

export const LineFilter = Schema.Literals([
  'all',
  'review',
  'missing',
  'skipped',
  'too-long',
  'edited',
  'locked',
])

export type LineFilter = typeof LineFilter.Type

export const LineCounts = Schema.Struct({
  all: Schema.Int,
  review: Schema.Int,
  missing: Schema.Int,
  pending: Schema.Int,
  skipped: Schema.Int,
  tooLong: Schema.Int,
  edited: Schema.Int,
  locked: Schema.Int,
  unapplied: Schema.Int,
})

export type LineCounts = typeof LineCounts.Type

export const LinePage = Schema.Struct({
  lines: Schema.Array(TranslationLine),
  total: Schema.Int,
  counts: LineCounts,
})

export type LinePage = typeof LinePage.Type

export const LineDetail = Schema.Struct({
  line: TranslationLine,
  before: Schema.optional(TranslationLine),
  sameSource: Schema.Array(TranslationLine),
})

export type LineDetail = typeof LineDetail.Type

export const RemovedLine = Schema.Struct({
  file: Schema.String,
  context: Schema.String,
  sourceText: Schema.String,
  translatedText: Schema.optional(Schema.String),
})

export type RemovedLine = typeof RemovedLine.Type

export const GameUpdateSummary = Schema.Struct({
  detectedAt: Schema.String,
  changed: Schema.Int,
  added: Schema.Int,
  removed: Schema.Int,
  moved: Schema.Int,
  unchanged: Schema.Int,
  pending: Schema.Int,
  review: Schema.Int,
  active: Schema.Boolean,
  install: Schema.optional(
    Schema.Struct({
      archive: Schema.String,
      version: Schema.optional(Schema.String),
      installedAt: Schema.String,
      canUndo: Schema.Boolean,
    }),
  ),
})

export type GameUpdateSummary = typeof GameUpdateSummary.Type

export const SourceChanges = Schema.Struct({
  lines: Schema.Array(TranslationLine),
  removed: Schema.Array(RemovedLine),
})

export type SourceChanges = typeof SourceChanges.Type

export const SourceChangeAction = Schema.Literals(['keep', 'translate'])

export type SourceChangeAction = typeof SourceChangeAction.Type

export const UpdateCheckStatus = Schema.Literals(['ok', 'warning', 'blocked'])

export const UpdateCheck = Schema.Struct({
  id: Schema.Literals(['same-game', 'fits', 'safe', 'newer', 'saves', 'space']),
  status: UpdateCheckStatus,
  title: Schema.String,
  detail: Schema.String,
})

export type UpdateCheck = typeof UpdateCheck.Type

export const UpdateInspection = Schema.Struct({
  archive: Schema.String,
  archiveBytes: Schema.Int,
  version: Schema.optional(Schema.String),
  checks: Schema.Array(UpdateCheck),
  replaced: Schema.Int,
  added: Schema.Int,
  saves: Schema.Int,
  bytes: Schema.Int,
  blocked: Schema.Boolean,
})

export type UpdateInspection = typeof UpdateInspection.Type

export const InstallStep = Schema.Literals([
  'restore',
  'unpack',
  'backup',
  'move',
  'settle',
  'done',
])

export type InstallStep = typeof InstallStep.Type

export const InstallProgress = Schema.Struct({
  step: InstallStep,
  done: Schema.Int,
  total: Schema.Int,
})

export type InstallProgress = typeof InstallProgress.Type

export const ExportFormat = Schema.Literals(['data-files', 'csv', 'json', 'mtool'])

export type ExportFormat = typeof ExportFormat.Type

export const ExportResult = Schema.Struct({
  path: Schema.String,
  lines: Schema.Int,
  files: Schema.Int,
})

export type ExportResult = typeof ExportResult.Type

export class TranslationError extends Schema.TaggedError<TranslationError>()('TranslationError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'failed']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ByGame = { gameId: Schema.String }

const ByLine = { gameId: Schema.String, entryId: Schema.String }

export class GameTranslationRpc extends RpcGroup.make(
  Rpc.make('getTranslationSettings', { success: TranslationSettings }),
  Rpc.make('saveTranslationSettings', {
    payload: TranslationSettings,
    success: TranslationSettings,
    error: TranslationError,
  }),
  Rpc.make('startTranslation', {
    payload: {
      ...ByGame,
      scope: Schema.optional(TranslationScope),
      spendLimit: Schema.optional(SpendLimit),
    },
    error: Schema.Union([TranslationError, NotEnoughSpace]),
  }),
  Rpc.make('estimateTranslation', {
    payload: { ...ByGame, scope: Schema.optional(TranslationScope) },
    success: TranslationEstimate,
    error: TranslationError,
  }),
  Rpc.make('setRunSpendLimit', { payload: { ...ByGame, limit: SpendLimit } }),
  Rpc.make('cancelTranslation', { payload: ByGame }),
  Rpc.make('removeTranslation', { payload: ByGame, error: TranslationError }),
  Rpc.make('listTranslationRuns', { payload: ByGame, success: Schema.Array(TranslationRun) }),
  Rpc.make('listTranslationLines', {
    payload: { ...ByGame, filter: LineFilter, query: Schema.String, limit: Schema.Int },
    success: LinePage,
    error: TranslationError,
  }),
  Rpc.make('getTranslationLine', { payload: ByLine, success: LineDetail, error: TranslationError }),
  Rpc.make('saveTranslationLine', {
    payload: { ...ByLine, text: Schema.String },
    success: TranslationLine,
    error: TranslationError,
  }),
  Rpc.make('setTranslationLineLocked', {
    payload: { ...ByLine, locked: Schema.Boolean },
    success: TranslationLine,
    error: TranslationError,
  }),
  Rpc.make('retranslateLine', {
    payload: ByLine,
    success: TranslationLine,
    error: TranslationError,
  }),
  Rpc.make('shortenTranslationLine', {
    payload: ByLine,
    success: TranslationLine,
    error: TranslationError,
  }),
  Rpc.make('applyTranslationEdits', {
    payload: ByGame,
    error: Schema.Union([TranslationError, NotEnoughSpace]),
  }),
  Rpc.make('restoreTranslatedFiles', {
    payload: ByGame,
    error: Schema.Union([TranslationError, NotEnoughSpace]),
  }),
  Rpc.make('inspectGameUpdate', {
    payload: { ...ByGame, archive: Schema.String },
    success: UpdateInspection,
    error: TranslationError,
  }),
  Rpc.make('installGameUpdate', {
    payload: { ...ByGame, archive: Schema.String, acceptWarnings: Schema.Boolean },
    error: Schema.Union([TranslationError, NotEnoughSpace]),
  }),
  Rpc.make('watchGameUpdateInstall', {
    payload: ByGame,
    success: Schema.OptionFromNullOr(InstallProgress),
    stream: true,
  }),
  Rpc.make('undoGameUpdate', {
    payload: ByGame,
    error: Schema.Union([TranslationError, NotEnoughSpace]),
  }),
  Rpc.make('exportTranslation', {
    payload: { ...ByGame, format: ExportFormat, target: Schema.String, readme: Schema.Boolean },
    success: ExportResult,
    error: TranslationError,
  }),
  Rpc.make('getGameUpdate', {
    payload: ByGame,
    success: Schema.OptionFromNullOr(GameUpdateSummary),
    error: TranslationError,
  }),
  Rpc.make('listSourceChanges', {
    payload: ByGame,
    success: SourceChanges,
    error: TranslationError,
  }),
  Rpc.make('setSourceChangeAction', {
    payload: { ...ByLine, action: SourceChangeAction },
    success: TranslationLine,
    error: TranslationError,
  }),
  Rpc.make('watchTranslation', {
    payload: ByGame,
    success: Schema.OptionFromNullOr(TranslationRun),
    stream: true,
  }),
) {}
