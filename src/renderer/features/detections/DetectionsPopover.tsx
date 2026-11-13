import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  CaretLeftIcon,
  CaretRightIcon,
  CloudIcon,
  GearIcon,
  ImageIcon,
  InfoIcon,
  PuzzlePieceIcon,
  ScanIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { type DragEvent, useRef, useState } from 'react'
import {
  detectionHistoryLimit,
  type DetectionEngine,
  type DetectionSettings,
  type DetectionsState,
} from '#contract/Detections'
import { screenAtom, settingsPageAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { type DetectionItem, DetectionRow } from './components/DetectionRow'
import { isPluginReady, pluginsAtom } from '../plugins/plugins'
import {
  detectImageAtom,
  detectionSettingsAtom,
  detectionSettingsKeys,
  detectionsAtom,
  saveDetectionSettingsAtom,
} from './detections'
import { imagePixels } from './utils/imagePixels'
import { InGameTextHint } from '../ingametext/InGameTextHint'

const perPage = 6

const Key = ({ children }: { readonly children: string }) => (
  <kbd className="rounded-md bg-foreground/10 px-1.5 py-px font-mono text-[10.5px] font-medium text-foreground">
    {children}
  </kbd>
)

function SetupBanner({
  engine,
  settings,
}: {
  readonly engine: DetectionEngine | undefined
  readonly settings: DetectionSettings
}) {
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const save = useAtomSet(saveDetectionSettingsAtom)
  const chosen = settings.engineId !== undefined
  const needsPlugin = !isPluginReady(useAtomValue(pluginsAtom), 'screen-ai')

  const chooseLens = () =>
    save({
      payload: { ...settings, engineId: 'google-lens' },
      reactivityKeys: detectionSettingsKeys,
    })

  const open = () => {
    if (needsPlugin) {
      setScreen('plugins')

      return
    }

    setSettingsPage('detections')
    setScreen('settings')
  }

  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-destructive/10 px-3.5 py-3 text-sm">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {chosen ? 'Selected engine is not ready' : 'Detection engine required'}
          </div>
          <div className="text-[13px] text-muted-foreground">
            {chosen
              ? (engine?.detail ?? 'The selected engine needs setup before it can run.')
              : needsPlugin
                ? 'Install Chrome Screen AI from Plugins, or use Google Lens in the cloud.'
                : 'Choose Chrome Screen AI or Google Lens in Settings → Detections before detecting text.'}
          </div>
        </div>
        <span className="flex shrink-0 gap-1.5">
          {!chosen && needsPlugin ? (
            <Button size="sm" variant="ghost" className="rounded-full" onClick={chooseLens}>
              <CloudIcon />
              Use Google Lens
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="rounded-full" onClick={open}>
            {needsPlugin ? <PuzzlePieceIcon /> : <GearIcon />}
            {needsPlugin ? 'Plugins' : 'Settings'}
          </Button>
        </span>
      </div>
    </div>
  )
}

function ClipboardHint({ listening }: { readonly listening: boolean }) {
  return (
    <div className="mt-[-2px] flex items-center gap-1.5 px-1.5 text-[11px] leading-5 text-muted-foreground">
      <InfoIcon className="size-3 shrink-0" />
      {!listening ? (
        <span>Clipboard detection is off in Settings → Detections.</span>
      ) : window.wenbu.platform === 'win32' ? (
        <span>
          Snips on your clipboard are detected automatically with <Key>Win</Key> <Key>Shift</Key>{' '}
          <Key>S</Key>.
        </span>
      ) : (
        <span>Images copied to the clipboard are detected automatically.</span>
      )}
    </div>
  )
}

function DetectionsList({ state }: { readonly state: DetectionsState }) {
  const [page, setPage] = useState(1)

  const items: ReadonlyArray<DetectionItem> = [
    ...state.pending.map((pending) => ({ kind: 'pending' as const, pending })),
    ...state.detections.map((detection) => ({ kind: 'detection' as const, detection })),
  ]

  const total = items.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(page, pages)
  const start = (current - 1) * perPage
  const shown = items.slice(start, start + perPage)

  return (
    <>
      <div className="flex items-center gap-2.5 px-1 text-xs font-medium text-muted-foreground">
        <span>Recent</span>
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] text-foreground tabular-nums">
          {total}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <ScrollArea className="h-[430px] overflow-hidden rounded-[18px]">
        <div className="flex flex-col gap-1.5 pr-2 pb-1">
          {shown.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No detections yet. Drop an image or snip a region to begin.
            </div>
          ) : (
            shown.map((item) => (
              <DetectionRow
                key={item.kind === 'pending' ? item.pending.id : item.detection.id}
                item={item}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between px-1.5 pt-1">
        <div className="text-xs text-muted-foreground tabular-nums">
          {total === 0 ? (
            'No detections'
          ) : current === pages ? (
            `Showing the latest ${detectionHistoryLimit} detections`
          ) : (
            <>
              <b className="font-medium text-foreground">
                {start + 1}–{Math.min(start + perPage, total)}
              </b>{' '}
              of {total}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Go to previous page"
            disabled={current <= 1}
            className="size-7 rounded-full"
            onClick={() => setPage(Math.max(1, current - 1))}
          >
            <CaretLeftIcon className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Go to next page"
            disabled={current >= pages}
            className="size-7 rounded-full"
            onClick={() => setPage(Math.min(pages, current + 1))}
          >
            <CaretRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </>
  )
}

export function DetectionsPopover() {
  const stateResult = useAtomValue(detectionsAtom)
  const settingsResult = useAtomValue(detectionSettingsAtom)
  const detect = useAtomSet(detectImageAtom)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [readError, setReadError] = useState<string | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const state = AsyncResult.isSuccess(stateResult) ? stateResult.value : undefined
  const settings = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : undefined
  const engine = state?.engines.find((candidate) => candidate.id === settings?.engineId)

  const setupRequired =
    settings !== undefined && (settings.engineId === undefined || engine?.ready !== true)

  const error = readError ?? state?.lastError

  const handleFile = (file: File | undefined) => {
    if (file === undefined || setupRequired) {
      return
    }

    setReadError(undefined)

    imagePixels(file).then(
      (image) => detect({ payload: image }),
      () => setReadError('The file is not an image Wenbu can read.'),
    )
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFile(event.dataTransfer.files[0])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Detections"
            className={cn(
              'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
              open && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
            )}
          />
        }
      >
        <ScanIcon />
        Detections
        {state !== undefined && state.pending.length > 0 ? (
          <span
            aria-label="Detection in progress"
            className="ml-auto size-2 animate-pulse rounded-full bg-warning"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={24}
        className="flex w-[544px] flex-col gap-3 rounded-[22px] bg-popover/75 p-4 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-center px-1 pt-0.5">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <ScanIcon className="size-4 text-muted-foreground" />
            Detections
          </div>
        </div>

        {setupRequired ? <SetupBanner engine={engine} settings={settings} /> : null}

        {error === undefined ? null : (
          <div className="flex items-start gap-2.5 rounded-2xl bg-muted/50 px-3.5 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">Detection did not finish</div>
              <div className="text-[13px] text-muted-foreground">{error}</div>
            </div>
          </div>
        )}

        <div
          role="button"
          tabIndex={setupRequired ? -1 : 0}
          aria-disabled={setupRequired}
          className={cn(
            'flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-full border-[1.5px] border-dashed border-foreground/20 bg-input/35 px-1.5 pl-3.5 transition-colors hover:bg-input/50',
            dragging && 'border-primary bg-primary/10',
            setupRequired && 'cursor-not-allowed opacity-60',
          )}
          onClick={() => !setupRequired && fileRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !setupRequired) {
              fileRef.current?.click()
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[9px] bg-foreground/10">
            <ImageIcon className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[13px] font-medium">
              {dragging ? 'Drop to detect text' : 'Drop an image to detect text'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              PNG, JPG or WebP – or copy one to the clipboard
            </span>
          </span>
          <Button
            size="sm"
            disabled={setupRequired}
            className="h-7 rounded-full px-3 text-xs"
            onClick={(event) => {
              event.stopPropagation()
              fileRef.current?.click()
            }}
          >
            <UploadSimpleIcon />
            Browse
          </Button>
          <Input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="Image to detect text in"
            className="hidden"
            onChange={(event) => {
              handleFile(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </div>

        {settings === undefined ? null : <ClipboardHint listening={settings.listenToClipboard} />}

        {state !== undefined && state.detections.length > 0 ? <InGameTextHint /> : null}

        {state === undefined ? null : <DetectionsList state={state} />}
      </PopoverContent>
    </Popover>
  )
}
