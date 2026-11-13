import { ArrowsInLineHorizontalIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { GameEngine } from '#contract/Library'
import { type Fit, type FitKind, fitOf, measure } from '#contract/TextFit'
import { Button } from '#ui/button'

const kindLabels: Record<FitKind, string> = {
  message: 'Message window',
  choice: 'Choice',
  scroll: 'Scrolling text',
  help: 'Help window',
  item: 'Item list',
  battle: 'Battle log',
}

const splitAt = (line: string, maxWidth: number, fontSize: number) => {
  let cut = line.length

  while (cut > 0 && measure(line.slice(0, cut), fontSize) > maxWidth) {
    cut--
  }

  return [line.slice(0, cut), line.slice(cut)] as const
}

const statusOf = (fit: Fit) => {
  if (fit.extraLines > 0) {
    return `${fit.lines.length} of ${fit.maxLines ?? fit.lines.length} lines`
  }

  return fit.overflowPx > 0 ? `Too long by ${fit.overflowPx} px` : 'Fits'
}

export function FitPreview({
  engine,
  context,
  text,
  shortening,
  onShorten,
}: {
  readonly engine: GameEngine
  readonly context: string
  readonly text: string
  readonly shortening: boolean
  readonly onShorten: (() => void) | undefined
}) {
  const fit = fitOf(engine, context, text)

  if (fit === undefined || text.trim() === '') {
    return null
  }

  const scale = Math.min(1, 360 / fit.maxWidth)
  const rows = fit.lines.map((line, row) => ({ ...line, row }))
  const tooLong = fit.status === 'too-long'

  return (
    <div className="mt-2.5 rounded-2xl bg-card p-3">
      <div className="overflow-x-auto rounded-lg bg-linear-to-b from-[oklch(0.33_0.06_260/0.92)] to-[oklch(0.22_0.05_260/0.92)] p-2 shadow-[inset_0_0_0_2px_oklch(1_0_0/0.5)]">
        <div
          className="relative border-r border-dashed border-warning/70 leading-[1.45] whitespace-pre text-white"
          style={{ width: fit.maxWidth * scale, fontSize: fit.fontSize * scale }}
        >
          {rows.map((line) => {
            const [fits, past] = splitAt(line.text, fit.maxWidth, fit.fontSize)
            const extra = fit.maxLines !== undefined && line.row >= fit.maxLines

            return (
              <div key={line.row} className={cn(extra && 'text-warning')}>
                {fits === '' && past === '' ? ' ' : fits}
                {past === '' ? null : (
                  <span className="rounded-sm bg-warning/30 text-warning">{past}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 font-medium',
            tooLong ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {statusOf(fit)}
        </span>
        <span className="text-muted-foreground">
          {kindLabels[fit.kind]} · {fit.maxWidth} px · {fit.fontSize} px font
          {fit.maxLines === undefined ? '' : ` · ${fit.maxLines} lines`} · estimated
        </span>
        <span className="flex-1" />
        {tooLong && onShorten !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-full px-2 text-xs font-normal"
            disabled={shortening}
            onClick={onShorten}
          >
            <ArrowsInLineHorizontalIcon />
            {shortening ? 'Shortening…' : 'Shorten'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
