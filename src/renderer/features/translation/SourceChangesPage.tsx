import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { ArrowLeftIcon, TranslateIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { Fragment, useState } from 'react'
import type { RemovedLine, SourceChangeAction, TranslationLine } from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { formatMoment } from '#lib/format'
import { sourceChangesAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { ScrollArea } from '#ui/scroll-area'
import { startTranslationAtom } from '../library/library'
import {
  lineKeys,
  placeOf,
  setSourceChangeActionAtom,
  sourceChangeListAtom,
  gameUpdateAtom,
} from './translationLines'

type ChangeFilter = 'all' | 'changed' | 'new' | 'removed' | 'locked'

const changeFilters: ReadonlyArray<ChangeFilter> = ['all', 'changed', 'new', 'removed', 'locked']

const filterLabels: Record<ChangeFilter, string> = {
  all: 'All',
  changed: 'Changed',
  new: 'New',
  removed: 'Removed',
  locked: 'Locked',
}

const kindStyles = {
  changed: { label: 'Changed', className: 'bg-warning/10 text-warning' },
  new: { label: 'New', className: 'bg-info/12 text-info' },
  removed: { label: 'Removed', className: 'bg-muted text-muted-foreground' },
} as const

function KindPill({ kind }: { readonly kind: keyof typeof kindStyles }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        kindStyles[kind].className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {kindStyles[kind].label}
    </span>
  )
}

function Reworded({ before, after }: { readonly before: string; readonly after: string }) {
  let start = 0

  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }

  let end = 0

  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }

  return (
    <>
      {after.slice(0, start)}
      {before.slice(start, before.length - end) === '' ? null : (
        <del className="rounded bg-destructive/18 px-0.5 text-destructive no-underline">
          {before.slice(start, before.length - end)}
        </del>
      )}
      {after.slice(start, after.length - end) === '' ? null : (
        <ins className="rounded bg-success/16 px-0.5 text-success no-underline">
          {after.slice(start, after.length - end)}
        </ins>
      )}
      {after.slice(after.length - end)}
    </>
  )
}

function ActionToggle({ game, line }: { readonly game: Game; readonly line: TranslationLine }) {
  const setAction = useAtomSet(setSourceChangeActionAtom)
  const current: SourceChangeAction = line.translatedText === undefined ? 'translate' : 'keep'
  const canKeep = line.translatedText !== undefined || line.previousText !== undefined

  const choose = (action: SourceChangeAction) => {
    if (action !== current) {
      setAction({
        payload: { gameId: game.id, entryId: line.entryId, action },
        reactivityKeys: lineKeys,
      })
    }
  }

  return (
    <span className="inline-flex rounded-full bg-muted p-0.5">
      {(['translate', 'keep'] as const).map((action) => (
        <Button
          key={action}
          variant="ghost"
          aria-pressed={current === action}
          disabled={action === 'keep' && !canKeep}
          className={cn(
            'h-6 rounded-full px-2.5 text-xs font-normal text-muted-foreground',
            current === action && 'bg-background font-medium text-foreground shadow-card',
          )}
          onClick={() => choose(action)}
        >
          {action === 'translate' ? 'Translate' : 'Keep'}
        </Button>
      ))}
    </span>
  )
}

function ChangeRow({ game, line }: { readonly game: Game; readonly line: TranslationLine }) {
  const kind = line.change === 'new' ? 'new' : 'changed'
  const translation = line.translatedText ?? line.previousText

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <KindPill kind={kind} />
        <span className="text-xs break-words text-muted-foreground">{placeOf(line)}</span>
      </div>
      <p className="leading-relaxed whitespace-pre-wrap">
        {line.previousSource === undefined ? (
          line.sourceText
        ) : (
          <Reworded before={line.previousSource} after={line.sourceText} />
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        <p
          className={cn(
            'whitespace-pre-wrap',
            line.translatedText === undefined && 'text-muted-foreground',
          )}
        >
          {translation ?? '—'}
        </p>
        {line.locked ? (
          <span className="inline-flex h-[22px] w-fit items-center rounded-full bg-tint-violet px-2.5 text-xs font-medium text-tint-violet-foreground">
            Locked · you wrote this
          </span>
        ) : null}
      </div>
      <div className="flex items-start justify-end">
        <ActionToggle game={game} line={line} />
      </div>
    </>
  )
}

function RemovedRow({ line }: { readonly line: RemovedLine }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <KindPill kind="removed" />
        <span className="text-xs break-words text-muted-foreground">{placeOf(line)}</span>
      </div>
      <p className="whitespace-pre-wrap text-muted-foreground">{line.sourceText}</p>
      <p className="whitespace-pre-wrap text-muted-foreground">{line.translatedText ?? '—'}</p>
      <span className="text-right text-xs text-muted-foreground">Dropped from the game</span>
    </>
  )
}

