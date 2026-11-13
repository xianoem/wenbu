import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { SpaceShortfall } from './Storage'

export const SourceId = Schema.Literals(['exhentai', 'hdoujin', 'hitomi', 'nhentai'])

export type SourceId = typeof SourceId.Type

export interface SourceInfo {
  readonly id: SourceId
  readonly name: string
  readonly sites: string
  readonly signIn: boolean
}

export const sources: ReadonlyArray<SourceInfo> = [
  { id: 'exhentai', name: 'ExHentai', sites: 'exhentai.org · e-hentai.org', signIn: true },
  { id: 'hdoujin', name: 'HDoujin', sites: 'hdoujin.org', signIn: true },
  { id: 'hitomi', name: 'Hitomi', sites: 'hitomi.la', signIn: false },
  { id: 'nhentai', name: 'NHentai', sites: 'nhentai.net', signIn: false },
]

export const sourceName = (id: SourceId) => sources.find((source) => source.id === id)?.name ?? id

export const FolderName = Schema.Literals(['title', 'id-title', 'source-title'])

export type FolderName = typeof FolderName.Type

export const TitleLanguage = Schema.Literals(['english', 'japanese'])

export type TitleLanguage = typeof TitleLanguage.Type

export const ExHentaiQuality = Schema.Literals(['original', 'resampled'])

export type ExHentaiQuality = typeof ExHentaiQuality.Type

export const RequestDelay = Schema.Literals(['fast', 'normal', 'careful'])

export type RequestDelay = typeof RequestDelay.Type

/** HDoujin's own format names: `0` is the original, the rest are widths in pixels. */
export const HDoujinQuality = Schema.Literals(['0', '1600', '1280', '980', '780'])

export type HDoujinQuality = typeof HDoujinQuality.Type

export const DownloadSettings = Schema.Struct({
  folder: Schema.String,
  folderName: FolderName,
  titleLanguage: TitleLanguage,
  parallelDownloads: Schema.Int,
  saveDetails: Schema.Boolean,
  resumeOnStart: Schema.Boolean,
  enabledSources: Schema.Array(SourceId),
  exhentaiQuality: ExHentaiQuality,
  exhentaiDelay: RequestDelay,
  hdoujinQuality: HDoujinQuality,
})

export type DownloadSettings = typeof DownloadSettings.Type

export const defaultDownloadSettings: DownloadSettings = {
  folder: '',
  folderName: 'title',
  titleLanguage: 'english',
  parallelDownloads: 2,
  saveDetails: true,
  resumeOnStart: true,
  enabledSources: ['exhentai', 'hdoujin', 'hitomi', 'nhentai'],
  exhentaiQuality: 'original',
  exhentaiDelay: 'normal',
  hdoujinQuality: '0',
}

export const AccountStatus = Schema.Literals([
  'open',
  'signed-out',
  'signing-in',
  'checking',
  'ready',
  'expired',
  'unreachable',
])

export type AccountStatus = typeof AccountStatus.Type

export const SourceAccount = Schema.Struct({
  source: SourceId,
  status: AccountStatus,
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  checkedAt: Schema.optional(Schema.String),
})

export type SourceAccount = typeof SourceAccount.Type

export const DownloadStatus = Schema.Literals([
  'queued',
  'running',
  'waiting',
  'finished',
  'failed',
  'cancelled',
  'interrupted',
])

export type DownloadStatus = typeof DownloadStatus.Type

export const DownloadQuestion = Schema.Struct({
  reason: Schema.Literals(['not-enough-gp', 'signed-out']),
  remaining: Schema.Int,
})

export type DownloadQuestion = typeof DownloadQuestion.Type

export const ProblemReason = Schema.Literals([
  'sign-in',
  'network',
  'limit',
  'not-found',
  'unsupported',
  'disk',
  'failed',
])

export type ProblemReason = typeof ProblemReason.Type

export const DownloadProblem = Schema.Struct({
  reason: ProblemReason,
  message: Schema.String,
  space: Schema.optional(SpaceShortfall),
})

export type DownloadProblem = typeof DownloadProblem.Type

export class DownloadJob extends Schema.Class<DownloadJob>('DownloadJob')({
  id: Schema.String,
  url: Schema.String,
  source: SourceId,
  title: Schema.String,
  folder: Schema.optional(Schema.String),
  status: DownloadStatus,
  attempt: Schema.Int,
  pages: Schema.Struct({ total: Schema.optional(Schema.Int), done: Schema.Int }),
  bytes: Schema.Int,
  bytesPerSecond: Schema.optional(Schema.Finite),
  secondsLeft: Schema.optional(Schema.Finite),
  activity: Schema.optional(Schema.String),
  question: Schema.optional(DownloadQuestion),
  reducedQuality: Schema.Boolean,
  problem: Schema.optional(DownloadProblem),
  createdAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
}) {}

export const DownloadsState = Schema.Struct({
  jobs: Schema.Array(DownloadJob),
  accounts: Schema.Array(SourceAccount),
})

export type DownloadsState = typeof DownloadsState.Type

export const isActive = (status: DownloadStatus) =>
  status === 'queued' || status === 'running' || status === 'waiting'

export const canResume = (job: DownloadJob) =>
  job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted'

export class DownloadError extends Schema.TaggedError<DownloadError>()('DownloadError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'disabled', 'no-folder']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ByJob = { jobId: Schema.String }

const BySource = { source: SourceId }

export class DownloadsRpc extends RpcGroup.make(
  Rpc.make('getDownloadSettings', { success: DownloadSettings }),
  Rpc.make('saveDownloadSettings', {
    payload: DownloadSettings,
    success: DownloadSettings,
    error: DownloadError,
  }),
  Rpc.make('watchDownloads', { success: DownloadsState, stream: true }),
  Rpc.make('startDownload', {
    payload: { url: Schema.String },
    success: Schema.String,
    error: DownloadError,
  }),
  Rpc.make('resumeDownload', { payload: ByJob, error: DownloadError }),
  Rpc.make('cancelDownload', { payload: ByJob }),
  Rpc.make('removeDownload', { payload: ByJob, error: DownloadError }),
  Rpc.make('answerDownload', { payload: { ...ByJob, accept: Schema.Boolean } }),
  Rpc.make('signInToSource', { payload: BySource }),
  Rpc.make('signOutOfSource', { payload: BySource }),
  Rpc.make('checkSource', { payload: BySource }),
) {}
