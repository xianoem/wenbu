import {
  ArrowsClockwiseIcon,
  CheckIcon,
  ChatCircleDotsIcon,
  CircleNotchIcon,
  DotsSixVerticalIcon,
  HandPointingIcon,
  LinkBreakIcon,
  LinkIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  SparkleIcon,
  StackIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Predicate } from 'effect'
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useState,
} from 'react'
import type { BlockKind, EditorPage } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Textarea } from '#ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { Kbd } from './Kbd'
import {
  KindTile,
  kinds,
  type Line,
  lineError,
  lineNumbers,
  lineStatus,
  lineText,
  Parts,
  romajiText,
  sourceText,
} from './Lines'

export interface ScriptActions {
  readonly save: (line: Line, translation: string) => void
  readonly approve: (line: Line, translation: string | undefined, approved: boolean) => void
  readonly setKind: (line: Line, kind: BlockKind) => void
  readonly split: (line: Line) => void
  readonly remove: (line: Line) => void
  readonly alternatives: (line: Line) => Promise<ReadonlyArray<string> | string>
  readonly ask: (line: Line) => void
}

const flatIds = (lines: ReadonlyArray<Line>) =>
  lines.flatMap((line) => line.map((block) => block.id))

function rowText(line: Line) {
  const status = lineStatus(line)

  if (status === 'reading') {
    return 'Reading the text…'
  }

  if (status === 'translating') {
    return 'Translating…'
  }

  return lineText(line).trim() === '' ? sourceText(line) : lineText(line)
}

function statusDot(line: Line) {
  const status = lineStatus(line)

  if (status === 'approved') {
    return 'bg-success'
  }

  if (status === 'failed') {
    return 'bg-destructive'
  }

  return status === 'draft' ? 'bg-warning' : 'animate-pulse bg-info'
}

function Properties({
  line,
  number,
  actions,
  textarea,
}: {
  readonly line: Line
  readonly number: string
  readonly actions: ScriptActions
  readonly textarea: RefObject<HTMLTextAreaElement | null>
}) {
  const head = line[0]
  const saved = lineText(line)
  const status = lineStatus(line)
  const [draft, setDraft] = useState(saved)
  const [alternatives, setAlternatives] = useState<ReadonlyArray<string>>()
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string>()

  useEffect(() => {
    if (document.activeElement !== textarea.current) {
      setDraft(saved)
    }
  }, [saved, textarea])

  if (head === undefined) {
    return null
  }

  const suggest = async () => {
    setLoading(true)
    setProblem(undefined)

    const result = await actions.alternatives(line)

    setLoading(false)

    if (Predicate.isString(result)) {
      setProblem(result)

      return
    }

    setAlternatives(result)
  }

  const approve = () =>
    actions.approve(line, draft === saved ? undefined : draft, status !== 'approved')

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      actions.approve(line, draft === saved ? undefined : draft, true)
    }

    if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-t px-4 pt-3">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
          Properties
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">Line {number}</span>
      </div>
      <div className="no-scrollbar flex max-h-[55%] shrink-0 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex rounded-full bg-muted/50 p-0.5 ring-1 ring-foreground/8">
          {kinds.map(({ kind, label }) => (
            <Button
              key={kind}
              size="xs"
              variant={head.kind === kind ? 'secondary' : 'ghost'}
              className={cn(
                'h-6 flex-1 rounded-full px-1 text-[11.5px]',
                head.kind !== kind && 'text-muted-foreground',
              )}
              onClick={() => actions.setKind(line, kind)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Parts text={sourceText(line)} className="text-[14.5px] leading-relaxed" />
          {line.some((block) => block.romaji !== '') ? (
            <Parts text={romajiText(line)} className="text-[12px] text-muted-foreground italic" />
          ) : null}
        </div>
        <Textarea
          ref={textarea}
          value={draft}
          placeholder="Type the translation"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => (draft === saved ? undefined : actions.save(line, draft))}
          onKeyDown={onKeyDown}
          className="min-h-16 resize-none rounded-xl text-[13.5px] leading-relaxed md:text-[13.5px]"
        />
        {line.length > 1 ? (
          <span className="-mt-1.5 text-[11.5px] text-muted-foreground">
            {line.length} bubbles: a | marks where the next one starts.
          </span>
        ) : null}
        {status === 'failed' ? (
          <span className="text-[12px] text-destructive">{lineError(line)}</span>
        ) : null}
        {alternatives === undefined ? null : (
          <div className="flex flex-col gap-1">
            {alternatives.map((alternative, index) => (
              <Button
                key={alternative}
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(alternative)
                  actions.save(line, alternative)
                }}
                className="h-auto justify-start gap-2.5 rounded-lg px-2 py-1.5 text-left font-normal whitespace-normal text-muted-foreground"
              >
                <Kbd>{index + 1}</Kbd>
                <Parts text={alternative} className="text-[12.5px]" />
              </Button>
            ))}
          </div>
        )}
        {problem === undefined ? null : (
          <span className="text-[12px] text-destructive">{problem}</span>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={loading}
            onClick={() => void suggest()}
          >
            {loading ? <CircleNotchIcon className="animate-spin" /> : <SparkleIcon />}
            Alternatives
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={() => actions.ask(line)}
          >
            <ChatCircleDotsIcon />
            Ask about it
          </Button>
          <div className="flex-1" />
          {line.length > 1 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Split into separate lines"
                    className="text-muted-foreground"
                    onClick={() => actions.split(line)}
                  >
                    <LinkBreakIcon />
                  </Button>
                }
              />
              <TooltipContent>Split into separate lines · Shift M</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete this text"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => actions.remove(line)}
                >
                  <TrashIcon />
                </Button>
              }
            />
            <TooltipContent>Delete: not translated, cleaned or lettered</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
        {status === 'approved' ? (
          <span className="flex h-6 items-center gap-1.5 rounded-full bg-success/12 px-2.5 text-[11.5px] font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" />
            Approved
          </span>
        ) : (
          <span className="flex h-6 items-center gap-1.5 rounded-full bg-warning/12 px-2.5 text-[11.5px] font-medium text-warning">
            <span className="size-1.5 rounded-full bg-warning" />
            Waiting for approval
          </span>
        )}
        <div className="flex-1" />
        <Button
          className="rounded-full"
          variant={status === 'approved' ? 'outline' : 'default'}
          disabled={draft.trim() === '' && status !== 'approved'}
          onClick={approve}
        >
          <CheckIcon />
          {status === 'approved' ? 'Unapprove' : 'Approve'}
          {status === 'approved' ? null : (
            <Kbd className="border-transparent bg-black/10 text-current">Ctrl ↵</Kbd>
          )}
        </Button>
      </div>
    </>
  )
}

