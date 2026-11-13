import { Cause, Effect, Option, Schema, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import {
  DetailsError,
  type DLsiteList,
  type FindingProgress,
  GameType,
  type RankingPeriod,
  type Reason,
} from '#contract/Details'
import { Core } from '#lib/rpc'

export const detailsKeys = ['details']

export const dlsiteListKeys = ['dlsite-lists']

export const detailsSettingsKeys = ['details-settings']

export const gameSummariesAtom = Core.query('gameSummaries', undefined, {
  reactivityKeys: detailsKeys,
})

export const gameDetailsAtom = Atom.family((gameId: string) =>
  Core.query('gameDetails', { gameId }, { reactivityKeys: detailsKeys }),
)

export const detailsSettingsAtom = Core.query('detailsSettings', undefined, {
  reactivityKeys: detailsSettingsKeys,
})

export const saveDetailsSettingsAtom = Core.mutation('saveDetailsSettings')

export const findMatchesAtom = Core.mutation('findMatches')

export const initialMatchesAtom = Atom.family((gameId: string) =>
  Core.query('findMatches', { gameId }, { reactivityKeys: detailsSettingsKeys }),
)

export const linkWorkAtom = Core.mutation('linkWork')

export const looksLikeCode = (text: string) =>
  /\b[RVB]J\d{6}(\d{2})?\b/i.test(text) || /dlsite\.com\//i.test(text)

export const unlinkWorkAtom = Core.mutation('unlinkWork')

export const markNoDetailsAtom = Core.mutation('markNoDetails')

export const refreshDetailsAtom = Core.mutation('refreshDetails')

export const editDetailsAtom = Core.mutation('editDetails')

export const unlockDetailsAtom = Core.mutation('unlockDetails')

export const translateDetailsAtom = Core.mutation('translateDetails')

export const startFindingAtom = Core.mutation('startFinding')

export const pauseFindingAtom = Core.mutation('pauseFinding')

export const reviewListAtom = Atom.family((_runState: string) =>
  Core.query('reviewList', undefined, { reactivityKeys: detailsKeys }),
)

export const runStateOf = (progress: FindingProgress | undefined) =>
  progress === undefined
    ? ''
    : [progress.running, progress.linked, progress.needsReview, progress.noMatch, progress.failed]
        .map(String)
        .join(':')

export const findingAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchFinding', undefined)
    }),
  ),
)

export const dlsiteListAtom = Atom.family((key: `${DLsiteList}:${RankingPeriod}`) => {
  const [list = 'top', period = 'week'] = key.split(':')

  return Core.query(
    'dlsiteList',
    {
      list: list === 'new' || list === 'upcoming' ? list : 'top',
      period: period === 'day' || period === 'month' ? period : 'week',
    },
    { reactivityKeys: dlsiteListKeys },
  )
})

export const dlsiteGenresAtom = Core.query('dlsiteGenres', undefined)

export const dlsiteWorkAtom = Atom.family((code: string) =>
  Core.query('dlsiteWork', { code }, { reactivityKeys: [...dlsiteListKeys, ...detailsKeys] }),
)

export const circleWorksAtom = Atom.family((circleId: string) =>
  Core.query('circleWorks', { circleId }, { reactivityKeys: [...dlsiteListKeys, ...detailsKeys] }),
)

export const dlsiteFiltersAtom = Core.query('dlsiteFilters', undefined, {
  reactivityKeys: dlsiteListKeys,
})

export const setFilterAtom = Core.mutation('setFilter')

export const watchWorkAtom = Core.mutation('watchWork')

export const workTypeLabels: Record<GameType, string> = {
  RPG: 'RPG',
  ACN: 'Action',
  ADV: 'Adventure',
  SLN: 'Simulation',
  STG: 'Shooter',
  PZL: 'Puzzle',
  QIZ: 'Quiz',
  TBL: 'Board game',
  DNV: 'Digital novel',
  TYP: 'Typing',
  ETC: 'Other',
}

const isGameType = Schema.is(GameType)

export const workTypeLabel = (type: string) => (isGameType(type) ? workTypeLabels[type] : type)

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const formatReleaseDate = (date: string) => {
  const [year, month, day] = date.split('-')
  const name = months[Number(month) - 1]

  return name === undefined || day === undefined ? date : `${name} ${Number(day)}, ${year}`
}

const monthParts: Record<string, string> = { 上旬: 'Early', 中旬: 'Mid', 下旬: 'Late' }

export const formatExpected = (expected: string) => {
  const planned = expected.replaceAll(/\s*(発売予定|Scheduled|Upcoming works)\s*/g, ' ').trim()
  const japanese = /^(\d{4})年(\d{1,2})月(?:(\d{1,2})日|(上旬|中旬|下旬))?$/.exec(planned)
  const name = months[Number(japanese?.[2]) - 1]

  if (planned === '未定') {
    return 'date not set'
  }

  if (japanese === null || name === undefined) {
    return planned
  }

  const [, year, , day, part] = japanese

  if (day !== undefined) {
    return `${name} ${Number(day)}, ${year}`
  }

  return part === undefined ? `${name} ${year}` : `${monthParts[part]} ${name} ${year}`
}

export const formatShortDate = (date: string) => formatReleaseDate(date).replace(/, \d{4}$/, '')

export const formatYen = (yen: number) => `¥${yen.toLocaleString('en-US')}`

export const linkedByLabel = {
  code: 'linked by the code in the folder name',
  search: 'linked by searching for the folder name',
  user: 'linked by you',
} as const

export const mainReason = (reasons: ReadonlyArray<Reason>) =>
  reasons.find((reason) => reason.agrees) ?? reasons[0]

export type ScoreTone = 'high' | 'mid' | 'low'

export const scoreTone = (score: number): ScoreTone => {
  if (score >= 90) {
    return 'high'
  }

  return score >= 60 ? 'mid' : 'low'
}

export const scoreToneClasses: Record<ScoreTone, string> = {
  high: 'text-success',
  mid: 'text-warning',
  low: 'text-muted-foreground',
}

export const scoreBarClasses: Record<ScoreTone, string> = {
  high: 'bg-success',
  mid: 'bg-warning',
  low: 'bg-muted-foreground',
}

const isDetailsError = Schema.is(DetailsError)

export const detailsErrorOf = <E>(cause: Cause.Cause<E>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))

  return isDetailsError(error) ? error : undefined
}
