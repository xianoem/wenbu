import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowDownIcon,
  ArrowSquareOutIcon,
  ClipboardIcon,
  DownloadSimpleIcon,
  FolderIcon,
  GearIcon,
  InfoIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  type DownloadJob,
  type DownloadSettings,
  type DownloadsState,
  isActive,
  sources,
} from '#contract/Downloads'
import type { MangaRun } from '#contract/Manga'
import { formErrorOf } from '#lib/forms'
import { screenAtom, settingsPageAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '#ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { cancelMangaRunAtom, mangaRunsAtom, startMangaRunAtom } from '../manga/manga'
import { ActiveRow } from './components/ActiveRow'
import { PastRow } from './components/PastRow'
import { downloadSettingsAtom, downloadsAtom, startDownloadAtom } from './downloads'
import { formatSpeed } from './utils/downloadText'

function SectionLabel({ label, count }: { readonly label: string; readonly count: number }) {
  return (
    <div className="flex items-center gap-2.5 px-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] text-foreground tabular-nums">
        {count}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

const headerStatus = (active: ReadonlyArray<DownloadJob>) => {
  const waiting = active.filter((job) => job.status === 'waiting').length

  if (waiting > 0) {
    return `${waiting} waiting for you`
  }

  if (active.length === 0) {
    return 'Idle'
  }

  const speed = active.reduce((sum, job) => sum + (job.bytesPerSecond ?? 0), 0)

  return `${active.length} active · ${formatSpeed(speed) ?? '0 B/s'}`
}

function NoFolder({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  return (
    <Empty className="min-h-72 border border-border/60 bg-muted/20">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderIcon />
        </EmptyMedia>
        <EmptyTitle>Choose a download folder</EmptyTitle>
        <EmptyDescription>
          Downloads saves image galleries to a folder you choose in Settings.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button className="rounded-full" onClick={onOpenSettings}>
          <GearIcon />
          Open Downloads settings
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function DownloadsContent({
  state,
  settings,
  onOpenSettings,
}: {
  readonly state: DownloadsState
  readonly settings: DownloadSettings
  readonly onOpenSettings: () => void
}) {
  const start = useAtomSet(startDownloadAtom, { mode: 'promiseExit' })
  const startManga = useAtomSet(startMangaRunAtom, { mode: 'promiseExit' })
  const cancelManga = useAtomSet(cancelMangaRunAtom)
  const mangaRunsResult = useAtomValue(mangaRunsAtom)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const active = state.jobs.filter((job) => isActive(job.status))
  const past = state.jobs.filter((job) => !isActive(job.status))

  const mangaRuns: ReadonlyArray<MangaRun> = AsyncResult.isSuccess(mangaRunsResult)
    ? mangaRunsResult.value
    : []

  const translating = mangaRuns.some((run) => run.status === 'running')

  const enabled = sources.filter((source) => settings.enabledSources.includes(source.id))

  const submit = async () => {
    const link = url.trim()

    if (link === '' || busy) {
      return
    }

    setBusy(true)
    setError(undefined)

    const exit = await start({ payload: { url: link } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setUrl('')

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const translate = async (folder: string) => {
    setError(undefined)

    const exit = await startManga({ payload: { folder } })

    setError(formErrorOf(exit)?.message)
  }

  return (
    <>
      <InputGroup className="h-10 rounded-full">
        <InputGroupAddon>
          <ClipboardIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={url}
          placeholder="Paste a gallery link to download"
          spellCheck={false}
          aria-label="Gallery link"
          onChange={(event) => {
            setUrl(event.target.value)
            setError(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit()
            }
          }}
        />
        {url === '' ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear link" onClick={() => setUrl('')}>
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            variant="default"
            className="rounded-full px-3"
            disabled={url.trim() === '' || busy}
            onClick={() => void submit()}
          >
            <ArrowDownIcon />
            Start
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {error === undefined ? null : (
        <p className="-mt-1 px-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 px-1.5 text-[11px] leading-tight text-muted-foreground">
        <InfoIcon className="shrink-0" />
        <span className="font-medium">Supports</span>
        <span className="flex flex-wrap gap-1">
          {enabled.map((source) => (
            <span
              key={source.id}
              className="inline-flex h-[18px] items-center rounded-full bg-secondary px-2 text-[11px] text-secondary-foreground"
            >
              {source.name}
            </span>
          ))}
        </span>
      </div>

      <ScrollArea className="h-[396px] rounded-2xl">
        <div className="flex flex-col gap-1.5 pr-2 pb-1">
          <SectionLabel label="Active" count={active.length} />
          {active.length === 0 ? (
            <div className="py-5 text-center text-xs text-muted-foreground">
              No active downloads.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {active.map((job) => (
                <ActiveRow key={job.id} job={job} />
              ))}
            </div>
          )}

          <div className="mt-3.5">
            <SectionLabel label="Past" count={past.length} />
          </div>
          {past.length === 0 ? (
            <div className="py-5 text-center text-xs text-muted-foreground">No past downloads.</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {past.map((job) => {
                const run = mangaRuns.find(
                  (candidate) => candidate.status === 'running' && candidate.folder === job.folder,
                )

                return (
                  <PastRow
                    key={job.id}
                    job={job}
                    mangaRun={run}
                    canTranslate={!translating && job.folder !== undefined}
                    onTranslate={() => {
                      if (job.folder !== undefined) {
                        void translate(job.folder)
                      }
                    }}
                    onCancelTranslation={() => {
                      if (run !== undefined) {
                        cancelManga({ payload: { runId: run.id } })
                      }
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 rounded-2xl border border-foreground/10 bg-muted/35 py-2 pr-1.5 pl-2.5">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-muted-foreground">
          <FolderIcon />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px leading-tight">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Saving to
          </span>
          <span
            className="truncate text-left font-mono text-xs [direction:rtl]"
            title={settings.folder}
          >
            {settings.folder}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Open the download folder"
          onClick={() => window.wenbu.revealPath(settings.folder)}
        >
          <ArrowSquareOutIcon />
        </Button>
        <Button variant="ghost" size="xs" className="rounded-full" onClick={onOpenSettings}>
          <GearIcon />
          Settings
        </Button>
      </div>
    </>
  )
}

function PopoverBody({
  state,
  settings,
  onOpenSettings,
}: {
  readonly state: DownloadsState | undefined
  readonly settings: DownloadSettings | undefined
  readonly onOpenSettings: () => void
}) {
  if (state === undefined || settings === undefined) {
    return null
  }

  if (settings.folder === '') {
    return <NoFolder onOpenSettings={onOpenSettings} />
  }

  return <DownloadsContent state={state} settings={settings} onOpenSettings={onOpenSettings} />
}

export function DownloadsPopover() {
  const stateResult = useAtomValue(downloadsAtom)
  const settingsResult = useAtomValue(downloadSettingsAtom)
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const [open, setOpen] = useState(false)

  const state = AsyncResult.isSuccess(stateResult) ? stateResult.value : undefined
  const settings = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : undefined
  const active = state?.jobs.filter((job) => isActive(job.status)) ?? []
  const waiting = active.some((job) => job.status === 'waiting')

  const openSettings = () => {
    setOpen(false)
    setSettingsPage('downloads')
    setScreen('settings')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Downloads"
            className={cn(
              'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
              open && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
            )}
          />
        }
      >
        <DownloadSimpleIcon />
        Downloads
        {waiting ? (
          <span
            aria-label="A download is waiting for you"
            className="ml-auto size-2 animate-pulse rounded-full bg-warning"
          />
        ) : null}
        {!waiting && active.length > 0 ? (
          <span className="ml-auto flex min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] leading-4 text-background tabular-nums">
            {active.length}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={24}
        className="flex w-[544px] flex-col gap-3 rounded-[22px] bg-popover/75 p-4 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between px-1 pt-0.5">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <DownloadSimpleIcon className="size-4 text-muted-foreground" />
            Downloads
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{headerStatus(active)}</span>
        </div>
        <PopoverBody state={state} settings={settings} onOpenSettings={openSettings} />
      </PopoverContent>
    </Popover>
  )
}
