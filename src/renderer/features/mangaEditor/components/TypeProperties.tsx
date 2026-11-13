import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Predicate } from 'effect'
import { type ReactNode, useState } from 'react'
import {
  type BreakMode,
  defaultLettering,
  type Lettering,
  type MangaEditorSettings,
  passageSeparator,
  type Sizing,
  sizingOf,
  type TextBlock,
} from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Input } from '#ui/input'
import { Slider } from '#ui/slider'
import { Switch } from '#ui/switch'
import { Textarea } from '#ui/textarea'
import { FontPicker } from './FontPicker'
import { customSize } from '../lettering/bubbleLayout'
import type { TextLayout } from '../lettering/layoutText'
import { kinds, type Line, lineText } from './Lines'

const modes: ReadonlyArray<{ readonly mode: BreakMode; readonly name: string }> = [
  { mode: 'balanced', name: 'Balanced' },
  { mode: 'greedy', name: 'Greedy' },
  { mode: 'manual', name: 'Manual' },
]

const emphases: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: '-15', label: 'Whisper' },
  { value: '0', label: 'Normal' },
  { value: '10', label: 'Loud' },
  { value: '25', label: 'Shout' },
]

export interface PageSizing {
  readonly kindSizes: MangaEditorSettings['kindSizes']
  readonly scale: number
}

export interface TypeActions {
  readonly saveLine: (line: Line, text: string) => void
  readonly letter: (block: TextBlock, lettering: Lettering, everyBubble: boolean) => void
  readonly layout: (
    block: TextBlock,
    lettering: Lettering,
    share?: number,
  ) => TextLayout | undefined
}

const keyedLines = (lines: ReadonlyArray<string>) => {
  const seen = new Map<string, number>()

  return lines.map((text) => {
    const count = seen.get(text) ?? 0

    seen.set(text, count + 1)

    return { key: `${text}#${count}`, text }
  })
}

const withPart = (line: Line, block: TextBlock, text: string) =>
  line.map((part) => (part.id === block.id ? text : part.translation)).join(` ${passageSeparator} `)

const valueOf = (value: number | ReadonlyArray<number>, fallback: number) =>
  Predicate.isNumber(value) ? value : (value[0] ?? fallback)

const sizeOf = (typed: string) => {
  if (typed.trim() === '') {
    return undefined
  }

  const size = Math.round(Number(typed))

  return Number.isFinite(size) ? Math.min(400, Math.max(6, size)) : undefined
}

const distinct = (layouts: ReadonlyArray<TextLayout>) =>
  layouts.filter(
    (layout, index) =>
      layouts.findIndex((other) => other.lines.join('\n') === layout.lines.join('\n')) === index,
  )

const fallbackSize = 60

const sizingChoices = (kindLabel: string): ReadonlyArray<{ value: Sizing; label: string }> => [
  { value: 'kind', label: kindLabel },
  { value: 'custom', label: 'Custom' },
  { value: 'fill', label: 'Fill' },
]

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Choices<T extends string>({
  value,
  choices,
  onChoose,
}: {
  readonly value: T
  readonly choices: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly onChoose: (value: T) => void
}) {
  return (
    <div className="flex flex-1 rounded-full bg-muted/50 p-0.5 ring-1 ring-foreground/8">
      {choices.map((choice) => (
        <Button
          key={choice.value}
          size="xs"
          variant={value === choice.value ? 'secondary' : 'ghost'}
          className={cn(
            'h-6 flex-1 rounded-full',
            value !== choice.value && 'text-muted-foreground',
          )}
          onClick={() => onChoose(choice.value)}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  )
}

const opened = new Map<string, boolean>([
  ['text', true],
  ['type', true],
  ['breaks', false],
  ['previews', false],
])

function Section({
  name,
  title,
  children,
}: {
  readonly name: string
  readonly title: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(opened.get(name) ?? true)

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        opened.set(name, next)
        setOpen(next)
      }}
      className="flex flex-col"
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="h-8 justify-start gap-1.5 rounded-lg px-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
          >
            {open ? <CaretDownIcon /> : <CaretRightIcon />}
            {title}
          </Button>
        }
      />
      <CollapsibleContent className="flex flex-col gap-3 px-1.5 pt-1 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function FollowingSlider({
  label,
  value,
  min,
  max,
  onMove,
  onCommit,
}: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onMove?: (value: number) => void
  readonly onCommit: (value: number) => void
}) {
  const [moving, setMoving] = useState<number>()

  return (
    <Slider
      aria-label={label}
      value={[moving ?? value]}
      min={min}
      max={max}
      onValueChange={(next) => {
        const at = valueOf(next, value)

        setMoving(at)
        onMove?.(at)
      }}
      onValueCommitted={(next) => {
        setMoving(undefined)
        onCommit(valueOf(next, value))
      }}
      className="flex-1"
    />
  )
}

