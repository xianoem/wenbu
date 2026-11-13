import { Match, Predicate } from 'effect'
import type {
  AttentionItem,
  ConnectionFailed,
  DetailsToReview,
  GameProgress,
  GameUpdated,
  LinesSkipped,
  RunStopped,
  WatchedReleased,
} from '#contract/Dashboard'
import type { ProblemCount } from '#contract/Diagnostics'
import type { DownloadsState, SourceId } from '#contract/Downloads'
import type { MangaRun } from '#contract/Manga'
import type { PluginsState } from '#contract/Plugins'
import { type DriveSpace, driveLabel } from '#contract/Storage'
import { formatBytes } from '#lib/format'
import type { SettingsPage } from '#lib/navigation'

export type Tone = 'warning' | 'info' | 'destructive'

export type NoticeIcon =
  | 'limit'
  | 'run'
  | 'update'
  | 'skipped'
  | 'connection'
  | 'download'
  | 'sign-in'
  | 'manga'
  | 'drive'
  | 'plugin'
  | 'errors'
  | 'details'
  | 'released'

export type NoticeAction =
  | { readonly kind: 'game'; readonly gameId: string; readonly view?: 'review' | 'changes' }
  | { readonly kind: 'settings'; readonly page: SettingsPage }
  | { readonly kind: 'resume-download'; readonly jobId: string }
  | { readonly kind: 'answer-download'; readonly jobId: string }
  | { readonly kind: 'sign-in'; readonly source: SourceId }
  | { readonly kind: 'screen'; readonly screen: 'plugins' | 'manga' | 'logs' }
  | { readonly kind: 'details-review' }
  | { readonly kind: 'external'; readonly url: string }

type Topic =
  | 'run-limit'
  | 'run-failed'
  | 'run-partial'
  | 'update'
  | 'skipped'
  | 'connection'
  | 'download-failed'
  | 'download-waiting'
  | 'signed-out'
  | 'manga-failed'
  | 'drive'
  | 'plugin-update'
  | 'plugin-failed'
  | 'errors'
  | 'details'
  | 'released'

const topics: Record<Topic, readonly [one: string, many: string]> = {
  'run-limit': ['a run stopped at its limit', '{n} runs stopped at their limits'],
  'run-failed': ['a failed run', '{n} failed runs'],
  'run-partial': ['a run that stopped early', '{n} runs that stopped early'],
  update: ['a game update', '{n} game updates'],
  skipped: ['skipped lines', 'skipped lines in {n} games'],
  connection: ['a failed connection', '{n} failed connections'],
  'download-failed': ['a failed download', '{n} failed downloads'],
  'download-waiting': ['a download waiting for you', '{n} downloads waiting for you'],
  'signed-out': ['a signed-out source', '{n} signed-out sources'],
  'manga-failed': ['a failed manga run', '{n} failed manga runs'],
  drive: ['low space', 'low space on {n} drives'],
  'plugin-update': ['1 plugin update', '{n} plugin updates'],
  'plugin-failed': ['a failed plugin install', '{n} failed plugin installs'],
  errors: ['1 error', '{n} errors'],
  details: ['games to match with DLsite', '{n} games to match with DLsite'],
  released: ['a watched game out', '{n} watched games out'],
}

