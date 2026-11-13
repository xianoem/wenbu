import { CaretDownIcon, CheckIcon, CopyIcon, WrenchIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { HookConfidence, OverlayHook } from '#contract/TranslationOverlay'
import { formatMoment } from '#lib/format'
import { Button } from '#ui/button'
import { ScrollArea } from '#ui/scroll-area'

const confidenceClass: Record<HookConfidence, string> = {
  High: 'bg-foreground text-background',
  Medium: 'bg-foreground/10 text-foreground',
  Low: 'border border-border text-muted-foreground',
}

function Samples({ hook }: { readonly hook: OverlayHook }) {
  if (hook.samples.length === 0) {
    return (
      <div className="rounded-lg bg-muted px-2 py-1 text-muted-foreground">No samples yet.</div>
    )
  }

  const first = hook.updateCount - hook.samples.length + 1

  const numbered = hook.samples
    .map((sample, position) => ({ sample, update: first + position }))
    .toReversed()

  return (
    <div className="space-y-1">
      {numbered.map(({ sample, update }) => (
        <div key={update} className="space-y-1 rounded-lg bg-muted px-2 py-1">
          <div>{sample.text}</div>
          {sample.text === sample.raw ? null : (
            <div className="border-t border-border/70 pt-1 text-[11px] text-muted-foreground">
              <div className="font-medium">Raw hook text</div>
              <div>{sample.raw}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function HookRow({
  hook,
  enabledProcessorCount,
  onSelect,
  onOpenTextProcessing,
}: {
  readonly hook: OverlayHook
  readonly enabledProcessorCount: number
  readonly onSelect: (hookId: string) => void
  readonly onOpenTextProcessing: (sample: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const latest = hook.samples.at(-1)

  const copyHook = () =>
    navigator.clipboard.writeText(hook.code).then(
      () => setCopied(true),
      () => setCopied(false),
    )

  return (
    <div
      className={cn(
        'rounded-xl border bg-card/80',
        hook.selected ? 'border-foreground/30' : 'border-border',
      )}
    >
      <Button
        variant="ghost"
        className="h-auto w-full items-start justify-start gap-3 rounded-xl p-3 text-left font-normal whitespace-normal hover:bg-transparent"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={cn(
            'mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            confidenceClass[hook.confidence],
          )}
        >
          {hook.confidence}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {hook.name === '' ? hook.code : hook.name}{' '}
            <span className="text-xs text-muted-foreground">pid {hook.processId}</span>
            {hook.manual ? (
              <span className="text-xs text-muted-foreground"> · inserted</span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {latest?.text ?? 'Waiting for sample text.'}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{hook.updateCount} updates</span>
            <span>/</span>
            <span>{formatMoment(hook.lastSeenAt)}</span>
            <span>/</span>
            <span>{hook.signal}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {hook.selected ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              <CheckIcon className="size-3.5" />
              Selected
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              render={<span />}
              nativeButton={false}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(hook.id)
              }}
            >
              Select
            </Button>
          )}
          <CaretDownIcon className={cn('size-3.5 transition', open && 'rotate-180')} />
        </span>
      </Button>
      {open ? (
        <ScrollArea className="h-72 overflow-hidden border-t border-border">
          <div className="space-y-3 p-3 text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">Hook code</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1 font-mono">
                  {hook.code}
                </code>
                <Button size="sm" variant="ghost" onClick={copyHook}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Scoring reasons / score {hook.score}</div>
              <div className="flex flex-wrap gap-1.5">
                {hook.reasons.map((reason) => (
                  <span key={reason} className="rounded-full bg-muted px-2 py-0.5">
                    {reason}
                  </span>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-2 text-left font-normal whitespace-normal"
              aria-label={`Text processing · ${enabledProcessorCount} enabled`}
              onClick={() => onOpenTextProcessing(latest?.raw ?? '')}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  <WrenchIcon className="mr-1 inline-block" />
                  Text processing · {enabledProcessorCount} enabled
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Configure the ordered transformation pipeline for this game.
                </div>
              </div>
            </Button>
            <div className="space-y-1">
              <div className="text-muted-foreground">Recent samples</div>
              <Samples hook={hook} />
            </div>
          </div>
        </ScrollArea>
      ) : null}
    </div>
  )
}
