import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  DotsThreeIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { DateTime, Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type DragEvent, useState } from 'react'
import {
  languageName,
  type MangaFolder,
  type MangaRun,
  type MangaRunStatus,
  type MangaRuntimeState,
  type PageStage,
  type RecentPage,
} from '#contract/Manga'
import type { SpaceShortfall } from '#contract/Storage'
import { formatMoment } from '#lib/format'
import { formErrorOf, spaceErrorOf } from '#lib/forms'
import { mangaEditorAtom, screenAtom, settingsPageAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '#ui/trace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { useLlmSettings } from '../settings/llm'
import { NotEnoughSpaceNotice } from '../storage/NotEnoughSpaceNotice'
import {
  cancelMangaRunAtom,
  checkMangaFolderAtom,
  mangaRunsAtom,
  mangaRuntimeAtom,
  mangaSettingsAtom,
  removeMangaRunAtom,
  startMangaRunAtom,
} from './manga'

const statuses: Record<MangaRunStatus, { readonly label: string; readonly className: string }> = {
  running: { label: 'Running', className: 'bg-foreground/10 text-foreground' },
  translated: { label: 'Translated', className: 'bg-success/10 text-success' },
  partial: { label: 'Partly translated', className: 'bg-warning/10 text-warning' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
}

const runtimeLabels: Record<MangaRuntimeState['status'], string> = {
  'not-installed': 'manga-image-translator is not installed',
  stopped: 'Ready',
  starting: 'Starting the manga worker',
  'loading-models': 'Loading the models',
  ready: 'Ready, models loaded',
  busy: 'Translating',
  failed: 'The manga worker stopped',
}

const folderName = (folder: string) =>
  folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder

const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${whole % 60}s`
  }

  return `${whole}s`
}

const secondsBetween = (from: string, to: string) =>
  (DateTime.toEpochMillis(DateTime.makeUnsafe(to)) -
    DateTime.toEpochMillis(DateTime.makeUnsafe(from))) /
  1000

const formatTokens = (run: MangaRun) => {
  const tokens = run.usage.inputTokens + run.usage.outputTokens

  if (tokens === 0) {
    return undefined
  }

  const count = tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`

  return run.usage.costUsd === undefined ? count : `${count} · $${run.usage.costUsd.toFixed(2)}`
}

function StatusPill({ status }: { readonly status: MangaRunStatus }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        statuses[status].className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statuses[status].label}
    </span>
  )
}

function ReadyLine({ runtime }: { readonly runtime: MangaRuntimeState | undefined }) {
  const settings = useAtomValue(mangaSettingsAtom)
  const llm = useLlmSettings()
  const openScreen = useAtomSet(screenAtom)
  const openSettings = useAtomSet(settingsPageAtom)

  if (runtime?.status === 'not-installed') {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Needs manga-image-translator.{' '}
        <Button
          variant="link"
          className="h-auto p-0 text-[12.5px]"
          onClick={() => openScreen('plugins')}
        >
          Install it from Plugins
        </Button>
      </p>
    )
  }

  const saved = AsyncResult.isSuccess(settings) ? settings.value : undefined

  const preset = AsyncResult.isSuccess(llm)
    ? llm.value.presets.find((candidate) => candidate.id === saved?.presetId)
    : undefined

  const openMangaSettings = () => {
    openSettings('manga')
    openScreen('settings')
  }

  if (saved !== undefined && preset === undefined) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No preset chosen.{' '}
        <Button variant="link" className="h-auto p-0 text-[12.5px]" onClick={openMangaSettings}>
          Choose one in settings
        </Button>
      </p>
    )
  }

  const parts = [
    runtime === undefined ? undefined : runtimeLabels[runtime.status],
    runtime?.device === 'cuda' ? 'GPU' : undefined,
    preset === undefined ? undefined : `Preset: ${preset.name}`,
    saved === undefined ? undefined : languageName(saved.targetLanguage),
  ].filter((part) => part !== undefined)

  return (
    <p className="text-[12.5px] text-muted-foreground">
      {parts.join(' · ')}{' '}
      <Button variant="link" className="h-auto p-0 text-[12.5px]" onClick={openMangaSettings}>
        Settings
      </Button>
    </p>
  )
}

