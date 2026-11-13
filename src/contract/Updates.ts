import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const releaseAreas = {
  app: 'Wenbu',
  dashboard: 'Dashboard',
  library: 'Library',
  details: 'Game details',
  translation: 'Game translation',
  overlay: 'Translation Overlay',
  subtitles: 'Subtitles',
  detections: 'Detections',
  'live-controls': 'Live Game Controls',
  ingametext: 'In-game text',
  'game-guide': 'Game Guide',
  memories: 'Memories',
  novels: 'Novels',
  glossaries: 'Glossaries',
  galleries: 'Galleries',
  downloads: 'Downloads',
  manga: 'Manga',
  'manga-editor': 'Manga Editor',
  models: 'Models',
  plugins: 'Plugins',
} as const

export type ReleaseArea = keyof typeof releaseAreas

const scopeAliases: Readonly<Record<string, ReleaseArea>> = {
  llm: 'models',
  glossary: 'glossaries',
  gameguide: 'game-guide',
  livecontrols: 'live-controls',
  'in-game-text': 'ingametext',
  mangaEditor: 'manga-editor',
}

const isReleaseArea = (scope: string): scope is ReleaseArea => Object.hasOwn(releaseAreas, scope)

/** Commit scopes that name no feature, such as `ui` or `core`, are changes to Wenbu itself. */
export const releaseAreaOf = (scope: string | undefined): ReleaseArea => {
  if (scope === undefined) {
    return 'app'
  }

  return isReleaseArea(scope) ? scope : (scopeAliases[scope] ?? 'app')
}

export const ChangeKind = Schema.Literals(['new', 'fixed'])

export type ChangeKind = typeof ChangeKind.Type

export const ReleaseChange = Schema.Struct({
  kind: ChangeKind,
  area: Schema.String,
  text: Schema.String,
})

export type ReleaseChange = typeof ReleaseChange.Type

export const Release = Schema.Struct({
  version: Schema.String,
  date: Schema.String,
  changes: Schema.Array(ReleaseChange),
})

export type Release = typeof Release.Type

const versionParts = (version: string) =>
  (/\d+(\.\d+)*/.exec(version)?.[0] ?? '0').split('.').map((part) => Number(part))

/** Negative when `left` is the older version. Anything after the numbers, such as `(dev)`, is ignored. */
export const compareVersions = (left: string, right: string) => {
  const a = versionParts(left)
  const b = versionParts(right)

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

export const WhatsNew = Schema.Struct({
  version: Schema.String,
  updatedFrom: Schema.optional(Schema.String),
  releases: Schema.Array(Release),
  newAreas: Schema.Array(Schema.String),
})

export type WhatsNew = typeof WhatsNew.Type

export const UpdateStatus = Schema.TaggedStruct('UpdateStatus', {
  state: Schema.Literals(['idle', 'checking', 'downloading', 'ready']),
  version: Schema.optional(Schema.String),
})

export type UpdateStatus = typeof UpdateStatus.Type

export class UpdatesRpc extends RpcGroup.make(
  Rpc.make('getWhatsNew', { success: WhatsNew }),
  Rpc.make('markWhatsNewSeen', { success: WhatsNew }),
  Rpc.make('markAreaSeen', { payload: { area: Schema.String }, success: WhatsNew }),
  Rpc.make('watchUpdate', { success: UpdateStatus, stream: true }),
  Rpc.make('installUpdate'),
) {}
