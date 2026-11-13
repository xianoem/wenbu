import {
  ArrowsClockwiseIcon,
  BellRingingIcon,
  CheckCircleIcon,
  CurrencyCircleDollarIcon,
  DownloadSimpleIcon,
  FileXIcon,
  HardDrivesIcon,
  type Icon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  SignInIcon,
  SparkleIcon,
  TranslateIcon,
  WarningIcon,
  WarningOctagonIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import { Button } from '#ui/button'
import { OverflowText } from '#ui/overflow-text'
import { useNoticeAction } from '../useNoticeAction'
import { type Notice, type NoticeIcon, noticeSummary, type Running, type Tone } from '../notices'

const icons: Record<NoticeIcon, Icon> = {
  limit: CurrencyCircleDollarIcon,
  run: WarningIcon,
  update: ArrowsClockwiseIcon,
  skipped: FileXIcon,
  connection: PlugsConnectedIcon,
  download: DownloadSimpleIcon,
  'sign-in': SignInIcon,
  manga: TranslateIcon,
  drive: HardDrivesIcon,
  plugin: PuzzlePieceIcon,
  errors: WarningOctagonIcon,
  details: SparkleIcon,
  released: BellRingingIcon,
}

const tones: Record<Tone, string> = {
  warning: 'bg-warning/12 text-warning',
  info: 'bg-info/14 text-info',
  destructive: 'bg-destructive/14 text-destructive',
}

function NoticeIconTile({ icon, tone }: { readonly icon: NoticeIcon; readonly tone: Tone }) {
  const Glyph = icons[icon]

  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-[10px]', tones[tone])}>
      <Glyph className="size-[17px]" />
    </span>
  )
}

function RunningRow({ work }: { readonly work: Running }) {
  return (
    <li className="flex flex-col gap-1.5 border-t py-2.5 first:border-t-0">
      <div className="flex items-baseline gap-2 text-sm">
        <OverflowText className="flex-1 font-semibold">{work.title}</OverflowText>
        {work.progress === undefined ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round(work.progress * 100)}%
          </span>
        )}
      </div>
      <OverflowText className="text-xs text-muted-foreground">{work.detail}</OverflowText>
      {work.progress === undefined ? null : (
        <span className="h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${work.progress * 100}%` }}
          />
        </span>
      )}
    </li>
  )
}

export function AttentionStrip({
  notices,
  running,
  dismissed,
  onDismiss,
  onDismissAll,
  onRestore,
}: {
  readonly notices: ReadonlyArray<Notice>
  readonly running: ReadonlyArray<Running>
  readonly dismissed: number
  readonly onDismiss: (notice: Notice) => void
  readonly onDismissAll: () => void
  readonly onRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  const act = useNoticeAction()
  const calm = notices.length === 0
  const canOpen = !calm || running.length > 0 || dismissed > 0

  return (
    <section className="rounded-3xl bg-card shadow-card">
      <div className="flex items-center gap-3 py-3 pr-3.5 pl-4">
        {calm ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
            <CheckCircleIcon className="size-4" />
          </span>
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-warning/12 text-warning">
            <WarningIcon className="size-4" />
          </span>
        )}
        <OverflowText className="flex-1 text-[13px]">
          {calm ? (
            <>
              <span className="font-semibold">Nothing needs you</span>
              {dismissed === 0 ? null : (
                <span className="text-muted-foreground"> · {dismissed} dismissed</span>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold">
                {notices.length === 1 ? '1 thing needs you' : `${notices.length} things need you`}
              </span>
              <span className="text-muted-foreground"> · {noticeSummary(notices)}</span>
            </>
          )}
        </OverflowText>
        {running.length === 0 ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">{running.length} running</span>
        )}
        {canOpen ? (
          <Button
            variant="secondary"
            aria-expanded={open}
            className="h-7 shrink-0 rounded-full px-3 text-[13px] font-normal"
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide' : 'Review'}
          </Button>
        ) : null}
      </div>
      {open && canOpen ? (
        <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-6 border-t px-5 pt-3 pb-4">
          <div>
            <div className="flex h-7 items-center pb-1">
              <h2 className="flex-1 text-xs font-medium text-muted-foreground">Needs you</h2>
              {calm ? null : (
                <Button
                  variant="ghost"
                  className="h-6 rounded-full px-2.5 text-xs font-normal text-muted-foreground"
                  onClick={onDismissAll}
                >
                  Dismiss all
                </Button>
              )}
            </div>
            {calm ? (
              <p className="py-2.5 text-sm text-muted-foreground">Nothing at the moment.</p>
            ) : (
              <ul>
                {notices.map((notice) => (
                  <li
                    key={notice.id}
                    className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
                  >
                    <NoticeIconTile icon={notice.icon} tone={notice.tone} />
                    <span className="min-w-0 flex-1">
                      <OverflowText className="text-sm font-semibold">{notice.title}</OverflowText>
                      {notice.detail === '' ? null : (
                        <OverflowText className="text-xs text-muted-foreground">
                          {notice.detail}
                        </OverflowText>
                      )}
                    </span>
                    <Button
                      variant="secondary"
                      className="h-7 shrink-0 rounded-full px-3 text-[13px] font-normal"
                      onClick={() => act(notice.action)}
                    >
                      {notice.actionLabel}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Dismiss: ${notice.title}`}
                      title="Dismiss until it changes"
                      className="shrink-0 rounded-full text-muted-foreground"
                      onClick={() => onDismiss(notice)}
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {dismissed === 0 ? null : (
              <div className="flex items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                <span className="flex-1">
                  {dismissed === 1 ? '1 dismissed item' : `${dismissed} dismissed items`} come back
                  when they change.
                </span>
                <Button
                  variant="ghost"
                  className="h-6 rounded-full px-2.5 text-xs font-normal text-muted-foreground"
                  onClick={onRestore}
                >
                  Show them again
                </Button>
              </div>
            )}
          </div>
          <div>
            <h2 className="pb-1 text-xs font-medium text-muted-foreground">Running</h2>
            {running.length === 0 ? (
              <p className="py-2.5 text-sm text-muted-foreground">Nothing is running.</p>
            ) : (
              <ul>
                {running.map((work) => (
                  <RunningRow key={work.id} work={work} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
