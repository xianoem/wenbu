import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import { CaretLeftIcon, HashIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import type { ReactNode } from 'react'
import { returnScreenAtom, screenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { LevelDot } from './components/LevelDot'
import {
  featureFilterAtom,
  featureLabel,
  formatLaunch,
  type LevelFilter,
  launchesAtom,
  launchFilterAtom,
  levelFilterAtom,
  logAtom,
  matchesLevel,
} from './diagnostics'

const levels: ReadonlyArray<{ readonly filter: LevelFilter; readonly label: string }> = [
  { filter: 'all', label: 'All' },
  { filter: 'error', label: 'Errors' },
  { filter: 'warn', label: 'Warnings' },
  { filter: 'info', label: 'Info' },
  { filter: 'debug', label: 'Debug' },
]

function GroupLabel({ children }: { readonly children: string }) {
  return (
    <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground first:pt-1">
      {children}
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
  count,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly children: ReactNode
  readonly count?: number
}) {
  return (
    <Button
      variant="ghost"
      aria-pressed={active}
      className={cn(
        'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
      )}
      onClick={onClick}
    >
      {children}
      {count === undefined ? null : (
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{count}</span>
      )}
    </Button>
  )
}

function LaunchPicker() {
  const result = useAtomValue(launchesAtom)
  const [launch, setLaunch] = useAtom(launchFilterAtom)
  const launches = AsyncResult.isSuccess(result) ? result.value : []

  const current = launches.find((candidate) => candidate.current)?.id ?? ''

  const choices = launches.map((candidate) => ({
    value: candidate.id,
    label: candidate.current ? 'This launch' : formatLaunch(candidate.id),
  }))

  return (
    <Select
      items={Object.fromEntries(choices.map((choice) => [choice.value, choice.label]))}
      value={launch === '' ? current : launch}
      onValueChange={(next) => setLaunch(next === null || next === current ? '' : next)}
    >
      <SelectTrigger aria-label="Launch" className="h-9 w-full rounded-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function LogsSidebar() {
  const setScreen = useAtomSet(screenAtom)
  const returnScreen = useAtomValue(returnScreenAtom)
  const launch = useAtomValue(launchFilterAtom)
  const [level, setLevel] = useAtom(levelFilterAtom)
  const [feature, setFeature] = useAtom(featureFilterAtom)
  const result = useAtomValue(logAtom(launch))
  const entries = AsyncResult.isSuccess(result) ? result.value : []

  const features = [...new Set(entries.map((entry) => entry.feature))].toSorted((left, right) =>
    featureLabel(left).localeCompare(featureLabel(right)),
  )

  return (
    <>
      <Button
        variant="ghost"
        className="mb-2 justify-start gap-2 px-2 font-normal text-muted-foreground"
        onClick={() => setScreen(returnScreen === 'logs' ? 'dashboard' : returnScreen)}
      >
        <CaretLeftIcon />
        Back to app
      </Button>
      <GroupLabel>Level</GroupLabel>
      {levels.map(({ filter, label }) => (
        <FilterButton
          key={filter}
          active={level === filter}
          count={entries.filter((entry) => matchesLevel(entry.level, filter)).length}
          onClick={() => setLevel(filter)}
        >
          {filter === 'all' ? (
            <span aria-hidden className="size-[7px] rounded-full bg-foreground" />
          ) : (
            <LevelDot level={filter} />
          )}
          {label}
        </FilterButton>
      ))}
      <GroupLabel>Feature</GroupLabel>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        <FilterButton active={feature === ''} onClick={() => setFeature('')}>
          <HashIcon className="text-muted-foreground" />
          All features
        </FilterButton>
        {features.map((id) => (
          <FilterButton key={id} active={feature === id} onClick={() => setFeature(id)}>
            <HashIcon className="text-muted-foreground" />
            {featureLabel(id)}
          </FilterButton>
        ))}
      </div>
      <div className="flex-1" />
      <GroupLabel>Launch</GroupLabel>
      <LaunchPicker />
    </>
  )
}