function ScriptOf({ line, number }: { readonly line: Line; readonly number: string }) {
  const kind = kinds.find((entry) => entry.kind === line[0]?.kind)

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
          Line {number}
        </span>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">{kind?.label}</span>
      </div>
      <Parts text={sourceText(line)} className="text-[14px] leading-relaxed" />
      {line.some((block) => block.romaji !== '') ? (
        <Parts text={romajiText(line)} className="text-[12px] text-muted-foreground italic" />
      ) : null}
      <Parts text={lineText(line)} className="text-[13.5px] leading-relaxed" />
    </div>
  )
}

export function ScriptPanel({
  page,
  lines,
  selected,
  picked,
  numbering,
  layers,
  textarea,
  actions,
  onSelect,
  onPick,
  onOrder,
  onMerge,
  onNumbering,
  onTranslate,
  onLayers,
  locked,
  onUnlock,
}: {
  readonly page: EditorPage
  readonly lines: ReadonlyArray<Line>
  readonly selected: string | undefined
  readonly picked: ReadonlySet<string>
  readonly numbering: boolean
  readonly layers: boolean
  readonly textarea: RefObject<HTMLTextAreaElement | null>
  readonly actions: ScriptActions
  readonly onSelect: (id: string) => void
  readonly onPick: (ids: ReadonlySet<string>) => void
  readonly onOrder: (ids: ReadonlyArray<string>) => void
  readonly onMerge: () => void
  readonly onNumbering: (on: boolean) => void
  readonly onTranslate: () => void
  readonly onLayers: () => void
  readonly locked: boolean
  readonly onUnlock: () => void
}) {
  const [dragged, setDragged] = useState<number>()
  const [target, setTarget] = useState<number>()
  const numbers = lineNumbers(lines)
  const approved = lines.filter((line) => lineStatus(line) === 'approved').length
  const index = lines.findIndex((line) => line.some((block) => block.id === selected))
  const line = lines[index]
  const translating = page.running === 'translate'

  const drop = (event: DragEvent) => {
    event.preventDefault()

    if (dragged !== undefined && target !== undefined && dragged !== target) {
      const moving = lines[dragged]
      const rest = lines.filter((_, at) => at !== dragged)

      if (moving !== undefined) {
        rest.splice(target > dragged ? target - 1 : target, 0, moving)
        onOrder(flatIds(rest))
      }
    }

    setDragged(undefined)
    setTarget(undefined)
  }

  const lineIdOf = (id: string) =>
    lines.find((candidate) => candidate.some((block) => block.id === id))?.[0]?.id ?? id

  const click = (event: MouseEvent, id: string) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      onPick(new Set())
      onSelect(id)

      return
    }

    const next = new Set(
      picked.size === 0 && selected !== undefined ? [lineIdOf(selected)] : picked,
    )

    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }

    onPick(next)
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Lines</span>
          <span className="flex h-5.5 items-center gap-1.5 rounded-full bg-muted/60 px-2 text-[11.5px] font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            {approved} of {lines.length} approved
          </span>
          <div className="flex-1" />
          {layers ? (
            <Button size="xs" className="rounded-full" onClick={onLayers}>
              <StackIcon />
              {locked ? 'Back to layers' : 'Done'}
            </Button>
          ) : null}
        </div>
        {locked ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2 ring-1 ring-foreground/8">
            <LockSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-[12px] leading-snug text-muted-foreground">
              The script is locked while you clean and letter the page.
            </span>
            <Button size="xs" variant="outline" className="rounded-full" onClick={onUnlock}>
              <LockSimpleOpenIcon />
              Edit script
            </Button>
          </div>
        ) : null}
        <div className={cn('flex items-center gap-2', locked && 'hidden')}>
          <div className="flex-1" />
          <Button
            size="xs"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            disabled={translating || lines.length === 0 || page.running !== undefined}
            onClick={onTranslate}
          >
            {translating ? <CircleNotchIcon className="animate-spin" /> : <ArrowsClockwiseIcon />}
            {page.done.includes('translate') ? 'Translate again' : 'Translate'}
          </Button>
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-muted-foreground',
            locked && 'hidden',
          )}
        >
          <DotsSixVerticalIcon className="size-3.5" />
          Drag to reorder · Shift-click and <Kbd>M</Kbd> merges
          <div className="flex-1" />
          <Button
            size="xs"
            variant={numbering ? 'secondary' : 'ghost'}
            className={cn('h-6 rounded-full', numbering ? 'text-info' : 'text-muted-foreground')}
            onClick={() => onNumbering(!numbering)}
          >
            <HandPointingIcon />
            {numbering ? 'Done' : 'Number'}
          </Button>
        </div>
      </div>
      <div
        className="no-scrollbar relative flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-2"
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            The scan found no text. Draw a box around any with Add text (A).
          </p>
        ) : null}
        {lines.map((candidate, at) => {
          const id = candidate[0]?.id ?? ''
          const isSelected = at === index
          const isPicked = picked.has(id)

          return (
            <div key={id} className="flex flex-col">
              {target === at && dragged !== undefined ? (
                <div className="mx-2 my-0.5 h-0.5 rounded-full bg-info" />
              ) : null}
              <div
                draggable={!locked}
                onDragStart={() => setDragged(at)}
                onDragEnter={() => setTarget(at)}
                onDragEnd={() => {
                  setDragged(undefined)
                  setTarget(undefined)
                }}
                onClick={(event) => (locked ? onSelect(id) : click(event, id))}
                className={cn(
                  'flex h-8 cursor-default items-center gap-2 rounded-lg px-1.5 text-[12.5px]',
                  isSelected ? 'bg-info/12 ring-1 ring-info/45' : 'hover:bg-muted/50',
                  isPicked && 'bg-info/8 ring-1 ring-info/30 ring-dashed',
                  dragged === at && 'opacity-35',
                )}
              >
                <DotsSixVerticalIcon
                  className={cn(
                    'size-3.5 shrink-0 cursor-grab text-muted-foreground/40',
                    locked && 'invisible',
                  )}
                />
                <span className="w-7 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                  {numbers[at]}
                </span>
                <KindTile kind={candidate[0]?.kind ?? 'dialogue'} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    lineText(candidate).trim() === '' && 'text-muted-foreground',
                  )}
                >
                  {rowText(candidate)}
                </span>
                {candidate.length > 1 ? <LinkIcon className="size-3 shrink-0 text-info" /> : null}
                <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(candidate))} />
              </div>
            </div>
          )
        })}
        <div className="min-h-6 flex-1" onDragEnter={() => setTarget(lines.length)} />
        {picked.size < 2 ? null : (
          <div className="sticky bottom-1 mx-auto flex items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-3 text-[12.5px] shadow-lg ring-1 ring-foreground/10">
            {picked.size} lines
            <Button size="sm" className="rounded-full" onClick={onMerge}>
              <LinkIcon />
              Merge into one passage
              <Kbd className="border-transparent bg-black/10 text-current">M</Kbd>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear the selection"
              onClick={() => onPick(new Set())}
            >
              <XIcon />
            </Button>
          </div>
        )}
      </div>
      {layers ? null : (
        <div className="mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5">
          <LockSimpleIcon className="size-4 text-muted-foreground" />
          <span className="flex flex-col">
            <span className="text-[12.5px] font-medium">Cleanup and lettering</span>
            <span className="text-[11.5px] text-muted-foreground">
              Unlock once every line is approved · {lines.length - approved} to go
            </span>
          </span>
        </div>
      )}
      {line !== undefined && locked ? <ScriptOf line={line} number={numbers[index] ?? ''} /> : null}
      {line !== undefined && !locked ? (
        <Properties
          key={line[0]?.id}
          line={line}
          number={numbers[index] ?? ''}
          actions={actions}
          textarea={textarea}
        />
      ) : null}
    </>
  )
}
