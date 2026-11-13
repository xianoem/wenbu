import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { ExportIcon, FolderOpenIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { LogEntry } from '#contract/Diagnostics'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { ScrollArea } from '#ui/scroll-area'
import { Switch } from '#ui/switch'
import { LogRow, logColumns } from './components/LogRow'
import {
  featureFilterAtom,
  launchFilterAtom,
  levelFilterAtom,
  logAtom,
  matchesLevel,
  matchesSearch,
  setVerboseLoggingAtom,
  verboseLoggingAtom,
  verboseLoggingKeys,
} from './diagnostics'

const rowHeight = 30

const keyOf = (entry: LogEntry, index: number) => `${index}:${entry.at}`

function VerboseSwitch() {
  const result = useAtomValue(verboseLoggingAtom)
  const setVerbose = useAtomSet(setVerboseLoggingAtom)
  const verbose = AsyncResult.isSuccess(result) && result.value

  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      Verbose
      <Switch
        checked={verbose}
        onCheckedChange={(checked) =>
          setVerbose({ payload: { verbose: checked }, reactivityKeys: verboseLoggingKeys })
        }
      />
    </label>
  )
}

function SourceChip({ live }: { readonly live: boolean }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[11.5px] font-medium">
      <span
        aria-hidden
        className={cn('size-[7px] rounded-full', live ? 'bg-success' : 'bg-muted-foreground')}
      />
      {live ? 'Live' : 'Earlier launch'}
    </span>
  )
}

export function LogsPage() {
  const launch = useAtomValue(launchFilterAtom)
  const level = useAtomValue(levelFilterAtom)
  const feature = useAtomValue(featureFilterAtom)
  const result = useAtomValue(logAtom(launch))
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const entries = AsyncResult.isSuccess(result) ? result.value : []
  const search = query.trim().toLowerCase()

  const visible = entries
    .map((entry, index) => ({ entry, key: keyOf(entry, index) }))
    .filter(
      ({ entry }) =>
        matchesLevel(entry.level, level) &&
        (feature === '' || entry.feature === feature) &&
        matchesSearch(entry, search),
    )
    .toReversed()

  // oxlint-disable-next-line react/incompatible-library -- the virtualizer re-renders this list itself; nothing downstream memoizes its functions.
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    getItemKey: (index) => visible[index]?.key ?? index,
    overscan: 12,
  })

  const setScrollAreaRoot = (node: HTMLDivElement | null) =>
    setScrollElement(
      node?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null,
    )

  const body = () => {
    if (AsyncResult.isInitial(result)) {
      return <p className="p-6 text-sm text-muted-foreground">Loading logs…</p>
    }

    if (visible.length === 0) {
      return <p className="p-6 text-sm text-muted-foreground">No entries match.</p>
    }

    return (
      <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = visible[row.index]

          return item === undefined ? null : (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translate3d(0, ${row.start}px, 0)` }}
            >
              <LogRow
                entry={item.entry}
                open={openKey === item.key}
                striped={row.index % 2 === 1}
                onToggle={() => setOpenKey(openKey === item.key ? undefined : item.key)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">Logs</h1>
        <SourceChip live={launch === ''} />
        <div className="ml-auto flex items-center gap-2">
          {launch === '' ? <VerboseSwitch /> : null}
          <Button
            variant="outline"
            className="ml-1 h-8 rounded-full px-3.5"
            onClick={() => window.wenbu.openLogsFolder()}
          >
            <FolderOpenIcon />
            Open folder
          </Button>
          <Button
            className="h-8 rounded-full px-3.5"
            onClick={() => void window.wenbu.exportDiagnostics()}
          >
            <ExportIcon />
            Export diagnostics
          </Button>
        </div>
      </div>

      <InputGroup className="mt-[18px] mb-3 h-[34px] max-w-80 rounded-full">
        <InputGroupAddon>
          <MagnifyingGlassIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder="Search messages and fields"
          spellCheck={false}
          aria-label="Search logs"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </InputGroup>

      <div
        className={cn(
          'grid h-7 items-center gap-3.5 px-3.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase',
          logColumns,
        )}
      >
        <span />
        <span>Time</span>
        <span>Level</span>
        <span>Proc</span>
        <span>Feature</span>
        <span>Message</span>
      </div>

      <ScrollArea ref={setScrollAreaRoot} className="min-h-0 flex-1 pb-6">
        {body()}
      </ScrollArea>
    </div>
  )
}
