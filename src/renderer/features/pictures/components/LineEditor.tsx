import {
  ArrowClockwiseIcon,
  ArrowsOutIcon,
  CheckIcon,
  EyeIcon,
  MinusIcon,
  PlusIcon,
  SparkleIcon,
  TextAaIcon,
  TextTIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { type ReactNode, useMemo, useState } from 'react'
import type { GamePicture, PictureStyle, ShownLine } from '#contract/Pictures'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Kbd } from '../../mangaEditor/components/Kbd'
import { type FittedLine, letteringOf, measureWith } from '../lettering'

const measuring = new OffscreenCanvas(1, 1).getContext('2d')

const MIN_LETTERING = 6

export interface LetteringEdit {
  readonly size?: number | null
  readonly fillBox?: boolean
}

const fitHint = (fitted: FittedLine) => {
  if (fitted.scaleX < 1) {
    return 'Squeezed'
  }

  return fitted.lines.length > 1 ? `${fitted.lines.length} lines` : undefined
}

function DraftInput({
  label,
  value,
  lang,
  className,
  autoFocus,
  onCommit,
}: {
  readonly label: string
  readonly value: string
  readonly lang?: string
  readonly className?: string
  readonly autoFocus?: boolean
  readonly onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  const commit = () => {
    if (draft.trim() !== '' && draft.trim() !== value) {
      onCommit(draft)
    }
  }

  return (
    <Input
      aria-label={label}
      lang={lang}
      autoFocus={autoFocus}
      className={className}
      value={draft}
      placeholder={label}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}

function MenuItem({
  icon,
  label,
  shortcut,
  active,
  danger,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly shortcut?: string
  readonly active?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'h-8 w-full justify-start gap-2 rounded-[10px] px-2.5 text-[13px] font-normal [&_svg]:text-muted-foreground',
        active === true && 'bg-muted',
        danger === true && 'text-destructive [&_svg]:text-destructive',
      )}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {active === true ? <CheckIcon /> : null}
      {shortcut === undefined ? null : <Kbd>{shortcut}</Kbd>}
    </Button>
  )
}

function LineMenu({
  picture,
  line,
  fitted,
  onSource,
  onKeep,
  onLettering,
  onRemove,
  onAgain,
}: {
  readonly picture: GamePicture
  readonly line: ShownLine
  readonly fitted: FittedLine | undefined
  readonly onSource: (source: string) => void
  readonly onKeep: (keep: boolean) => void
  readonly onLettering: (edit: LetteringEdit) => void
  readonly onRemove: () => void
  readonly onAgain: () => void
}) {
  const size = fitted?.size ?? Math.round(line.h * 0.85)
  const auto = line.size === undefined && line.fillBox !== true
  const hint = fitted === undefined ? undefined : fitHint(fitted)

  return (
    <div className="flex w-60 flex-col gap-0.5">
      <div className="px-1.5 pt-1 pb-1.5">
        <DraftInput
          key={`${picture.picture}:${line.id}:${line.source}`}
          label="Original text"
          lang="ja"
          className="h-8 text-[13px]"
          value={line.source}
          onCommit={onSource}
        />
      </div>
      {line.keep ? null : (
        <>
          <div className="flex h-8 items-center gap-2 px-2.5 text-[13px]">
            <TextTIcon className="text-muted-foreground" />
            <span className="flex-1">Size</span>
            {hint === undefined ? null : (
              <span className="text-xs text-muted-foreground">{hint}</span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Smaller text"
              className="rounded-full"
              onClick={() => onLettering({ size: Math.max(MIN_LETTERING, size - 1) })}
            >
              <MinusIcon />
            </Button>
            <span className="w-6 text-center tabular-nums">{size}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Larger text"
              className="rounded-full"
              onClick={() => onLettering({ size: size + 1 })}
            >
              <PlusIcon />
            </Button>
          </div>
          <MenuItem
            icon={<ArrowsOutIcon />}
            label="Fill the box"
            shortcut="F"
            active={line.fillBox === true}
            onClick={() => onLettering({ size: null, fillBox: true })}
          />
          <MenuItem
            icon={<SparkleIcon />}
            label="Fit automatically"
            active={auto}
            onClick={() => onLettering({ size: null, fillBox: false })}
          />
        </>
      )}
      <div className="mx-1.5 my-1 h-px bg-border" />
      <MenuItem
        icon={<EyeIcon />}
        label="Keep this line"
        active={line.keep}
        onClick={() => onKeep(!line.keep)}
      />
      <MenuItem
        icon={<ArrowClockwiseIcon />}
        label="Translate again"
        disabled={picture.busy === 'translating'}
        onClick={onAgain}
      />
      <MenuItem icon={<TrashIcon />} label="Remove line" danger onClick={onRemove} />
    </div>
  )
}

export function LineEditor({
  picture,
  line,
  pictureStyle,
  onSource,
  onTranslation,
  onKeep,
  onLettering,
  onRemove,
  onAgain,
}: {
  readonly picture: GamePicture
  readonly line: ShownLine
  readonly pictureStyle: PictureStyle
  readonly onSource: (source: string) => void
  readonly onTranslation: (translation: string) => void
  readonly onKeep: (keep: boolean) => void
  readonly onLettering: (edit: LetteringEdit) => void
  readonly onRemove: () => void
  readonly onAgain: () => void
}) {
  const translation = line.translation ?? ''

  const fitted = useMemo(() => {
    if (measuring === null || translation.trim() === '') {
      return undefined
    }

    return letteringOf(measureWith(measuring, pictureStyle), line)
  }, [translation, line, pictureStyle])

  return (
    <div className="flex items-center gap-1">
      <span className="mx-1 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-tint-violet-foreground text-[11px] font-semibold text-card">
        {line.id}
      </span>
      {line.keep ? (
        <span className="w-56 px-2 text-[13px] text-muted-foreground">Kept as it is</span>
      ) : (
        <DraftInput
          key={`${picture.picture}:${line.id}:${translation}`}
          label="Translation"
          className="h-8 w-56 text-sm"
          autoFocus={translation === ''}
          value={translation}
          onCommit={onTranslation}
        />
      )}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Line options"
              className="rounded-full text-muted-foreground aria-expanded:text-foreground"
            >
              <TextAaIcon />
            </Button>
          }
        />
        <PopoverContent
          data-editor
          align="end"
          sideOffset={8}
          initialFocus={(type) => type === 'keyboard'}
          className="rounded-2xl p-1.5"
        >
          <LineMenu
            picture={picture}
            line={line}
            fitted={fitted}
            onSource={onSource}
            onKeep={onKeep}
            onLettering={onLettering}
            onRemove={onRemove}
            onAgain={onAgain}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