function DropZone({
  runtime,
  busy,
}: {
  readonly runtime: MangaRuntimeState | undefined
  readonly busy: boolean
}) {
  const check = useAtomSet(checkMangaFolderAtom, { mode: 'promiseExit' })
  const start = useAtomSet(startMangaRunAtom, { mode: 'promiseExit' })
  const openEditor = useAtomSet(mangaEditorAtom)
  const [dragging, setDragging] = useState(false)
  const [checked, setChecked] = useState<MangaFolder | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [space, setSpace] = useState<SpaceShortfall | undefined>(undefined)
  const [working, setWorking] = useState(false)

  const inspect = async (folder: string) => {
    setWorking(true)
    setError(undefined)
    setSpace(undefined)
    setChecked(undefined)

    const exit = await check({ payload: { folder } })

    setWorking(false)

    if (Exit.isSuccess(exit)) {
      setChecked(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const choose = async () => {
    const folder = await window.wenbu.chooseFolder()

    if (folder !== undefined) {
      await inspect(folder)
    }
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)

    const file = event.dataTransfer.files[0]

    if (file !== undefined) {
      void inspect(window.wenbu.pathForFile(file))
    }
  }

  const translate = async (folder: MangaFolder) => {
    setWorking(true)

    const exit = await start({ payload: { folder: folder.folder } })

    setWorking(false)

    if (Exit.isSuccess(exit)) {
      setChecked(undefined)
      setSpace(undefined)

      return
    }

    const shortfall = spaceErrorOf(exit)

    setSpace(shortfall)
    setError(shortfall === undefined ? formErrorOf(exit)?.message : undefined)
  }

  const waiting = checked !== undefined && checked.pages - checked.translatedPages

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col items-center gap-3 rounded-3xl border-[1.5px] border-dashed px-6 py-9 text-center transition-colors',
        dragging && 'border-ring bg-muted',
      )}
    >
      {checked === undefined ? (
        <>
          <FolderOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            {working ? 'Looking at the folder…' : 'Drop a folder of pages here, or'}
          </p>
          <Button
            variant="outline"
            className="rounded-full px-4"
            disabled={working}
            onClick={() => void choose()}
          >
            Choose a folder
          </Button>
        </>
      ) : (
        <>
          <FolderSimpleIcon className="size-8 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{folderName(checked.folder)}</span>
            <span className="text-[12.5px] text-muted-foreground">
              {checked.pages} pages
              {checked.translatedPages > 0
                ? ` · ${checked.translatedPages} already translated`
                : ''}{' '}
              · into {folderName(checked.outputFolder)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="rounded-full px-4"
              disabled={working}
              onClick={() => setChecked(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="rounded-full px-4"
              disabled={working || checked.pages === 0}
              onClick={() => openEditor(checked.folder)}
            >
              Translate by hand
            </Button>
            <Button
              className="rounded-full px-4"
              disabled={
                working || busy || checked.pages === 0 || runtime?.status === 'not-installed'
              }
              onClick={() => void translate(checked)}
            >
              {waiting === 0 && checked.pages > 0 ? 'Nothing left to translate' : 'Translate'}
            </Button>
          </div>
        </>
      )}
      {space === undefined || checked === undefined ? null : (
        <NotEnoughSpaceNotice
          className="w-full max-w-md text-left"
          space={space}
          onRetry={() => void translate(checked)}
        />
      )}
      {error === undefined ? null : <p className="text-[13px] text-destructive">{error}</p>}
      <ReadyLine runtime={runtime} />
    </div>
  )
}

const stageLabels: Record<PageStage, string> = {
  detecting: 'finding text',
  reading: 'reading text',
  translating: 'translating',
  cleaning: 'cleaning',
  lettering: 'lettering',
}

function PageLine({ page }: { readonly page: RecentPage }) {
  if (page.status === 'done') {
    const what = page.regions === 0 ? 'no text · copied' : `${page.regions ?? 0} bubbles`

    return (
      <TraceLine>
        <TraceIcon>
          <CheckCircleIcon />
        </TraceIcon>
        <TraceTitle>{page.name}</TraceTitle>
        <TraceDescription>
          {page.seconds === undefined ? what : `${what} · ${page.seconds.toFixed(1)} s`}
        </TraceDescription>
      </TraceLine>
    )
  }

  if (page.status === 'failed') {
    return (
      <TraceLine status="error">
        <TraceIcon>
          <WarningCircleIcon />
        </TraceIcon>
        <TraceTitle>
          {page.name}: {page.message ?? 'failed'}
        </TraceTitle>
      </TraceLine>
    )
  }

  if (page.status === 'running') {
    return (
      <TraceLine status="running" className="text-foreground">
        <TraceIcon>
          <CircleNotchIcon className="animate-spin" />
        </TraceIcon>
        <TraceTitle>
          {page.name} · {stageLabels[page.stage ?? 'detecting']}
        </TraceTitle>
      </TraceLine>
    )
  }

  return (
    <TraceLine status="pending">
      <TraceIcon>
        <CircleIcon />
      </TraceIcon>
      <TraceTitle>{page.name} · waiting</TraceTitle>
    </TraceLine>
  )
}

function CancelButton({ run }: { readonly run: MangaRun }) {
  const cancel = useAtomSet(cancelMangaRunAtom)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cancel the run"
            className="size-6 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
            onClick={() => cancel({ payload: { runId: run.id } })}
          />
        }
      >
        <TrashIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>Cancel the run. Pages already translated stay.</TooltipContent>
    </Tooltip>
  )
}