export interface Notice {
  readonly id: string
  readonly version: string
  readonly topic: Topic
  readonly count: number
  readonly tone: Tone
  readonly icon: NoticeIcon
  readonly title: string
  readonly detail: string
  readonly actionLabel: string
  readonly action: NoticeAction
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

const lastSegment = (folder: string) =>
  folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder

const runNotice = (item: RunStopped): Notice => {
  const left = `${plural(item.linesLeft, 'line')} left`

  if (item.stoppedAtLimit) {
    return {
      id: `run:${item.gameId}`,
      version: item.at,
      topic: 'run-limit',
      count: 1,
      tone: 'warning',
      icon: 'limit',
      title: `${item.title} stopped at its spending limit`,
      detail: left,
      actionLabel: 'Open game',
      action: { kind: 'game', gameId: item.gameId },
    }
  }

  const failed = item.status === 'failed'

  return {
    id: `run:${item.gameId}`,
    version: item.at,
    topic: failed ? 'run-failed' : 'run-partial',
    count: 1,
    tone: failed ? 'destructive' : 'warning',
    icon: 'run',
    title: failed ? `Translating ${item.title} failed` : `Translating ${item.title} stopped early`,
    detail: item.error === undefined ? left : `${left} · ${item.error}`,
    actionLabel: 'Open game',
    action: { kind: 'game', gameId: item.gameId },
  }
}

const updateNotice = (item: GameUpdated): Notice => ({
  id: `update:${item.gameId}`,
  version: `${item.at}:${item.lines}`,
  topic: 'update',
  count: 1,
  tone: 'info',
  icon: 'update',
  title: `${item.title} was updated`,
  detail: `${plural(item.lines, 'line is', 'lines are')} new or changed and not translated yet`,
  actionLabel: 'See changes',
  action: { kind: 'game', gameId: item.gameId, view: 'changes' },
})

const skippedNotice = (item: LinesSkipped): Notice => ({
  id: `skipped:${item.gameId}`,
  version: `${item.lines}`,
  topic: 'skipped',
  count: 1,
  tone: 'warning',
  icon: 'skipped',
  title: `${item.title} kept ${plural(item.lines, 'line')} in the original`,
  detail: 'The last write into the game skipped them',
  actionLabel: 'Review',
  action: { kind: 'game', gameId: item.gameId, view: 'review' },
})

const connectionNotice = (item: ConnectionFailed): Notice => ({
  id: `connection:${item.connectionId}`,
  version: item.message ?? '',
  topic: 'connection',
  count: 1,
  tone: 'destructive',
  icon: 'connection',
  title: `${item.name} failed its connection check`,
  detail: item.message ?? 'Requests through it will fail',
  actionLabel: 'Open Models',
  action: { kind: 'settings', page: 'models' },
})

const detailsNotice = (item: DetailsToReview): Notice => ({
  id: 'details-review',
  version: `${item.games}`,
  topic: 'details',
  count: 1,
  tone: 'info',
  icon: 'details',
  title: `${plural(item.games, 'game needs', 'games need')} a details match`,
  detail: 'DLsite found candidates, but none was sure enough to link alone',
  actionLabel: 'Review',
  action: { kind: 'details-review' },
})

const releasedNotice = (item: WatchedReleased): Notice => ({
  id: `released:${item.code}`,
  version: item.releasedOn,
  topic: 'released',
  count: 1,
  tone: 'info',
  icon: 'released',
  title: `${item.title} is out`,
  detail: `A game you watch on DLsite came out on ${item.releasedOn}`,
  actionLabel: 'Open on DLsite',
  action: {
    kind: 'external',
    url: `https://www.dlsite.com/maniax/work/=/product_id/${item.code}.html`,
  },
})

const fromItem = (item: AttentionItem) =>
  Match.valueTags(item, {
    RunStopped: (stopped) => runNotice(stopped),
    GameUpdated: (updated) => updateNotice(updated),
    LinesSkipped: (skipped) => skippedNotice(skipped),
    ConnectionFailed: (failed) => connectionNotice(failed),
    DetailsToReview: (review) => detailsNotice(review),
    WatchedReleased: (released) => releasedNotice(released),
  })

const sourceNames: Record<SourceId, string> = {
  exhentai: 'ExHentai',
  hdoujin: 'HDoujin',
  hitomi: 'Hitomi',
  nhentai: 'NHentai',
}

const downloadNotices = (state: DownloadsState): ReadonlyArray<Notice> => [
  ...state.jobs.flatMap((job): ReadonlyArray<Notice> => {
    if (job.status === 'waiting') {
      return [
        {
          id: `download:${job.id}`,
          version: `waiting:${job.attempt}`,
          topic: 'download-waiting',
          count: 1,
          tone: 'info',
          icon: 'download',
          title: `${job.title} is waiting for you`,
          detail:
            job.question?.reason === 'signed-out'
              ? `Signed out of ${sourceNames[job.source]}`
              : `Not enough image quota for the last ${plural(job.question?.remaining ?? 0, 'page')}`,
          actionLabel: 'Finish at lower quality',
          action: { kind: 'answer-download', jobId: job.id },
        },
      ]
    }

    if (job.status !== 'failed' && job.status !== 'interrupted') {
      return []
    }

    return [
      {
        id: `download:${job.id}`,
        version: `${job.status}:${job.attempt}`,
        topic: 'download-failed',
        count: 1,
        tone: 'destructive',
        icon: 'download',
        title: `${job.title} stopped downloading`,
        detail:
          job.problem?.message ??
          (job.status === 'interrupted' ? 'Wenbu closed while it ran' : 'The download failed'),
        actionLabel: 'Resume',
        action: { kind: 'resume-download', jobId: job.id },
      },
    ]
  }),
  ...state.accounts
    .filter((account) => account.status === 'expired')
    .map((account): Notice => ({
      id: `account:${account.source}`,
      version: account.status,
      topic: 'signed-out',
      count: 1,
      tone: 'destructive',
      icon: 'sign-in',
      title: `Signed out of ${sourceNames[account.source]}`,
      detail: account.message ?? 'The saved session stopped working',
      actionLabel: 'Sign in',
      action: { kind: 'sign-in', source: account.source },
    })),
]

const mangaNotices = (runs: ReadonlyArray<MangaRun>): ReadonlyArray<Notice> => {
  const latest = new Map<string, MangaRun>()

  for (const run of runs) {
    const known = latest.get(run.folder)

    if (known === undefined || known.startedAt < run.startedAt) {
      latest.set(run.folder, run)
    }
  }

  return [...latest.values()]
    .filter((run) => run.status === 'failed')
    .map((run) => ({
      id: `manga:${run.id}`,
      version: run.status,
      topic: 'manga-failed',
      count: 1,
      tone: 'destructive',
      icon: 'manga',
      title: `Translating ${lastSegment(run.folder)} failed`,
      detail: run.error ?? `${plural(run.pages.failed, 'page')} failed`,
      actionLabel: 'Open Manga',
      action: { kind: 'screen', screen: 'manga' },
    }))
}

const pluginNotices = (state: PluginsState): ReadonlyArray<Notice> =>
  state.plugins.flatMap((plugin): ReadonlyArray<Notice> => {
    if (plugin.install?.error !== undefined && !plugin.install.running) {
      return [
        {
          id: `plugin:${plugin.id}`,
          version: plugin.install.error,
          topic: 'plugin-failed',
          count: 1,
          tone: 'destructive',
          icon: 'plugin',
          title: `${plugin.name} failed to install`,
          detail: plugin.install.error,
          actionLabel: 'Open Plugins',
          action: { kind: 'screen', screen: 'plugins' },
        },
      ]
    }

    const { installed, latest } = plugin

    if (installed === undefined || latest === undefined || latest.version === installed.version) {
      return []
    }

    return [
      {
        id: `plugin:${plugin.id}`,
        version: latest.version,
        topic: 'plugin-update',
        count: 1,
        tone: 'info',
        icon: 'plugin',
        title: `${plugin.name} ${latest.version} is available`,
        detail: `Installed ${installed.version}`,
        actionLabel: 'Open Plugins',
        action: { kind: 'screen', screen: 'plugins' },
      },
    ]
  })

const driveNotices = (drives: ReadonlyArray<DriveSpace>): ReadonlyArray<Notice> =>
  drives
    .filter((drive) => drive.level !== 'ok')
    .map((drive) => ({
      id: `drive:${drive.drive}`,
      version: drive.level,
      topic: 'drive',
      count: 1,
      tone: drive.level === 'critical' ? 'destructive' : 'warning',
      icon: 'drive',
      title: `Drive ${driveLabel(drive.drive)} has ${formatBytes(drive.freeBytes)} free`,
      detail: 'Removing plugins you do not use frees space',
      actionLabel: 'Open Plugins',
      action: { kind: 'screen', screen: 'plugins' },
    }))

const errorNotices = (problems: ProblemCount): ReadonlyArray<Notice> =>
  problems.errors === 0
    ? []
    : [
        {
          id: 'errors',
          version: `${problems.errors}`,
          topic: 'errors',
          count: problems.errors,
          tone: 'destructive',
          icon: 'errors',
          title: `${plural(problems.errors, 'error')} logged since Wenbu started`,
          detail: problems.lastError === undefined ? '' : `Last: ${problems.lastError.message}`,
          actionLabel: 'Open Logs',
          action: { kind: 'screen', screen: 'logs' },
        },
      ]

export interface NoticeSources {
  readonly items: ReadonlyArray<AttentionItem>
  readonly downloads?: DownloadsState | undefined
  readonly mangaRuns?: ReadonlyArray<MangaRun> | undefined
  readonly plugins?: PluginsState | undefined
  readonly drives?: ReadonlyArray<DriveSpace> | undefined
  readonly problems?: ProblemCount | undefined
}

export const noticesOf = (sources: NoticeSources): ReadonlyArray<Notice> => [
  ...sources.items
    .filter((item) => !Predicate.isTagged(item, 'LinesSkipped'))
    .map((item) => fromItem(item)),
  ...(sources.downloads === undefined ? [] : downloadNotices(sources.downloads)),
  ...(sources.mangaRuns === undefined ? [] : mangaNotices(sources.mangaRuns)),
  ...sources.items
    .filter((item) => Predicate.isTagged(item, 'LinesSkipped'))
    .map((item) => fromItem(item)),
  ...(sources.drives === undefined ? [] : driveNotices(sources.drives)),
  ...(sources.plugins === undefined ? [] : pluginNotices(sources.plugins)),
  ...(sources.problems === undefined ? [] : errorNotices(sources.problems)),
]

export const noticeSummary = (notices: ReadonlyArray<Notice>) => {
  const counts = new Map<Topic, number>()

  for (const notice of notices) {
    counts.set(notice.topic, (counts.get(notice.topic) ?? 0) + notice.count)
  }

  return [...counts]
    .map(([topic, count]) => {
      const [one, many] = topics[topic]

      return count === 1 ? one : many.replace('{n}', count.toLocaleString('en'))
    })
    .join(', ')
}

export interface Running {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly progress?: number
}

export interface RunningSources {
  readonly progress?: ReadonlyArray<GameProgress> | undefined
  readonly downloads?: DownloadsState | undefined
  readonly mangaRuns?: ReadonlyArray<MangaRun> | undefined
  readonly plugins?: PluginsState | undefined
}

const fraction = (done: number, total: number | undefined) =>
  total === undefined || total === 0 ? {} : { progress: Math.min(1, done / total) }

export const runningOf = (sources: RunningSources): ReadonlyArray<Running> => [
  ...(sources.progress ?? [])
    .filter((game) => game.lastRun?.status === 'running')
    .map((game) => ({
      id: `run:${game.gameId}`,
      title: game.title,
      detail: 'RPG Maker translation',
      ...fraction(game.translated, game.lines),
    })),
  ...(sources.mangaRuns ?? [])
    .filter((run) => run.status === 'running')
    .map((run) => ({
      id: `manga:${run.id}`,
      title: lastSegment(run.folder),
      detail: `Manga translation · ${run.pages.done} of ${plural(run.pages.total, 'page')}`,
      ...fraction(run.pages.done, run.pages.total),
    })),
  ...(sources.downloads?.jobs ?? [])
    .filter((job) => job.status === 'running' || job.status === 'queued')
    .map((job) => ({
      id: `download:${job.id}`,
      title: job.title,
      detail:
        job.status === 'queued'
          ? `Download · ${sourceNames[job.source]} · queued`
          : `Download · ${sourceNames[job.source]} · ${job.pages.done} of ${job.pages.total === undefined ? '?' : plural(job.pages.total, 'page')}`,
      ...fraction(job.pages.done, job.pages.total),
    })),
  ...(sources.plugins?.plugins ?? []).flatMap((plugin): ReadonlyArray<Running> => {
    const step = plugin.install?.steps.find((candidate) => candidate.status === 'running')

    if (plugin.install?.running !== true) {
      return []
    }

    return [
      {
        id: `plugin:${plugin.id}`,
        title: plugin.name,
        detail: `Plugin install${step === undefined ? '' : ` · ${step.label}`}`,
        ...(step?.progress === undefined ? {} : fraction(step.progress.done, step.progress.total)),
      },
    ]
  }),
]

export const dismissalKey = (notice: Notice) => `${notice.id}|${notice.version}`

export const undismissed = (notices: ReadonlyArray<Notice>, dismissed: ReadonlyArray<string>) => {
  const hidden = new Set(dismissed)

  return notices.filter((notice) => !hidden.has(dismissalKey(notice)))
}

export const dismissalsAfter = (
  notices: ReadonlyArray<Notice>,
  dismissed: ReadonlyArray<string>,
  added: ReadonlyArray<Notice>,
) => {
  const current = new Set(notices.map((notice) => dismissalKey(notice)))

  return [
    ...new Set([
      ...dismissed.filter((key) => current.has(key)),
      ...added.map((notice) => dismissalKey(notice)),
    ]),
  ]
}
