import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { GalleryVersion } from './Galleries'

export const CloseAction = Schema.Literals(['tray', 'quit'])

export type CloseAction = typeof CloseAction.Type

export const TrayClick = Schema.Literals(['panel', 'window'])

export type TrayClick = typeof TrayClick.Type

export const LinkAction = Schema.Literals(['ask', 'download'])

export type LinkAction = typeof LinkAction.Type

export const NoticeKind = Schema.Literals(['runs', 'chapters', 'downloads', 'releases'])

export type NoticeKind = typeof NoticeKind.Type

export const BackgroundSettings = Schema.Struct({
  closeAction: CloseAction,
  closeAsked: Schema.Boolean,
  startWithWindows: Schema.Boolean,
  trayClick: TrayClick,
  notify: Schema.Struct({
    runs: Schema.Boolean,
    chapters: Schema.Boolean,
    downloads: Schema.Boolean,
    releases: Schema.Boolean,
  }),
  watchLinks: Schema.Boolean,
  linkAction: LinkAction,
})

export type BackgroundSettings = typeof BackgroundSettings.Type

export const defaultBackgroundSettings: BackgroundSettings = {
  closeAction: 'tray',
  closeAsked: false,
  startWithWindows: false,
  trayClick: 'panel',
  notify: { runs: true, chapters: true, downloads: true, releases: true },
  watchLinks: false,
  linkAction: 'ask',
}

export const ActivityKind = Schema.Literals([
  'download',
  'translation',
  'manga',
  'overlay',
  'subtitles',
])

export type ActivityKind = typeof ActivityKind.Type

export const ActivityItem = Schema.Struct({
  id: Schema.String,
  kind: ActivityKind,
  title: Schema.String,
  done: Schema.optional(Schema.Int),
  total: Schema.optional(Schema.Int),
})

export type ActivityItem = typeof ActivityItem.Type

const percent = (item: ActivityItem) =>
  item.done === undefined || item.total === undefined || item.total === 0
    ? ''
    : ` · ${Math.floor((item.done / item.total) * 100)}%`

const activityVerb: Record<ActivityKind, (title: string) => string> = {
  download: (title) => `Downloading ${title}`,
  translation: (title) => `Translating ${title}`,
  manga: (title) => `Translating manga ${title}`,
  overlay: (title) => `Overlay on ${title}`,
  subtitles: () => 'Live Subtitles',
}

export const activityLabel = (item: ActivityItem) =>
  `${activityVerb[item.kind](item.title)}${percent(item)}`

export const OpenHome = Schema.TaggedStruct('OpenHome', {})

export const OpenGeneralSettings = Schema.TaggedStruct('OpenGeneralSettings', {})

export const OpenGame = Schema.TaggedStruct('OpenGame', { gameId: Schema.String })

export const OpenNovel = Schema.TaggedStruct('OpenNovel', {
  novelId: Schema.String,
  chapter: Schema.Int,
})

export const OpenGallery = Schema.TaggedStruct('OpenGallery', {
  folder: Schema.String,
  page: Schema.Int,
  version: GalleryVersion,
})

export const AppTarget = Schema.Union([
  OpenHome,
  OpenGeneralSettings,
  OpenGame,
  OpenNovel,
  OpenGallery,
])

export type AppTarget = typeof AppTarget.Type

export class BackgroundRpc extends RpcGroup.make(
  Rpc.make('getBackgroundSettings', { success: BackgroundSettings }),
  Rpc.make('saveBackgroundSettings', {
    payload: BackgroundSettings,
    success: BackgroundSettings,
  }),
  Rpc.make('watchActivity', { success: Schema.Array(ActivityItem), stream: true }),
) {}