function ActiveRun({ run }: { readonly run: MangaRun }) {
  const elapsed = secondsBetween(run.startedAt, DateTime.formatIso(DateTime.nowUnsafe()))
  const todo = run.pages.total - run.pages.skipped
  const finished = run.pages.done + run.pages.failed
  const percent = todo === 0 ? 0 : Math.round((finished / todo) * 100)
  const perPage = finished === 0 ? undefined : elapsed / finished
  const pages = run.recentPages ?? []

  const pace = [
    `${finished} of ${todo} pages`,
    perPage === undefined ? undefined : `${perPage.toFixed(1)} s a page`,
    perPage === undefined || run.status !== 'running'
      ? undefined
      : `about ${formatDuration(perPage * (todo - finished))} left`,
  ].filter((part) => part !== undefined)

  const footer = [formatTokens(run), `started ${formatMoment(run.startedAt).toLowerCase()}`].filter(
    (part) => part !== undefined,
  )

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-card p-6 shadow-card">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{folderName(run.folder)}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground" title={run.folder}>
            {run.folder} · into {folderName(run.outputFolder)}
          </span>
        </span>
        <StatusPill status={run.status} />
        {run.status === 'running' ? <CancelButton run={run} /> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
          {pace.join(' · ')}
        </span>
      </div>
      <Trace className="rounded-2xl bg-muted/40 px-4 py-3">
        {pages.length === 0 ? (
          <TraceLine status="running" className="text-foreground">
            <TraceIcon>
              <CircleNotchIcon className="animate-spin" />
            </TraceIcon>
            <TraceTitle>{run.activity ?? 'Starting'}</TraceTitle>
          </TraceLine>
        ) : (
          pages.map((page) => <PageLine key={`${page.name}-${page.status}`} page={page} />)
        )}
      </Trace>
      <span className="text-[12.5px] text-muted-foreground">{footer.join(' · ')}</span>
    </section>
  )
}

