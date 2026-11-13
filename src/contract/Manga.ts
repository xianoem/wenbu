import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotEnoughSpace, SpaceShortfall } from './Storage'

export const mangaLanguages = [
  { code: 'ENG', name: 'English' },
  { code: 'CHS', name: 'Chinese (Simplified)' },
  { code: 'CHT', name: 'Chinese (Traditional)' },
  { code: 'JPN', name: 'Japanese' },
  { code: 'KOR', name: 'Korean' },
  { code: 'ESP', name: 'Spanish' },
  { code: 'FRA', name: 'French' },
  { code: 'DEU', name: 'German' },
  { code: 'ITA', name: 'Italian' },
  { code: 'PTB', name: 'Portuguese (Brazil)' },
  { code: 'POL', name: 'Polish' },
  { code: 'ROM', name: 'Romanian' },
  { code: 'RUS', name: 'Russian' },
  { code: 'UKR', name: 'Ukrainian' },
  { code: 'CSY', name: 'Czech' },
  { code: 'NLD', name: 'Dutch' },
  { code: 'HUN', name: 'Hungarian' },
  { code: 'TRK', name: 'Turkish' },
  { code: 'VIN', name: 'Vietnamese' },
  { code: 'THA', name: 'Thai' },
  { code: 'IND', name: 'Indonesian' },
  { code: 'FIL', name: 'Filipino (Tagalog)' },
  { code: 'ARA', name: 'Arabic' },
  { code: 'SRP', name: 'Serbian' },
  { code: 'HRV', name: 'Croatian' },
] as const

export const MangaLanguage = Schema.Literals(mangaLanguages.map((language) => language.code))

export type MangaLanguage = typeof MangaLanguage.Type

export const languageName = (code: MangaLanguage) =>
  mangaLanguages.find((language) => language.code === code)?.name ?? code

export const bundledFonts = ['Anime Ace', 'Anime Ace 3', 'Comic Shanns'] as const

export const MangaSettings = Schema.Struct({
  presetId: Schema.String,
  targetLanguage: MangaLanguage,
  timeoutSeconds: Schema.Int,
  retryAttempts: Schema.Int,
  parallelRequests: Schema.Int,
  font: Schema.String,
  minFontSize: Schema.Int,
  maxFontSize: Schema.Int,
  /** `auto`, or a colour like `#1a1a1a`. */
  textColor: Schema.String,
  textBorder: Schema.Boolean,
  borderColor: Schema.String,
  uppercase: Schema.Boolean,
  useGpu: Schema.Boolean,
  detectionSize: Schema.Literals([1536, 2048, 2560]),
  inpainting: Schema.Literals(['regions', 'page']),
  inpaintingSize: Schema.Literals([1024, 1536, 2048, 2560]),
  supersampling: Schema.Literals([1, 2, 4]),
  pagesAhead: Schema.Int,
  outputFolderName: Schema.String,
  outputFormat: Schema.Literals(['source', 'png', 'webp', 'jpeg']),
  outputQuality: Schema.Int,
  existingPages: Schema.Literals(['skip', 'overwrite']),
})

export type MangaSettings = typeof MangaSettings.Type

export const defaultMangaSettings: MangaSettings = {
  presetId: '',
  targetLanguage: 'ENG',
  timeoutSeconds: 60,
  retryAttempts: 3,
  parallelRequests: 3,
  font: 'Anime Ace',
  minFontSize: 12,
  maxFontSize: 100,
  textColor: 'auto',
  textBorder: true,
  borderColor: '#ffffff',
  uppercase: false,
  useGpu: true,
  detectionSize: 2048,
  inpainting: 'regions',
  inpaintingSize: 2048,
  supersampling: 4,
  pagesAhead: 3,
  outputFolderName: 'translated',
  outputFormat: 'source',
  outputQuality: 95,
  existingPages: 'skip',
}

export const MangaFolder = Schema.Struct({
  folder: Schema.String,
  outputFolder: Schema.String,
  pages: Schema.Int,
  translatedPages: Schema.Int,
})

export type MangaFolder = typeof MangaFolder.Type

export const PageStage = Schema.Literals([
  'detecting',
  'reading',
  'translating',
  'cleaning',
  'lettering',
])

export type PageStage = typeof PageStage.Type

export const MangaRunStatus = Schema.Literals([
  'running',
  'translated',
  'partial',
  'failed',
  'cancelled',
])

export type MangaRunStatus = typeof MangaRunStatus.Type

export const MangaRunUsage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  costUsd: Schema.optional(Schema.Finite),
})

export type MangaRunUsage = typeof MangaRunUsage.Type

export const PageProblem = Schema.Struct({ page: Schema.String, message: Schema.String })

export type PageProblem = typeof PageProblem.Type

export const RecentPage = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(['done', 'failed', 'running', 'pending']),
  stage: Schema.optional(PageStage),
  regions: Schema.optional(Schema.Int),
  seconds: Schema.optional(Schema.Finite),
  message: Schema.optional(Schema.String),
})

export type RecentPage = typeof RecentPage.Type

export class MangaRun extends Schema.Class<MangaRun>('MangaRun')({
  id: Schema.String,
  folder: Schema.String,
  outputFolder: Schema.String,
  status: MangaRunStatus,
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  presetName: Schema.String,
  targetLanguage: MangaLanguage,
  pages: Schema.Struct({
    total: Schema.Int,
    done: Schema.Int,
    failed: Schema.Int,
    skipped: Schema.Int,
  }),
  activity: Schema.optional(Schema.String),
  recentPages: Schema.optional(Schema.Array(RecentPage)),
  usage: MangaRunUsage,
  problems: Schema.Array(PageProblem),
  seconds: Schema.optional(Schema.Finite),
  error: Schema.optional(Schema.String),
  space: Schema.optional(SpaceShortfall),
}) {}

export const MangaRuntimeStatus = Schema.Literals([
  'not-installed',
  'stopped',
  'starting',
  'loading-models',
  'ready',
  'busy',
  'failed',
])

export type MangaRuntimeStatus = typeof MangaRuntimeStatus.Type

export const MangaRuntimeState = Schema.Struct({
  status: MangaRuntimeStatus,
  device: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})

export type MangaRuntimeState = typeof MangaRuntimeState.Type

export class MangaError extends Schema.TaggedError<MangaError>()('MangaError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'plugin-missing', 'failed']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ByFolder = { folder: Schema.String }

const ByRun = { runId: Schema.String }

export class MangaRpc extends RpcGroup.make(
  Rpc.make('getMangaSettings', { success: MangaSettings }),
  Rpc.make('saveMangaSettings', {
    payload: MangaSettings,
    success: MangaSettings,
    error: MangaError,
  }),
  Rpc.make('checkMangaFolder', { payload: ByFolder, success: MangaFolder, error: MangaError }),
  Rpc.make('startMangaRun', {
    payload: ByFolder,
    success: Schema.String,
    error: Schema.Union([MangaError, NotEnoughSpace]),
  }),
  Rpc.make('cancelMangaRun', { payload: ByRun }),
  Rpc.make('removeMangaRun', { payload: ByRun, error: MangaError }),
  Rpc.make('watchMangaRuns', { success: Schema.Array(MangaRun), stream: true }),
  Rpc.make('watchMangaRuntime', { success: MangaRuntimeState, stream: true }),
) {}
