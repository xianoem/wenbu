import { useAtomValue } from '@effect/atom-react'
import { CheckIcon, CopyIcon, ScanIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { Detection } from '#contract/Detections'
import { formatMoment } from '#lib/format'
import { Button } from '#ui/button'
import { detectionSettingsAtom, detectionsAtom } from '../../detections/detections'
import { PanelLabel } from './PanelLabel'

function DetectionCard({ detection }: { readonly detection: Detection }) {
  const [copied, setCopied] = useState(false)
  const text = detection.translatedText ?? detection.originalText

  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
    })

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-foreground/3.5 p-3 ring-1 ring-foreground/5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {detection.translatedText === undefined ||
        detection.translatedText === detection.originalText ? null : (
          <p className="line-clamp-2 text-xs text-muted-foreground">{detection.originalText}</p>
        )}
        <p className="line-clamp-3 text-[13px] font-medium">{text}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? 'Copied' : 'Copy the translation'}
        className="-mt-1 -mr-1 shrink-0 rounded-full text-muted-foreground"
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

function EmptyDetections({ listening }: { readonly listening: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-foreground/3.5 px-3 py-3.5 ring-1 ring-foreground/5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-tint-slate text-tint-slate-foreground">
        <ScanIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium">No Detections yet</span>
        <span className="text-xs text-muted-foreground">
          {listening
            ? 'Copy a screenshot (Win+Shift+S) and it shows here'
            : 'Turn on Watch copied images below, or translate an image'}
        </span>
      </div>
    </div>
  )
}

export function LatestDetection() {
  const state = useAtomValue(detectionsAtom)
  const settings = useAtomValue(detectionSettingsAtom)
  const latest = AsyncResult.isSuccess(state) ? state.value.detections[0] : undefined
  const reading = AsyncResult.isSuccess(state) && state.value.pending.length > 0
  const listening = AsyncResult.isSuccess(settings) && settings.value.listenToClipboard

  return (
    <section className="flex flex-col gap-2">
      <PanelLabel
        aside={latest === undefined || reading ? undefined : formatMoment(latest.detectedAt)}
      >
        {reading ? 'Reading a copied image…' : 'Latest Detection'}
      </PanelLabel>
      {latest === undefined ? (
        <EmptyDetections listening={listening} />
      ) : (
        <DetectionCard detection={latest} />
      )}
    </section>
  )
}
