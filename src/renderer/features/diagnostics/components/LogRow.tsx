import { CaretDownIcon, CaretRightIcon, CopyIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { LogEntry } from '#contract/Diagnostics'
import { formatLogEntry } from '#contract/LogText'
import { Button } from '#ui/button'
import { featureLabel, fieldsText, formatLogTime, levelLabels, processLabel } from '../diagnostics'
import { levelText } from './LevelDot'

export const logColumns = 'grid-cols-[18px_96px_52px_60px_128px_minmax(0,1fr)]'

function Details({ entry }: { readonly entry: LogEntry }) {
  const fields = Object.entries(entry.fields)

  return (
    <div className="flex flex-col gap-2.5 pt-1 pr-3.5 pb-3.5 pl-[46px]">
      {fields.length === 0 ? null : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1 font-mono text-xs">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.cause === undefined ? null : (
        <pre className="overflow-x-auto rounded-[10px] bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {entry.cause}
        </pre>
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => void navigator.clipboard.writeText(formatLogEntry(entry))}
        >
          <CopyIcon />
          Copy entry
        </Button>
      </div>
    </div>
  )
}

export function LogRow({
  entry,
  open,
  striped,
  onToggle,
}: {
  readonly entry: LogEntry
  readonly open: boolean
  readonly striped: boolean
  readonly onToggle: () => void
}) {
  const fields = fieldsText(entry)
  const Caret = open ? CaretDownIcon : CaretRightIcon

  return (
    <div
      className={cn(
        'rounded-xl',
        open && 'my-0.5 bg-foreground/[0.05] ring-1 ring-foreground/[0.09] ring-inset',
        !open && striped && 'bg-foreground/[0.018]',
      )}
    >
      <Button
        variant="ghost"
        aria-expanded={open}
        className={cn(
          'grid h-[30px] w-full items-center justify-start justify-items-start gap-3.5 rounded-xl px-3.5 text-left text-[12.5px] font-normal active:not-aria-[haspopup]:translate-y-0',
          logColumns,
          open
            ? 'hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent'
            : 'hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.04]',
        )}
        onClick={onToggle}
      >
        <Caret className="size-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatLogTime(entry.at)}
        </span>
        <span className={cn('text-[11px] font-semibold tracking-wide', levelText[entry.level])}>
          {levelLabels[entry.level]}
        </span>
        <span className="truncate font-mono text-muted-foreground">{processLabel(entry)}</span>
        <span className="truncate text-muted-foreground">{featureLabel(entry.feature)}</span>
        <span className="truncate">
          {entry.message}
          {fields === '' ? null : (
            <span className="ml-2 font-mono text-[11.5px] text-muted-foreground">{fields}</span>
          )}
        </span>
      </Button>
      {open ? <Details entry={entry} /> : null}
    </div>
  )
}
