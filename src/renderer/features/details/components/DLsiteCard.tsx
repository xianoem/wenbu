import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BellIcon,
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  ClockIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type {
  DLsiteFilters,
  DLsiteList,
  FilterTarget,
  ListedWork,
  RankingPeriod,
} from '#contract/Details'
import { formatDay } from '#lib/format'
import { gameIdAtom, openWorkAtom, screenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { OverflowText } from '#ui/overflow-text'
import { Skeleton } from '#ui/skeleton'
import {
  detailsErrorOf,
  dlsiteListAtom,
  dlsiteListKeys,
  formatExpected,
  formatShortDate,
  formatYen,
  dlsiteFiltersAtom,
  setFilterAtom,
  watchWorkAtom,
  workTypeLabels,
} from '../details'
import { GameTypeMenu } from './GameTypeMenu'
import { TagMenu } from './TagMenu'

const lists: ReadonlyArray<{ readonly id: DLsiteList; readonly label: string }> = [
  { id: 'top', label: 'Top games' },
  { id: 'new', label: 'New' },
  { id: 'upcoming', label: 'Upcoming' },
]

const periods: ReadonlyArray<{ readonly id: RankingPeriod; readonly label: string }> = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const pageSize = 20

function Segmented<Id extends string>({
  options,
  value,
  onChange,
}: {
  readonly options: ReadonlyArray<{ readonly id: Id; readonly label: string }>
  readonly value: Id
  readonly onChange: (value: Id) => void
}) {
  return (
    <div className="inline-flex rounded-full bg-muted/60 p-[3px]">
      {options.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          aria-pressed={value === option.id}
          className={cn(
            'h-7 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
            value === option.id && 'bg-background font-medium text-foreground shadow-card',
          )}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

const badge =
  'absolute top-1.5 inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] font-medium backdrop-blur-sm'

function WorkTile({ work, list }: { readonly work: ListedWork; readonly list: DLsiteList }) {
  const setGameId = useAtomSet(gameIdAtom)
  const setScreen = useAtomSet(screenAtom)
  const setOpenWork = useAtomSet(openWorkAtom)
  const watch = useAtomSet(watchWorkAtom, { mode: 'promiseExit' })

  const open = () => {
    if (work.gameId === null) {
      return setOpenWork(work.code)
    }

    setGameId(work.gameId)
    setScreen('library')
  }

  const facts =
    list === 'upcoming'
      ? [work.circle]
      : [work.circle, work.price === null ? undefined : formatYen(work.price)]

  return (
    <div className="group relative min-w-0">
      <Button
        variant="ghost"
        aria-label={`Open ${work.title}`}
        className="h-auto w-full flex-col items-stretch gap-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent"
        onClick={open}
      >
        <span className="relative block aspect-4/3 overflow-hidden rounded-xl bg-muted shadow-card">
          {work.coverUrl === null ? null : (
            <img src={work.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
          )}
          {work.rank === null ? null : (
            <span className={cn(badge, 'left-1.5 bg-black/45 font-bold text-white')}>
              {work.rank}
            </span>
          )}
          {work.expected === null ? null : (
            <span className={cn(badge, 'left-1.5 bg-black/45 text-white')}>
              <CalendarBlankIcon />
              {formatExpected(work.expected).replace(/, \d{4}$/, '')}
            </span>
          )}
          {work.gameId === null ? null : (
            <span className={cn(badge, 'right-1.5 bg-success/90 text-black')}>
              <CheckIcon />
              In library
            </span>
          )}
        </span>
        <OverflowText className="mt-2 text-sm font-semibold">{work.title}</OverflowText>
        <OverflowText className="text-xs text-muted-foreground">
          {facts.filter(Boolean).join(' · ')}
          {list === 'new' && work.releasedOn !== null
            ? ` · ${formatShortDate(work.releasedOn)}`
            : ''}
        </OverflowText>
      </Button>
      {list === 'upcoming' && work.gameId === null ? (
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={work.watched}
          aria-label={work.watched ? 'Stop watching' : 'Watch'}
          className={cn(
            'absolute top-1.5 right-1.5 h-[22px] gap-1 rounded-full px-2 text-[11px] font-medium backdrop-blur-sm',
            work.watched
              ? 'bg-warning/90 text-black hover:bg-warning'
              : 'bg-black/45 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white',
          )}
          onClick={() =>
            void watch({
              payload: { code: work.code, watched: !work.watched },
              reactivityKeys: dlsiteListKeys,
            })
          }
        >
          <BellIcon weight={work.watched ? 'fill' : 'regular'} />
          {work.watched ? 'Watching' : 'Watch'}
        </Button>
      ) : null}
    </div>
  )
}

const noFilters: DLsiteFilters = { tags: [], gameTypes: [] }

interface Chip {
  readonly key: string
  readonly name: string
  readonly target: FilterTarget
}

const chipsOf = (filters: DLsiteFilters): ReadonlyArray<Chip> => [
  ...filters.gameTypes.map((type) => ({
    key: `type:${type}`,
    name: workTypeLabels[type],
    target: { gameType: type },
  })),
  ...filters.tags.map((tag) => ({ key: `tag:${tag.id}`, name: tag.name, target: { tag } })),
]

function FilterChips({ chips }: { readonly chips: ReadonlyArray<Chip> }) {
  const setFilter = useAtomSet(setFilterAtom, { mode: 'promiseExit' })

  if (chips.length === 0) {
    return null
  }

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-6 items-center gap-0.5 rounded-full bg-primary pr-0.5 pl-2.5 text-xs text-primary-foreground"
        >
          {chip.name}
          <Button
            variant="ghost"
            aria-label={`Remove ${chip.name}`}
            className="size-5 rounded-full p-0 text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() =>
              void setFilter({
                payload: { target: chip.target, chosen: false },
                reactivityKeys: dlsiteListKeys,
              })
            }
          >
            <XIcon className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  )
}

function LoadingTiles() {
  return (
    <div aria-label="Loading DLsite's list" aria-busy className="mt-4 grid grid-cols-5 gap-4">
      {Array.from({ length: pageSize }, (_, at) => (
        <div key={at} className="min-w-0">
          <Skeleton className="aspect-4/3 rounded-xl" />
          <Skeleton className="mt-2 h-4 w-4/5" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function Works({ list, period }: { readonly list: DLsiteList; readonly period: RankingPeriod }) {
  const result = useAtomValue(dlsiteListAtom(`${list}:${period}`))
  const [page, setPage] = useState(0)

  if (AsyncResult.isFailure(result)) {
    return (
      <p className="mt-4 text-sm text-destructive">
        {detailsErrorOf(result.cause)?.message ?? 'DLsite could not be reached.'}
      </p>
    )
  }

  if (!AsyncResult.isSuccess(result)) {
    return <LoadingTiles />
  }

  const { works, fetchedAt, problem } = result.value
  const pages = Math.max(1, Math.ceil(works.length / pageSize))
  const current = Math.min(page, pages - 1)
  const shown = works.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <>
      {works.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No game on this list has every tag and game type you picked.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-5 gap-4">
          {shown.map((work) => (
            <WorkTile key={work.code} work={work} list={list} />
          ))}
        </div>
      )}
      <div className="mt-3.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClockIcon />
        {fetchedAt === null ? 'Not fetched yet' : `Updated ${formatDay(fetchedAt).toLowerCase()}`}
        {problem === null ? null : <span className="text-warning">· {problem}</span>}
        <span className="flex-1" />
        {pages > 1 ? (
          <>
            <span className="tabular-nums">
              {current * pageSize + 1}–{current * pageSize + shown.length} of {works.length}
            </span>
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="Previous page"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <CaretLeftIcon />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="Next page"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <CaretRightIcon />
            </Button>
          </>
        ) : null}
      </div>
    </>
  )
}

export function DLsiteCard() {
  const [list, setList] = useState<DLsiteList>('top')
  const [period, setPeriod] = useState<RankingPeriod>('week')
  const filters = useAtomValue(dlsiteFiltersAtom)
  const chosen = AsyncResult.isSuccess(filters) ? filters.value : noFilters

  return (
    <section className="rounded-3xl bg-card px-[22px] pt-[18px] pb-5 shadow-card">
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="size-1.5 rounded-full bg-info" />
          DLsite
        </h2>
        <Segmented options={lists} value={list} onChange={setList} />
        <span className="flex-1" />
        {list === 'top' ? (
          <Segmented options={periods} value={period} onChange={setPeriod} />
        ) : null}
        <GameTypeMenu chosen={chosen.gameTypes} />
        <TagMenu chosen={chosen.tags} />
      </div>
      <FilterChips chips={chipsOf(chosen)} />
      <Works key={`${list}:${period}`} list={list} period={period} />
    </section>
  )
}