const shown = (filter: ChangeFilter, line: TranslationLine) => {
  if (filter === 'all') {
    return true
  }

  if (filter === 'locked') {
    return line.locked
  }

  return line.change === filter
}

export function SourceChangesPage({ game }: { readonly game: Game }) {
  const close = useAtomSet(sourceChangesAtom)
  const start = useAtomSet(startTranslationAtom)
  const result = useAtomValue(sourceChangeListAtom(game.id))
  const updateResult = useAtomValue(gameUpdateAtom(game.id))
  const [filter, setFilter] = useState<ChangeFilter>('all')
  const changes = AsyncResult.isSuccess(result) ? result.value : { lines: [], removed: [] }
  const update = AsyncResult.isSuccess(updateResult) ? updateResult.value : undefined
  const pending = changes.lines.filter((line) => line.translatedText === undefined).length

  const counts: Record<ChangeFilter, number> = {
    all: changes.lines.length + changes.removed.length,
    changed: changes.lines.filter((line) => line.change === 'changed').length,
    new: changes.lines.filter((line) => line.change === 'new').length,
    removed: changes.removed.length,
    locked: changes.lines.filter((line) => line.locked).length,
  }

  const lines = changes.lines.filter((line) => shown(filter, line))
  const removed = filter === 'all' || filter === 'removed' ? changes.removed : []

  const detectedAt =
    update !== undefined && Option.isSome(update) ? update.value.detectedAt : undefined

  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        className="h-8 w-fit rounded-full px-3"
        onClick={() => close(undefined)}
      >
        <ArrowLeftIcon />
        {game.title}
      </Button>

      <div className="mt-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">What changed in the update</h1>
          <p className="mt-1 text-muted-foreground">
            {detectedAt === undefined ? '' : `Found ${formatMoment(detectedAt).toLowerCase()} · `}
            Lines that only moved kept their translation without a request.
          </p>
        </div>
        <Button
          className="h-9 rounded-full px-4"
          disabled={pending === 0}
          onClick={() => {
            start({ payload: { gameId: game.id, scope: 'changed' } })
            close(undefined)
          }}
        >
          <TranslateIcon />
          Translate {pending.toLocaleString('en-US')} lines
        </Button>
      </div>

      <div className="mt-5 inline-flex w-fit rounded-full bg-muted/60 p-[3px]">
        {changeFilters.map((option) => (
          <Button
            key={option}
            variant="ghost"
            aria-pressed={filter === option}
            className={cn(
              'h-7 gap-1.5 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
              filter === option && 'bg-background font-medium text-foreground shadow-card',
            )}
            onClick={() => setFilter(option)}
          >
            {filterLabels[option]}
            <span className="opacity-60">{counts[option].toLocaleString('en-US')}</span>
          </Button>
        ))}
      </div>

      <section className="mt-3 rounded-3xl bg-card px-2 py-1 shadow-card">
        <ScrollArea className="max-h-[calc(100vh-280px)]">
          <div className="grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_150px] gap-x-4 px-3.5 text-[13px] [&>*]:border-t [&>*]:py-3 [&>*:nth-child(-n+4)]:border-t-0">
            <span className="text-xs font-medium text-muted-foreground">Kind</span>
            <span className="text-xs font-medium text-muted-foreground">Original now</span>
            <span className="text-xs font-medium text-muted-foreground">Your translation</span>
            <span className="text-right text-xs font-medium text-muted-foreground">
              On the next run
            </span>
            {lines.map((line) => (
              <Fragment key={line.entryId}>
                <ChangeRow game={game} line={line} />
              </Fragment>
            ))}
            {removed.map((line) => (
              <Fragment key={`${line.file}:${line.context}:${line.sourceText}`}>
                <RemovedRow line={line} />
              </Fragment>
            ))}
          </div>
          {lines.length + removed.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">Nothing here.</p>
          ) : null}
        </ScrollArea>
      </section>
    </div>
  )
}
