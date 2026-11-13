import { useAtom, useAtomValue } from '@effect/atom-react'
import { ArrowRightIcon, ExportIcon, FolderOpenIcon, PulseIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { LogEntry } from '#contract/Diagnostics'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { LevelDot } from './components/LevelDot'
import {
  errorsSeenAtAtom,
  featureLabel,
  fieldsText,
  formatLogTime,
  isError,
  logAtom,
} from './diagnostics'
import { useOpenLogs } from './hooks/useOpenLogs'

const latestCount = 8

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`

function Row({ entry }: { readonly entry: LogEntry }) {
  const fields = fieldsText(entry)

  return (
    <div className="grid grid-cols-[8px_64px_1fr] items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-foreground/[0.04]">
      <LevelDot level={entry.level} className="mt-1.5" />
      <span className="pt-px font-mono text-[11.5px] text-muted-foreground tabular-nums">
        {formatLogTime(entry.at).slice(0, 8)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px]">{entry.message}</div>
        <div className="truncate font-mono text-[11.5px] text-muted-foreground">
          {featureLabel(entry.feature)}
          {fields === '' ? '' : ` · ${fields}`}
        </div>
      </div>
    </div>
  )
}

function Chip({ level, label }: { readonly level: 'error' | 'warn'; readonly label: string }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[11.5px]">
      <LevelDot level={level} />
      {label}
    </span>
  )
}

export function LogsPopover() {
  const result = useAtomValue(logAtom(''))
  const [seenAt, setSeenAt] = useAtom(errorsSeenAtAtom)
  const [open, setOpen] = useState(false)
  const openLogs = useOpenLogs()
  const entries = AsyncResult.isSuccess(result) ? result.value : []
  const errors = entries.filter((entry) => isError(entry.level))
  const warnings = entries.filter((entry) => entry.level === 'warn').length
  const newest = errors.at(-1)?.at ?? 0
  const unseen = newest > seenAt

  const latest = entries
    .filter((entry) => entry.level !== 'debug')
    .slice(-latestCount)
    .toReversed()

  const changeOpen = (next: boolean) => {
    setOpen(next)

    if (next && unseen) {
      setSeenAt(newest)
    }
  }

  const showAll = () => {
    setOpen(false)
    openLogs()
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={unseen ? 'Logs, with new errors' : 'Logs'}
            title="Logs"
            className={cn(
              'relative size-7 text-muted-foreground',
              open && 'bg-muted text-foreground',
            )}
          />
        }
      >
        <PulseIcon />
        {unseen ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-[7px] rounded-full bg-destructive ring-2 ring-sidebar"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="flex w-[440px] flex-col gap-3 rounded-[22px] bg-popover/90 p-4 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between px-1 pt-0.5">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <PulseIcon className="size-4 text-muted-foreground" />
            Logs
          </div>
          <div className="flex gap-1.5">
            {errors.length > 0 ? (
              <Chip level="error" label={count(errors.length, 'error')} />
            ) : null}
            {warnings > 0 ? <Chip level="warn" label={count(warnings, 'warning')} /> : null}
          </div>
        </div>
        {latest.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {latest.map((entry) => (
              <Row key={`${entry.at}-${entry.process}-${entry.message}`} entry={entry} />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-0.5 pt-2.5">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              onClick={() => void window.wenbu.exportDiagnostics()}
            >
              <ExportIcon />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              onClick={() => window.wenbu.openLogsFolder()}
            >
              <FolderOpenIcon />
              Folder
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="rounded-full font-medium" onClick={showAll}>
            Show all logs
            <ArrowRightIcon />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
