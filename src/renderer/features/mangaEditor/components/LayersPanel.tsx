import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderSimpleIcon,
  ImageIcon,
  MagicWandIcon,
  SparkleIcon,
  TextTIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { type EditorPage, sizingOf } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Kbd } from './Kbd'
import type { Line } from './Lines'
import { customSize } from '../lettering/bubbleLayout'
import { type PageSizing, type TypeActions, TypeProperties } from './TypeProperties'

export interface LayerActions extends TypeActions {
  readonly cleanPage: () => void
}

const groupRows = 4

function Eye({
  shown,
  label,
  disabled,
  onShown,
}: {
  readonly shown: boolean
  readonly label: string
  readonly disabled?: boolean
  readonly onShown: (shown: boolean) => void
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      aria-pressed={shown}
      disabled={disabled}
      className={cn(
        'shrink-0 rounded-md',
        shown ? 'text-muted-foreground' : 'text-muted-foreground/35',
      )}
      onClick={() => onShown(!shown)}
    >
      {shown ? <EyeIcon /> : <EyeSlashIcon />}
    </Button>
  )
}

function Status({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex h-5.5 items-center gap-1.5 rounded-full bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-success" />
      {children}
    </span>
  )
}

function RunButton({
  running,
  done,
  label,
  onRun,
}: {
  readonly running: boolean
  readonly done: boolean
  readonly label: string
  readonly onRun: () => void
}) {
  return (
    <Button
      size="xs"
      variant={done ? 'outline' : 'default'}
      className="rounded-full"
      disabled={running}
      onClick={onRun}
    >
      {running ? <CircleNotchIcon className="animate-spin" /> : null}
      {!running && done ? <ArrowsClockwiseIcon /> : null}
      {!running && !done ? <SparkleIcon /> : null}
      {done ? 'Again' : label}
    </Button>
  )
}

export function LayersPanel({
  page,
  lines,
  selected,
  galleryFont,
  sizing,
  textShown,
  cleanShown,
  actions,
  onSelect,
  onTextShown,
  onCleanShown,
  onScript,
}: {
  readonly page: EditorPage
  readonly lines: ReadonlyArray<Line>
  readonly selected: string | undefined
  readonly galleryFont: string
  readonly sizing: PageSizing
  readonly textShown: boolean
  readonly cleanShown: boolean
  readonly actions: LayerActions
  readonly onSelect: (id: string) => void
  readonly onTextShown: (shown: boolean) => void
  readonly onCleanShown: (shown: boolean) => void
  readonly onScript: () => void
}) {
  const blocks = page.blocks
  const [textOpen, setTextOpen] = useState(blocks.length <= groupRows)
  const line = lines.find((candidate) => candidate.some((block) => block.id === selected))
  const block = line?.find((candidate) => candidate.id === selected)

  const numberOf = (id: string) =>
    String(blocks.findIndex((each) => each.id === id) + 1).padStart(2, '0')

  const overflowing = new Set(
    blocks
      .filter((each) => actions.layout(each, each.lettering)?.fits === false)
      .map((each) => each.id),
  )

  const cleaned = page.cleanVersion > 0
  const cleaning = page.running === 'clean'

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <div className="flex rounded-full bg-muted/50 p-0.5 ring-1 ring-foreground/8">
          <Button
            size="xs"
            variant="ghost"
            className="h-6 rounded-full text-muted-foreground"
            onClick={onScript}
          >
            Script
          </Button>
          <Button size="xs" variant="secondary" className="h-6 rounded-full">
            Layers
          </Button>
        </div>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">
          {blocks.length} {blocks.length === 1 ? 'bubble' : 'bubbles'}
        </span>
      </div>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <div className="flex flex-col">
          <div className="flex h-8 items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-medium">
            <Eye shown={textShown} label="Show the lettering" onShown={onTextShown} />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={textOpen ? 'Collapse Text' : 'Expand Text'}
              className="shrink-0 rounded-md text-muted-foreground"
              onClick={() => setTextOpen(!textOpen)}
            >
              {textOpen ? <CaretDownIcon /> : <CaretRightIcon />}
            </Button>
            <FolderSimpleIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Text</span>
            {overflowing.size === 0 ? null : (
              <span className="flex h-5.5 items-center gap-1.5 rounded-full bg-warning/12 px-2 text-[11px] font-medium text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                {overflowing.size} {overflowing.size === 1 ? "doesn't" : "don't"} fit
              </span>
            )}
          </div>
          {textOpen ? (
            <div className="ml-4.5 flex flex-col gap-px border-l pl-2">
              {blocks.map((each) => (
                <Button
                  key={each.id}
                  variant="ghost"
                  onClick={() => onSelect(each.id)}
                  className={cn(
                    'h-7 justify-start gap-1.5 rounded-md pr-1.5 pl-0.5 text-[12px] font-normal',
                    selected === each.id
                      ? 'bg-info/14 text-foreground ring-1 ring-info/45 hover:bg-info/14'
                      : 'text-muted-foreground',
                  )}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-[10.5px]">
                    {numberOf(each.id)}
                  </span>
                  <TextTIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {each.translation || each.source}
                  </span>
                  {sizingOf(each.lettering) === 'custom' ? (
                    <span
                      title="Has a size of its own"
                      className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[9.5px] text-muted-foreground"
                    >
                      {customSize(each.lettering, sizing.scale)}
                    </span>
                  ) : null}
                  {overflowing.has(each.id) ? (
                    <span
                      title="The text doesn't fit its box"
                      className="size-1.5 shrink-0 rounded-full bg-warning"
                    />
                  ) : null}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex h-8 items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-medium">
          <Eye
            shown={cleanShown}
            label="Show the cleanup"
            disabled={!cleaned}
            onShown={onCleanShown}
          />
          <span className="size-6 shrink-0" />
          <MagicWandIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Cleanup</span>
          {cleaned && !cleaning ? <Status>Cleaned</Status> : null}
          <RunButton running={cleaning} done={cleaned} label="Clean up" onRun={actions.cleanPage} />
        </div>
        <span className="flex items-center gap-1.5 pl-15 text-[11.5px] text-muted-foreground">
          Leftovers? Brush over them with <Kbd>B</Kbd>
        </span>
        <div className="flex h-8 items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-medium">
          <span className="size-6 shrink-0" />
          <span className="size-6 shrink-0" />
          <ImageIcon className="size-4 text-muted-foreground" />
          <span className="flex-1">Original page</span>
        </div>
        {page.error === undefined || page.running !== undefined ? null : (
          <span className="px-2 text-[12px] text-destructive">{page.error}</span>
        )}
      </div>
      {block === undefined || line === undefined ? null : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-t px-4 pt-3">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
              Type
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-muted-foreground">
              Text · {numberOf(block.id)}
            </span>
          </div>
          <div className="no-scrollbar max-h-[62%] shrink-0 overflow-y-auto px-4 pt-3 pb-4">
            <TypeProperties
              key={block.id}
              line={line}
              block={block}
              galleryFont={galleryFont}
              sizing={sizing}
              actions={actions}
            />
          </div>
        </>
      )}
    </>
  )
}