function HistoryRow({ run }: { readonly run: MangaRun }) {
  const remove = useAtomSet(removeMangaRunAtom)
  const openEditor = useAtomSet(mangaEditorAtom)
  const todo = run.pages.total - run.pages.skipped

  const duration =
    run.seconds ??
    (run.finishedAt === undefined ? undefined : secondsBetween(run.startedAt, run.finishedAt))

  const pages =
    run.pages.failed === 0 && run.pages.done === todo
      ? `${run.pages.total} pages`
      : `${run.pages.done} of ${todo} pages`

  const details = [
    pages,
    run.pages.skipped > 0 ? `${run.pages.skipped} skipped` : undefined,
    duration === undefined ? undefined : formatDuration(duration),
    formatTokens(run),
    formatMoment(run.startedAt),
  ].filter((part) => part !== undefined)

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium" title={run.folder}>
          {folderName(run.folder)}
        </span>
        <StatusPill status={run.status} />
        <Button
          variant="ghost"
          className="rounded-full px-3"
          onClick={() => window.wenbu.revealPath(run.outputFolder)}
        >
          Reveal
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="More" className="rounded-full" />
            }
          >
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEditor(run.folder)}>
              Translate by hand
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.wenbu.revealPath(run.folder)}>
              Show the original pages
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => remove({ payload: { runId: run.id } })}>
              Remove from history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="text-[12.5px] text-muted-foreground">
        {details.join(' · ')} · {run.presetName}
      </span>
      {run.space === undefined ? null : (
        <NotEnoughSpaceNotice className="mt-1.5" space={run.space} />
      )}
      {run.error === undefined || run.space !== undefined ? null : (
        <span className="flex items-center gap-1.5 text-[12.5px] text-destructive">
          <WarningCircleIcon className="size-3.5 shrink-0" />
          {run.error}
        </span>
      )}
      {run.problems.slice(0, 3).map((problem) => (
        <span key={problem.page} className="text-[12.5px] text-muted-foreground">
          {problem.page}: {problem.message}
        </span>
      ))}
      {run.problems.length > 3 ? (
        <span className="text-[12.5px] text-muted-foreground">
          and {run.problems.length - 3} more pages
        </span>
      ) : null}
    </div>
  )
}

function DropOrRun({
  runs,
  runtime,
}: {
  readonly runs: ReadonlyArray<MangaRun>
  readonly runtime: MangaRuntimeState | undefined
}) {
  const active = runs.find((run) => run.status === 'running')
  const wanted = active?.id ?? 'drop'
  const [shown, setShown] = useState(wanted)
  const leaving = shown !== wanted
  const shownRun = runs.find((run) => run.id === shown)

  const motion = leaving
    ? 'animate-out fade-out-0 zoom-out-95 fill-mode-forwards duration-200'
    : 'animate-in fade-in-0 zoom-in-95 duration-300'

  return (
    <div
      key={shown}
      className={motion}
      onAnimationEnd={() => (leaving ? setShown(wanted) : undefined)}
    >
      {shownRun === undefined ? (
        <DropZone runtime={runtime} busy={active !== undefined} />
      ) : (
        <ActiveRun run={shownRun} />
      )}
    </div>
  )
}

export function MangaPage() {
  const runs = useAtomValue(mangaRunsAtom)
  const runtime = useAtomValue(mangaRuntimeAtom)
  const all = AsyncResult.isSuccess(runs) ? runs.value : []
  const history = all.filter((run) => run.status !== 'running')

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Manga</h1>
      <p className="mt-1 text-muted-foreground">
        Translate folders of manga pages with your presets. Translated pages go into a folder inside
        the one you choose.
      </p>
      <div className="mt-6 flex flex-col gap-5">
        <DropOrRun
          runs={all}
          runtime={AsyncResult.isSuccess(runtime) ? runtime.value : undefined}
        />
        {history.length === 0 ? null : (
          <section className="flex flex-col">
            <h2 className="text-base font-medium">History</h2>
            <div className="flex flex-col divide-y">
              {history.map((run) => (
                <HistoryRow key={run.id} run={run} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
