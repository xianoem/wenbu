import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CursorIcon,
  DotsThreeIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  SelectionPlusIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { type ReactNode, useEffect, useRef } from 'react'
import { pageThumbnailUrl } from '#contract/PageImage'
import type { PictureStatus, PictureStyle } from '#contract/Pictures'
import { useLocalFonts } from '#lib/useLocalFonts'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Spinner } from '#ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { Kbd } from '../../mangaEditor/components/Kbd'
import type { PictureFilter, PictureGroup } from '../groups'
import { nextZoom, type StageTool } from './PictureStage'
import { PrimaryKbd } from './PrimaryKbd'

const dotColors: Record<PictureStatus, string> = {
  'to-review': 'bg-info',
  approved: 'bg-success',
  kept: 'bg-muted-foreground',
}

export const filterLabels: Record<PictureFilter, string> = {
  'to-review': 'To review',
  approved: 'Approved',
  kept: 'Kept original',
  all: 'All',
}

const filterOrder: ReadonlyArray<PictureFilter> = ['to-review', 'approved', 'kept', 'all']

function Frame({
  group,
  current,
  onSelect,
}: {
  readonly group: PictureGroup
  readonly current: boolean
  readonly onSelect: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const first = group.pictures[0]

  useEffect(() => {
    if (current) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
  }, [current])

  if (first === undefined) {
    return null
  }

  return (
    <Button
      ref={ref}
      variant="ghost"
      aria-label={first.picture}
      aria-current={current}
      className={cn(
        'checker relative h-9 w-16 shrink-0 overflow-hidden rounded-[7px] p-0 opacity-55 hover:opacity-90',
        current && 'opacity-100 ring-2 ring-primary',
      )}
      onClick={onSelect}
    >
      <img
        alt=""
        loading="lazy"
        draggable={false}
        src={pageThumbnailUrl(first.original, { size: 128 })}
        className="max-h-full max-w-full object-contain"
      />
      <span
        className={cn(
          'absolute right-1 bottom-1 size-1.5 rounded-full ring-[1.5px] ring-card',
          dotColors[group.status],
        )}
      />
      {group.pictures.length > 1 ? (
        <span className="absolute top-0.5 left-0.5 rounded-[4px] bg-black/70 px-1 text-[10px] leading-3.5 text-white">
          ×{group.pictures.length}
        </span>
      ) : null}
    </Button>
  )
}

function IconButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  readonly label: string
  readonly shortcut?: string
  readonly active?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active === true ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            className={cn('rounded-full', active !== true && 'text-muted-foreground')}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">
        {label}
        {shortcut === undefined ? null : <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

const Divider = () => <span className="mx-1 h-6 w-px shrink-0 bg-border" />

function FontSelect({
  style,
  onStyle,
}: {
  readonly style: PictureStyle
  readonly onStyle: (style: PictureStyle) => void
}) {
  const { fonts, load } = useLocalFonts()
  const items = Object.fromEntries([style.font, ...fonts].map((font) => [font, font]))

  return (
    <Select
      items={items}
      value={style.font}
      onOpenChange={load}
      onValueChange={(font) => {
        if (font !== null) {
          onStyle({ ...style, font })
        }
      }}
    >
      <SelectTrigger aria-label="Lettering font" size="sm" className="w-full rounded-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.keys(items).map((font) => (
          <SelectItem key={font} value={font}>
            <span style={{ fontFamily: `"${font}"` }}>{font}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MoreMenu({
  filter,
  counts,
  style,
  onFilter,
  onStyle,
}: {
  readonly filter: PictureFilter
  readonly counts: Readonly<Record<PictureFilter, number>>
  readonly style: PictureStyle
  readonly onFilter: (filter: PictureFilter) => void
  readonly onStyle: (style: PictureStyle) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More"
            className="rounded-full text-muted-foreground"
          >
            <DotsThreeIcon />
          </Button>
        }
      />
      <PopoverContent side="top" align="end" sideOffset={10} className="w-60 rounded-2xl p-1.5">
        <p className="px-2.5 pt-1 pb-1 text-xs text-muted-foreground">Show</p>
        {filterOrder.map((option) => (
          <Button
            key={option}
            variant="ghost"
            aria-pressed={filter === option}
            className={cn(
              'h-8 w-full justify-start gap-2 rounded-[10px] px-2.5 text-[13px] font-normal',
              filter === option && 'bg-muted',
            )}
            onClick={() => onFilter(option)}
          >
            <span className="flex-1 text-left">{filterLabels[option]}</span>
            <span className="text-muted-foreground tabular-nums">{counts[option]}</span>
            <CheckIcon className={cn(filter !== option && 'invisible')} />
          </Button>
        ))}
        <div className="mx-1.5 my-1.5 h-px bg-border" />
        <p className="px-2.5 pb-1.5 text-xs text-muted-foreground">Lettering font</p>
        <div className="px-1.5 pb-1">
          <FontSelect style={style} onStyle={onStyle} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ReviewDock({
  groups,
  current,
  approving,
  canApprove,
  tool,
  zoom,
  filter,
  counts,
  style,
  onSelect,
  onStep,
  onKeep,
  onApprove,
  onTool,
  onZoom,
  onFilter,
  onStyle,
}: {
  readonly groups: ReadonlyArray<PictureGroup>
  readonly current: string | undefined
  readonly approving: boolean
  readonly canApprove: boolean
  readonly tool: StageTool
  readonly zoom: number
  readonly filter: PictureFilter
  readonly counts: Readonly<Record<PictureFilter, number>>
  readonly style: PictureStyle
  readonly onSelect: (group: string) => void
  readonly onStep: (step: 1 | -1) => void
  readonly onKeep: () => void
  readonly onApprove: () => void
  readonly onTool: (tool: StageTool) => void
  readonly onZoom: (zoom: number) => void
  readonly onFilter: (filter: PictureFilter) => void
  readonly onStyle: (style: PictureStyle) => void
}) {
  const index = groups.findIndex((group) => group.key === current)
  const variants = groups[index]?.pictures.length ?? 1

  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1 rounded-[20px] bg-card/95 px-2 py-1.5 shadow-[0_10px_30px_rgb(0_0_0/0.5),0_0_0_1px_oklch(1_0_0/0.07)]">
      <IconButton label="Previous picture" shortcut="←" onClick={() => onStep(-1)}>
        <CaretLeftIcon />
      </IconButton>
      <div className="no-scrollbar flex max-w-[300px] min-w-0 items-center gap-1.5 overflow-x-auto px-0.5 py-1">
        {groups.map((group) => (
          <Frame
            key={group.key}
            group={group}
            current={group.key === current}
            onSelect={() => onSelect(group.key)}
          />
        ))}
      </div>
      <IconButton label="Next picture" shortcut="→" onClick={() => onStep(1)}>
        <CaretRightIcon />
      </IconButton>
      <Divider />
      <IconButton
        label="Select lines"
        shortcut="V"
        active={tool === 'select'}
        onClick={() => onTool('select')}
      >
        <CursorIcon />
      </IconButton>
      <IconButton
        label="Add text OCR missed"
        shortcut="A"
        active={tool === 'draw'}
        onClick={() => onTool('draw')}
      >
        <SelectionPlusIcon />
      </IconButton>
      <IconButton label="Zoom out" shortcut="−" onClick={() => onZoom(nextZoom(zoom, -1))}>
        <MagnifyingGlassMinusIcon />
      </IconButton>
      <Button
        variant="ghost"
        aria-label="Fit the picture"
        className="h-7 w-11 rounded-full px-0 text-xs text-muted-foreground tabular-nums"
        onClick={() => onZoom(1)}
      >
        {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
      </Button>
      <IconButton label="Zoom in" shortcut="+" onClick={() => onZoom(nextZoom(zoom, 1))}>
        <MagnifyingGlassPlusIcon />
      </IconButton>
      <Divider />
      <Button variant="outline" className="h-7 rounded-full px-3 text-[12.5px]" onClick={onKeep}>
        Keep original
      </Button>
      <Button
        className="h-7 rounded-full px-3 text-[12.5px]"
        disabled={!canApprove || approving}
        onClick={onApprove}
      >
        {approving ? <Spinner /> : <CheckIcon />}
        {variants > 1 ? `Approve ${variants}` : 'Approve'} <PrimaryKbd>↵</PrimaryKbd>
      </Button>
      <MoreMenu
        filter={filter}
        counts={counts}
        style={style}
        onFilter={onFilter}
        onStyle={onStyle}
      />
    </div>
  )
}
