import { useAtomSet } from '@effect/atom-react'
import {
  CaretDownIcon,
  CaretUpIcon,
  CircleNotchIcon,
  CopyIcon,
  ImageIcon,
  ScanIcon,
  SelectionIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { Detection, DetectionInput, PendingDetection } from '#contract/Detections'
import { formatMoment } from '#lib/format'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { ScrollArea } from '#ui/scroll-area'
import { Separator } from '#ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { removeDetectionAtom } from '../detections'

export type DetectionItem =
  | { readonly kind: 'pending'; readonly pending: PendingDetection }
  | { readonly kind: 'detection'; readonly detection: Detection }

const inputLabels: Record<DetectionInput, string> = { image: 'Image', clipboard: 'Clipboard' }

function InputIcon({
  input,
  className,
}: {
  readonly input: DetectionInput
  readonly className: string
}) {
  return input === 'image' ? (
    <ImageIcon className={className} />
  ) : (
    <SelectionIcon className={className} />
  )
}

const Dot = () => <span className="size-0.5 rounded-full bg-muted-foreground/70" />

function TranslationMeta({ detection }: { readonly detection: Detection }) {
  const translation = detection.translation

  if (translation === undefined) {
    return <span className="italic">Not translated</span>
  }

  if (translation.status === 'failed') {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex items-center gap-1 text-destructive">
              <WarningCircleIcon className="size-3" />
              {translation.presetName}
            </span>
          }
        />
        <TooltipContent className="max-w-72">
          {translation.error ?? 'Translation failed.'}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      <SparkleIcon className="size-3 text-foreground/70" />
      {translation.presetName}
    </span>
  )
}

function PendingRow({ pending }: { readonly pending: PendingDetection }) {
  return (
    <div className="flex gap-[11px] rounded-2xl rounded-l-md border-l-2 border-l-foreground/35 bg-muted/35 px-2.5 py-[11px] pl-3">
      <div className="mt-px flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-foreground/10">
        <CircleNotchIcon className="size-[15px] animate-spin" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="text-[13.5px] leading-[1.35] text-muted-foreground italic">
          Detecting text…
        </div>
        <div className="mt-px flex items-center gap-[7px] text-[11.5px] leading-none text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <InputIcon input={pending.input} className="size-3" />
            {inputLabels[pending.input]}
          </span>
          <Dot />
          <span>just now</span>
        </div>
      </div>
    </div>
  )
}

function FinishedRow({ detection }: { readonly detection: Detection }) {
  const remove = useAtomSet(removeDetectionAtom)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const original = detection.originalText
  const translated = detection.translatedText
  const expandable = original.length > 64 || (translated?.length ?? 0) > 96
  const open = expandable && expanded

  const copyOriginal = () => {
    void navigator.clipboard.writeText(original).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setExpanded}
      className="group/det flex gap-[11px] rounded-2xl rounded-l-md border-l-2 border-l-transparent bg-muted/35 px-2.5 py-[11px] pl-3 transition-colors hover:bg-muted/55"
    >
      <div className="mt-px flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-foreground/10">
        <InputIcon input={detection.input} className="size-[15px]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {open ? (
              <CollapsibleContent className="overflow-hidden">
                <ScrollArea
                  aria-label="Expanded detection text"
                  className="pr-2 **:data-[slot=scroll-area-viewport]:max-h-[200px]"
                >
                  <div className="space-y-3 pr-2">
                    {translated === undefined ? null : (
                      <>
                        <div className="text-[13.5px] leading-relaxed font-medium break-words whitespace-pre-wrap">
                          {translated}
                        </div>
                        <Separator />
                      </>
                    )}
                    <div className="text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                      {original}
                    </div>
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            ) : (
              <>
                <div className="line-clamp-2 text-[13.5px] leading-[1.35] font-medium">
                  {translated ?? original}
                </div>
                {translated === undefined ? null : (
                  <div
                    className="mt-[3px] truncate text-xs leading-[1.35] text-muted-foreground"
                    title={original}
                  >
                    {original}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="inline-flex shrink-0 items-start gap-0.5">
            <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover/det:opacity-100">
              <Button
                size="icon"
                variant="ghost"
                title={copied ? 'Copied' : 'Copy original text'}
                aria-label="Copy original text"
                className="size-[26px] rounded-full text-muted-foreground hover:text-foreground"
                onClick={copyOriginal}
              >
                <CopyIcon className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Remove detection"
                aria-label="Remove detection"
                className="size-[26px] rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                onClick={() => remove({ payload: { id: detection.id } })}
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
            {expandable ? (
              <CollapsibleTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={open ? 'Hide full text' : 'Show full text'}
                    className={cn(
                      'size-[26px] rounded-full text-muted-foreground/60 group-hover/det:text-muted-foreground hover:text-foreground',
                      open && 'bg-foreground/10 text-foreground',
                    )}
                  />
                }
              >
                {open ? (
                  <CaretUpIcon className="size-3.5" />
                ) : (
                  <CaretDownIcon className="size-3.5" />
                )}
              </CollapsibleTrigger>
            ) : null}
          </div>
        </div>
        <div className="mt-px flex flex-wrap items-center gap-[7px] text-[11.5px] leading-none text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <InputIcon input={detection.input} className="size-3" />
            {inputLabels[detection.input]}
          </span>
          <Dot />
          <span>{formatMoment(detection.detectedAt).toLowerCase()}</span>
          <Dot />
          <span className="inline-flex items-center gap-1">
            <ScanIcon className="size-3 text-foreground/70" />
            {detection.engine.label}
          </span>
          <Dot />
          <TranslationMeta detection={detection} />
        </div>
      </div>
    </Collapsible>
  )
}

export function DetectionRow({ item }: { readonly item: DetectionItem }) {
  return item.kind === 'pending' ? (
    <PendingRow pending={item.pending} />
  ) : (
    <FinishedRow detection={item.detection} />
  )
}
