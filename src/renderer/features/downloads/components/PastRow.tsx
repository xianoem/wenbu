import { useAtomSet } from '@effect/atom-react'
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  FolderOpenIcon,
  PauseIcon,
  SignInIcon,
  TranslateIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { DownloadJob } from '#contract/Downloads'
import type { MangaRun } from '#contract/Manga'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { removeDownloadAtom, resumeDownloadAtom, signInToSourceAtom } from '../downloads'
import { pastMeta, problemText, resumeLabel } from '../utils/downloadText'

function TranslateButton({ onTranslate }: { readonly onTranslate: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Translate gallery">
            <TranslateIcon />
          </Button>
        }
      />
      <PopoverContent side="left" align="center" className="w-80 rounded-2xl p-3">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">Translate gallery?</span>
          <p className="text-sm leading-5 text-muted-foreground">
            Wenbu translates every page with your manga settings into a subfolder of this gallery.
            The downloaded pages are not changed.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false)
                onTranslate()
              }}
            >
              Translate gallery
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MangaProgress({
  run,
  onCancel,
}: {
  readonly run: MangaRun
  readonly onCancel: () => void
}) {
  const pages = `${run.pages.done + run.pages.skipped}/${run.pages.total} pages`

  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-muted/45 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <TranslateIcon className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {run.status === 'running'
          ? [pages, run.activity].filter(Boolean).join(' · ')
          : 'Translated'}
      </span>
      {run.status === 'running' ? (
        <Button variant="ghost" size="icon-xs" aria-label="Cancel translation" onClick={onCancel}>
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}

const pastIcon = (job: DownloadJob) => {
  if (job.status === 'finished') {
    return { tone: undefined, icon: <CheckIcon weight="bold" /> }
  }

  if (job.status === 'failed' && job.problem?.space !== undefined) {
    return { tone: 'warning' as const, icon: <PauseIcon weight="bold" /> }
  }

  if (job.status === 'failed') {
    return job.problem?.reason === 'sign-in'
      ? { tone: 'danger' as const, icon: <SignInIcon weight="bold" /> }
      : { tone: 'danger' as const, icon: <WarningIcon weight="bold" /> }
  }

  return { tone: undefined, icon: <PauseIcon weight="bold" /> }
}

export function PastRow({
  job,
  mangaRun,
  canTranslate,
  onTranslate,
  onCancelTranslation,
}: {
  readonly job: DownloadJob
  readonly mangaRun: MangaRun | undefined
  readonly canTranslate: boolean
  readonly onTranslate: () => void
  readonly onCancelTranslation: () => void
}) {
  const resume = useAtomSet(resumeDownloadAtom)
  const remove = useAtomSet(removeDownloadAtom)
  const signIn = useAtomSet(signInToSourceAtom)
  const { tone, icon } = pastIcon(job)
  const stopped = job.status !== 'finished'
  const needsSignIn = job.status === 'failed' && job.problem?.reason === 'sign-in'
  const folder = job.folder

  return (
    <div className="group rounded-xl transition-colors hover:bg-muted/45">
      <div className="flex items-center gap-2.5 py-2.5 pr-1.5 pl-3">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground/85',
            tone === 'danger' && 'bg-destructive/15 text-destructive',
            tone === 'warning' && 'bg-tint-amber text-tint-amber-foreground',
          )}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{job.title}</span>
          {job.status === 'failed' && job.problem !== undefined ? (
            <span
              className="truncate text-[11.5px] text-muted-foreground"
              title={job.problem.message}
            >
              {problemText(job.problem)}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {pastMeta(job)}
        </span>
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            !stopped && 'opacity-0 group-hover:opacity-100',
          )}
        >
          {!stopped && canTranslate && mangaRun === undefined ? (
            <TranslateButton onTranslate={onTranslate} />
          ) : null}
          {!stopped && folder !== undefined ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Show in folder"
              onClick={() => window.wenbu.revealPath(folder)}
            >
              <FolderOpenIcon />
            </Button>
          ) : null}
          {needsSignIn ? (
            <Button
              variant="secondary"
              size="xs"
              className="rounded-full"
              onClick={() => signIn({ payload: { source: job.source } })}
            >
              Sign in
            </Button>
          ) : null}
          {stopped ? (
            <Button
              variant="secondary"
              size="xs"
              className="rounded-full"
              onClick={() => resume({ payload: { jobId: job.id } })}
            >
              <ArrowCounterClockwiseIcon />
              {resumeLabel(job)}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove from history"
            className={cn(stopped && 'opacity-0 group-hover:opacity-100')}
            onClick={() => remove({ payload: { jobId: job.id } })}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {mangaRun === undefined ? null : (
        <MangaProgress run={mangaRun} onCancel={onCancelTranslation} />
      )}
    </div>
  )
}
