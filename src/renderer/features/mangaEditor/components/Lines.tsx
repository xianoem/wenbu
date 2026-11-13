import {
  ArticleIcon,
  ChatCircleIcon,
  CloudIcon,
  type Icon,
  LightningIcon,
  SignpostIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import {
  type BlockKind,
  type BlockStatus,
  passageSeparator,
  type TextBlock,
} from '#contract/MangaEditor'

export type Line = ReadonlyArray<TextBlock>

export const lineStatus = (line: Line): BlockStatus => {
  const order: ReadonlyArray<BlockStatus> = [
    'failed',
    'reading',
    'translating',
    'draft',
    'approved',
  ]

  return order.find((status) => line.some((block) => block.status === status)) ?? 'draft'
}

export const lineText = (line: Line) =>
  line.map((block) => block.translation).join(` ${passageSeparator} `)

export const sourceText = (line: Line) => line.map((block) => block.source).join(passageSeparator)

export const romajiText = (line: Line) =>
  line.map((block) => block.romaji).join(` ${passageSeparator} `)

export const lineError = (line: Line) => line.find((block) => block.error !== undefined)?.error

export const dotColors: Record<BlockStatus, string> = {
  reading: 'bg-info animate-pulse',
  translating: 'bg-info animate-pulse',
  draft: 'bg-muted-foreground/50',
  approved: 'bg-success',
  failed: 'bg-destructive',
}

export function StatusDot({
  status,
  className,
}: {
  readonly status: BlockStatus
  readonly className?: string
}) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', dotColors[status], className)} />
}

const keyedParts = (text: string) => {
  const seen = new Map<string, number>()

  return text.split(passageSeparator).map((part) => {
    const count = seen.get(part) ?? 0

    seen.set(part, count + 1)

    return { key: `${part}#${count}`, text: part.trim() }
  })
}

export function Parts({ text, className }: { readonly text: string; readonly className?: string }) {
  return (
    <span className={className}>
      {keyedParts(text).map((part, index) => (
        <span key={part.key}>
          {index === 0 ? null : <span className="px-1 font-mono font-semibold text-info">|</span>}
          {part.text}
        </span>
      ))}
    </span>
  )
}

export function LineNumber({
  number,
  className,
}: {
  readonly number: number | string
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[11px] font-medium',
        className,
      )}
    >
      {number}
    </span>
  )
}

export const lineNumbers = (lines: ReadonlyArray<Line>) => {
  let next = 1

  return lines.map((line) => {
    const first = next

    next += line.length

    return line.length === 1 ? String(first) : `${first}–${first + line.length - 1}`
  })
}

export const kinds: ReadonlyArray<{
  readonly kind: BlockKind
  readonly label: string
  readonly Icon: Icon
  readonly tone: string
}> = [
  { kind: 'dialogue', label: 'Dialogue', Icon: ChatCircleIcon, tone: 'bg-info/15 text-info' },
  { kind: 'thought', label: 'Thought', Icon: CloudIcon, tone: 'bg-violet-400/15 text-violet-300' },
  { kind: 'narration', label: 'Narration', Icon: ArticleIcon, tone: 'bg-warning/15 text-warning' },
  { kind: 'sfx', label: 'SFX', Icon: LightningIcon, tone: 'bg-pink-400/15 text-pink-300' },
  { kind: 'sign', label: 'Sign', Icon: SignpostIcon, tone: 'bg-success/15 text-success' },
]

const kindOf = (kind: BlockKind) => kinds.find((entry) => entry.kind === kind) ?? kinds[0]

export function KindTile({
  kind,
  className,
}: {
  readonly kind: BlockKind
  readonly className?: string
}) {
  const entry = kindOf(kind)

  if (entry === undefined) {
    return null
  }

  return (
    <span
      title={entry.label}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md',
        entry.tone,
        className,
      )}
    >
      <entry.Icon className="size-3" />
    </span>
  )
}
