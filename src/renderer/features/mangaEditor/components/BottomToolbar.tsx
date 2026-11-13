import { useAtomValue } from '@effect/atom-react'
import {
  ArrowsOutSimpleIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ChatsCircleIcon,
  CircleNotchIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import type { ReactNode } from 'react'
import type { MangaRunUsage, MangaRuntimeState } from '#contract/Manga'
import type { EditorPage } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { Slider } from '#ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { mangaRuntimeAtom } from '../../manga/manga'
import { Kbd } from './Kbd'
import { PagePicker } from './PagePicker'
import type { Zoom } from './PageView'
import { SettingsPopover } from './SettingsPopover'

const formatUsage = (usage: MangaRunUsage) => {
  const tokens = usage.inputTokens + usage.outputTokens
  const count = `${tokens.toLocaleString('en-US')} tokens`

  return usage.costUsd === undefined ? count : `${count} · $${usage.costUsd.toFixed(3)}`
}

const runtimeLabels: Record<MangaRuntimeState['status'], string> = {
  'not-installed': 'Not installed',
  stopped: 'Ready',
  starting: 'Starting',
  'loading-models': 'Loading models',
  ready: 'Ready',
  busy: 'Working',
  failed: 'Stopped',
}

function runtimeTone(status: MangaRuntimeState['status']) {
  if (status === 'failed' || status === 'not-installed') {
    return 'text-destructive'
  }

  return status === 'ready' || status === 'stopped' ? 'text-success' : 'text-warning'
}

const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4]

type Fit = 'fit' | 'width' | 'actual'

const fitOf = (zoom: Zoom): Fit | '' => {
  if (zoom === 'fit' || zoom === 'width') {
    return zoom
  }

  return zoom === 1 ? 'actual' : ''
}

function Tip({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{children}</span>} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function Divider() {
  return <div className="h-5 w-px shrink-0 bg-border" />
}

export function BottomToolbar({
  folder,
  pages,
  index,
  usage,
  chat,
  canUndo,
  canRedo,
  zoom,
  scale,
  onChat,
  onPage,
  onUndo,
  onRedo,
  onZoom,
}: {
  readonly folder: string
  readonly pages: ReadonlyArray<EditorPage>
  readonly index: number
  readonly usage: MangaRunUsage
  readonly chat: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly zoom: Zoom
  readonly scale: number
  readonly onChat: () => void
  readonly onPage: (index: number) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onZoom: (zoom: Zoom) => void
}) {
  const runtime = useAtomValue(mangaRuntimeAtom)
  const status = AsyncResult.isSuccess(runtime) ? runtime.value.status : 'stopped'
  const busy = status === 'busy' || status === 'starting' || status === 'loading-models'
  const smaller = steps.findLast((step) => step < scale - 0.001) ?? steps[0] ?? 0.1
  const larger = steps.find((step) => step > scale + 0.001) ?? steps.at(-1) ?? 4
  const page = pages[index]

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-sidebar px-2">
      <Button
        variant="ghost"
        className={cn(
          'h-7 gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ring-1 ring-foreground/8',
          chat ? 'bg-info/15 text-info ring-info/40' : 'bg-muted/50',
        )}
        onClick={onChat}
      >
        <ChatsCircleIcon className="size-3.5" />
        Chat
        <Kbd>C</Kbd>
      </Button>
      <PagePicker folder={folder} pages={pages} index={index} onPage={onPage} />
      <Divider />
      <Tip label="Undo · Ctrl Z">
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <ArrowUUpLeftIcon />
        </Button>
      </Tip>
      <Tip label="Redo · Ctrl Shift Z">
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <ArrowUUpRightIcon />
        </Button>
      </Tip>
      <Divider />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              aria-label="Fit mode"
            >
              <ArrowsOutSimpleIcon />
            </Button>
          }
        />
        <DropdownMenuContent side="top" align="start" className="w-40">
          <DropdownMenuRadioGroup
            value={fitOf(zoom)}
            onValueChange={(value) => {
              if (value === 'fit' || value === 'width') {
                onZoom(value)
              }

              if (value === 'actual') {
                onZoom(1)
              }
            }}
          >
            <DropdownMenuRadioItem value="fit">Fit page</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="width">Fit width</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="actual">Actual size</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tip label="Zoom out">
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          aria-label="Zoom out"
          onClick={() => onZoom(smaller)}
        >
          <MagnifyingGlassMinusIcon />
        </Button>
      </Tip>
      <div className="w-32 shrink-0">
        <Slider
          aria-label="Zoom"
          value={[Math.round(scale * 100)]}
          min={10}
          max={400}
          onValueChange={(value) =>
            onZoom((Array.isArray(value) ? (value[0] ?? 100) : value) / 100)
          }
        />
      </div>
      <Tip label="Zoom in">
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          aria-label="Zoom in"
          onClick={() => onZoom(larger)}
        >
          <MagnifyingGlassPlusIcon />
        </Button>
      </Tip>
      <span className="w-11 shrink-0 text-center font-mono text-[12px] font-semibold tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <div className="min-w-0 flex-1" />
      <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap text-muted-foreground">
        {formatUsage(usage)}
      </span>
      <SettingsPopover folder={folder} pageHeight={pages[index]?.height} />
      <span
        className={cn(
          'flex h-6.5 shrink-0 items-center gap-1.5 rounded-full bg-muted/50 px-2.5 text-[12px] font-semibold whitespace-nowrap ring-1 ring-foreground/8',
          runtimeTone(status),
        )}
      >
        {busy ? (
          <CircleNotchIcon className="size-3.5 animate-spin" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
        {runtimeLabels[status]}
      </span>
      <span className="max-w-[24vw] min-w-0 truncate font-mono text-[11px] text-muted-foreground">
        {page?.name ?? ''}
      </span>
    </div>
  )
}
