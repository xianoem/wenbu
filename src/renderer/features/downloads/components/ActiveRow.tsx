import { useAtomSet } from '@effect/atom-react'
import { CoinsIcon, ImagesIcon, WifiSlashIcon, XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { DownloadJob } from '#contract/Downloads'
import { Button } from '#ui/button'
import { answerDownloadAtom, cancelDownloadAtom } from '../downloads'
import { activeMeta, pageCount, percentOf, questionText } from '../utils/downloadText'

function Progress({
  percent,
  tone,
}: {
  readonly percent: number | undefined
  readonly tone?: 'warning'
}) {
  return (
    <div className="relative h-1 overflow-hidden rounded-full bg-foreground/10">
      <div
        className={cn(
          'h-full rounded-full bg-foreground transition-[width] duration-200',
          tone === 'warning' && 'bg-warning',
          percent === undefined && 'progress-sweep',
        )}
        style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
      />
    </div>
  )
}

function RowIcon({
  tone,
  children,
}: {
  readonly tone?: 'warning' | 'danger' | undefined
  readonly children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-xl bg-foreground/10',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-destructive/15 text-destructive',
      )}
    >
      {children}
    </span>
  )
}

function QuestionRow({ job }: { readonly job: DownloadJob }) {
  const answer = useAtomSet(answerDownloadAtom)

  if (job.question === undefined) {
    return null
  }

  const text = questionText(job.question)

  return (
    <div className="flex flex-col gap-2 rounded-2xl rounded-l-md border-l-2 border-warning bg-warning/10 px-3 py-3 pl-3.5">
      <div className="flex items-center gap-2.5">
        <RowIcon tone="warning">
          <CoinsIcon />
        </RowIcon>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {pageCount(job)}
        </span>
      </div>
      <Progress percent={percentOf(job)} tone="warning" />
      <div className="flex flex-col gap-0.5 text-[12.5px] leading-snug">
        <span className="font-medium">{text.title}</span>
        <span className="text-muted-foreground">{text.detail}</span>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => answer({ payload: { jobId: job.id, accept: false } })}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => answer({ payload: { jobId: job.id, accept: true } })}
        >
          Download
        </Button>
      </div>
    </div>
  )
}

export function ActiveRow({ job }: { readonly job: DownloadJob }) {
  const cancel = useAtomSet(cancelDownloadAtom)

  if (job.status === 'waiting') {
    return <QuestionRow job={job} />
  }

  const percent = percentOf(job)
  const meta = activeMeta(job)
  const retrying = job.activity?.includes('trying again') === true

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-muted/35 px-3 py-3 pl-3.5 transition-colors hover:bg-muted/55">
      <div className="flex items-center gap-2.5">
        <RowIcon>{retrying ? <WifiSlashIcon /> : <ImagesIcon />}</RowIcon>
        <div className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-medium">
          <span className="truncate">{job.title}</span>
          {job.attempt > 1 ? (
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              attempt {job.attempt}
            </span>
          ) : null}
        </div>
        {percent === undefined ? null : (
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {percent.toFixed(1)}%
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Cancel download"
          onClick={() => cancel({ payload: { jobId: job.id } })}
        >
          <XIcon />
        </Button>
      </div>
      <Progress percent={job.status === 'queued' ? 0 : percent} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs leading-tight text-muted-foreground tabular-nums">
        {meta.map((segment, index) => (
          <span key={segment} className="contents">
            {index > 0 ? (
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/70" />
            ) : null}
            <span>{segment}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