function SizeNote({
  mode,
  kindLabel,
  kindSize,
  emphasis,
  size,
}: {
  readonly mode: Sizing
  readonly kindLabel: string
  readonly kindSize: number | undefined
  readonly emphasis: number
  readonly size: number | undefined
}) {
  const onPage = size === undefined ? '' : ` · ${Math.round(size)} px on this page`

  if (mode === 'kind' && kindSize === undefined) {
    return (
      <span className="text-[11.5px] leading-relaxed text-muted-foreground">
        {kindLabel} has no size yet, so this bubble fills its box. Set one in the gallery settings.
      </span>
    )
  }

  if (mode === 'kind') {
    const step = emphasis === 0 ? '' : ` ${emphasis > 0 ? '+' : '−'}${Math.abs(emphasis)}%`

    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        {kindLabel} {kindSize}
        {step}
        {onPage}
      </span>
    )
  }

  return size === undefined ? null : (
    <span className="font-mono text-[11px] text-muted-foreground">
      {Math.round(size)} px on this page
    </span>
  )
}

export function TypeProperties({
  line,
  block,
  galleryFont,
  sizing,
  actions,
}: {
  readonly line: Line
  readonly block: TextBlock
  readonly galleryFont: string
  readonly sizing: PageSizing
  readonly actions: TypeActions
}) {
  const saved = lineText(line)
  const [draft, setDraft] = useState(saved)
  const [draftOf, setDraftOf] = useState(saved)
  const lettering = block.lettering
  const ownSize = customSize(lettering, sizing.scale)
  const [typedSize, setTypedSize] = useState(String(ownSize ?? ''))
  const [leading, setLeading] = useState<number>()
  const mode = sizingOf(lettering)
  const kindLabel = kinds.find((entry) => entry.kind === block.kind)?.label ?? 'Kind'
  const kindSize = sizing.kindSizes[block.kind]
  const laidOut = actions.layout(block, lettering)

  const candidates = distinct(
    [
      actions.layout(block, { ...lettering, breakMode: 'balanced' }),
      actions.layout(block, { ...lettering, breakMode: 'greedy' }),
      actions.layout(block, { ...lettering, breakMode: 'balanced' }, 0.85),
    ].filter((layout) => layout !== undefined),
  )

  if (saved !== draftOf) {
    setDraftOf(saved)
    setDraft(saved)
  }

  const change = (patch: Partial<Lettering>) =>
    actions.letter(block, { ...lettering, ...patch }, false)

  const without = (key: 'size' | 'font' | 'emphasis') => {
    const { [key]: _gone, ...rest } = lettering

    return rest
  }

  const commitSize = (typed: string) => {
    const size = sizeOf(typed)

    if (size !== undefined && size !== ownSize) {
      change({ sizing: 'custom', size })
    }
  }

  const choose = (chosen: Sizing) => {
    if (chosen !== 'custom') {
      actions.letter(block, { ...without('size'), sizing: chosen }, false)

      return
    }

    const size = Math.round((laidOut?.size ?? fallbackSize) / sizing.scale)

    setTypedSize(String(size))
    change({ sizing: 'custom', size })
  }

  return (
    <div className="flex flex-col gap-1">
      <Section name="text" title="Text">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => (draft === saved ? undefined : actions.saveLine(line, draft))}
          className="min-h-14 resize-none rounded-xl text-[12.5px] md:text-[12.5px]"
        />
        {lettering.breakMode === 'manual' ? (
          <span className="text-[11.5px] text-muted-foreground">
            Press Enter in this bubble's part to break the line there.
          </span>
        ) : null}
      </Section>
      <Section name="type" title="Font & size">
        <Row label="Font">
          <FontPicker
            font={lettering.font}
            galleryFont={galleryFont}
            onFont={(font) =>
              actions.letter(
                block,
                font === undefined ? without('font') : { ...lettering, font },
                false,
              )
            }
          />
        </Row>
        <Row label="Size">
          <Choices value={mode} choices={sizingChoices(kindLabel)} onChoose={choose} />
        </Row>
        {mode === 'kind' && kindSize !== undefined ? (
          <Row label="">
            <Choices
              value={String(lettering.emphasis ?? 0)}
              choices={emphases}
              onChoose={(chosen) =>
                actions.letter(
                  block,
                  chosen === '0' ? without('emphasis') : { ...lettering, emphasis: Number(chosen) },
                  false,
                )
              }
            />
          </Row>
        ) : null}
        <SizeNote
          mode={mode}
          kindLabel={kindLabel}
          kindSize={kindSize}
          emphasis={lettering.emphasis ?? 0}
          size={laidOut?.size}
        />
        {mode !== 'custom' || ownSize === undefined ? null : (
          <Row label="">
            <FollowingSlider
              label="Text size"
              value={ownSize}
              min={8}
              max={200}
              onMove={(size) => setTypedSize(String(size))}
              onCommit={(size) => change({ sizing: 'custom', size })}
            />
            <Input
              type="number"
              aria-label="Text size"
              value={typedSize}
              onChange={(event) => setTypedSize(event.target.value)}
              onBlur={() => commitSize(typedSize)}
              onKeyDown={(event) => (event.key === 'Enter' ? commitSize(typedSize) : undefined)}
              className="h-7 w-16 rounded-full text-right font-mono text-[12px]"
            />
          </Row>
        )}
        {mode === 'fill' || (mode === 'kind' && kindSize === undefined) ? null : (
          <label className="flex items-center gap-2 text-[12px]">
            <Switch
              checked={lettering.shrink === true}
              onCheckedChange={(shrink) => change({ shrink })}
            />
            Shrink to fit, down to 75%
          </label>
        )}
        {laidOut === undefined || laidOut.fits ? null : (
          <span className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warning">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
            The text doesn't fit its box. Give the box more room, allow shrinking or pick a smaller
            size.
          </span>
        )}
        <Row label="Leading">
          <FollowingSlider
            label="Leading"
            value={Math.round((lettering.leading ?? 1) * 100)}
            min={70}
            max={170}
            onMove={setLeading}
            onCommit={(leading) => {
              setLeading(undefined)
              change({ leading: leading / 100 })
            }}
          />
          <span className="w-10 text-right font-mono text-[11.5px]">
            {((leading ?? Math.round((lettering.leading ?? 1) * 100)) / 100).toFixed(2)}
          </span>
        </Row>
        <span className="text-[11.5px] leading-relaxed text-muted-foreground">
          Drag the box on the page to move the text; drag its corners to give it more or less room.
        </span>
      </Section>
      <Section name="breaks" title="Line breaks">
        <Choices
          value={lettering.breakMode}
          choices={modes.map(({ mode, name }) => ({ value: mode, label: name }))}
          onChoose={(breakMode) => change({ breakMode })}
        />
        <div className="flex items-center gap-4 text-[12px]">
          <label className="flex items-center gap-2">
            <Switch
              checked={lettering.hyphenate}
              onCheckedChange={(hyphenate) => change({ hyphenate })}
            />
            Hyphenate
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={lettering.avoidOrphans}
              onCheckedChange={(avoidOrphans) => change({ avoidOrphans })}
            />
            No lone last word
          </label>
        </div>
      </Section>
      <Section name="previews" title="Other breaks">
        <div className="grid grid-cols-3 gap-1.5">
          {candidates.map((candidate) => (
            <Button
              key={candidate.lines.join('\n')}
              variant="outline"
              onClick={() => {
                actions.saveLine(line, withPart(line, block, candidate.lines.join('\n')))
                change({ breakMode: 'manual' })
              }}
              className="flex h-20 flex-col items-center justify-center gap-0 rounded-xl bg-white p-1.5 font-normal text-black hover:bg-white/90 dark:bg-white dark:hover:bg-white/90"
            >
              {keyedLines(candidate.lines).map(({ key, text }) => (
                <span key={key} className="text-[8.5px] leading-tight font-semibold uppercase">
                  {text}
                </span>
              ))}
            </Button>
          ))}
        </div>
      </Section>
      <div className="flex items-center gap-1.5 pt-2">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          onClick={() =>
            actions.letter(
              block,
              lettering.textBox === undefined
                ? defaultLettering
                : { ...defaultLettering, textBox: lettering.textBox },
              false,
            )
          }
        >
          <ArrowCounterClockwiseIcon />
          Reset
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => actions.letter(block, lettering, true)}
        >
          <CopyIcon />
          Use for all bubbles
        </Button>
      </div>
    </div>
  )
}
