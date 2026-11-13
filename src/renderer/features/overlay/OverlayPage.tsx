import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowsClockwiseIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  LockIcon,
  LockOpenIcon,
  PauseIcon,
  PlayIcon,
  TextAaIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Predicate } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type PointerEvent, type ReactNode, useRef, useState, useSyncExternalStore } from 'react'
import { useLocalFonts } from '#lib/useLocalFonts'
import {
  type OverlayAppearance,
  type OverlayState,
  overlayFontSizes,
  overlayOpacity,
} from '#contract/TranslationOverlay'
import { Badge } from '#ui/badge'
import { Button } from '#ui/button'
import { ButtonGroup } from '#ui/button-group'
import { Field, FieldContent, FieldTitle } from '#ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '#ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#ui/select'
import { Separator } from '#ui/separator'
import { Slider } from '#ui/slider'
import { Spinner } from '#ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { formatTokens, formatUsd } from '../library/library'
import {
  overlayAtom,
  retryTranslationAtom,
  saveOverlayAppearanceAtom,
  setOverlayPausedAtom,
} from './overlay'
import { type OverlayTool, toolbarLayout } from './utils/toolbarLayout'

const minimumSize = { width: 360, height: 120 } as const

const systemFont = 'system'

const colorPresets = [
  { name: 'White', value: '#ffffff' },
  { name: 'Soft gray', value: '#d8dee9' },
  { name: 'Warm gold', value: '#f6d365' },
  { name: 'Rose', value: '#ff8fab' },
  { name: 'Sky', value: '#8ec5ff' },
  { name: 'Mint', value: '#9af0c7' },
  { name: 'Lavender', value: '#c8b6ff' },
] as const

interface ResizeStart {
  readonly pointerId: number
  readonly screenX: number
  readonly screenY: number
  readonly width: number
  readonly height: number
}

const clampFontSize = (size: number) =>
  Math.max(overlayFontSizes.min, Math.min(overlayFontSizes.max, Math.round(size)))

const firstValue = (value: number | ReadonlyArray<number>) =>
  Predicate.isNumber(value) ? value : (value[0] ?? overlayOpacity.max)

const captureWhileLocked = (locked: boolean) => ({
  onPointerEnter: () => (locked ? window.wenbu.captureOverlayMouse(true) : undefined),
  onPointerLeave: () => (locked ? window.wenbu.captureOverlayMouse(false) : undefined),
})

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={label}
            className="text-white hover:bg-white/15 hover:text-white disabled:opacity-40"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function TextStyleFields({
  appearance,
  onChange,
}: {
  readonly appearance: OverlayAppearance
  readonly onChange: (patch: Partial<OverlayAppearance>) => void
}) {
  const { fonts, state: fontLoad, load: loadFonts } = useLocalFonts()

  const color =
    colorPresets.find((preset) => preset.value === appearance.fontColor) ?? colorPresets[0]

  const setSize = (size: number) => onChange({ fontSize: clampFontSize(size) })

  return (
    <>
      <Field orientation="horizontal" className="items-center gap-1.5">
        <FieldTitle className="shrink-0 text-xs text-muted-foreground">Size</FieldTitle>
        <ButtonGroup aria-label="Adjust font size" className="min-w-0 flex-1">
          <InputGroup className="h-6 min-w-0 flex-1">
            <InputGroupInput
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={appearance.fontSize}
              aria-label="Font size"
              className="h-6 px-2 text-right text-xs"
              onChange={(event) => {
                const size = Number.parseInt(event.currentTarget.value, 10)

                if (!Number.isNaN(size)) {
                  setSize(size)
                }
              }}
            />
            <InputGroupAddon align="inline-end" className="py-0 pr-2">
              <InputGroupText className="text-xs">px</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Decrease font size"
            disabled={appearance.fontSize <= overlayFontSizes.min}
            onClick={() => setSize(appearance.fontSize - 1)}
          >
            -
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Increase font size"
            disabled={appearance.fontSize >= overlayFontSizes.max}
            onClick={() => setSize(appearance.fontSize + 1)}
          >
            +
          </Button>
        </ButtonGroup>
      </Field>

      <Field orientation="horizontal" className="items-center gap-17">
        <FieldTitle className="shrink-0 text-xs text-muted-foreground">Color</FieldTitle>
        <Select
          value={appearance.fontColor}
          onValueChange={(fontColor) => onChange({ fontColor: fontColor ?? colorPresets[0].value })}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: color.value }}
              />
              <span className="truncate">{color.name}</span>
            </span>
          </SelectTrigger>
          <SelectContent {...captureWhileLocked(appearance.locked)}>
            <SelectGroup>
              {colorPresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value} className="text-xs">
                  <span
                    className="size-2.5 rounded-full border border-border"
                    style={{ backgroundColor: preset.value }}
                  />
                  <span>{preset.name}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal" className="items-center gap-16">
        <FieldTitle className="shrink-0 text-xs text-muted-foreground">Family</FieldTitle>
        <Select
          items={{
            [systemFont]: 'System default',
            ...Object.fromEntries(fonts.map((family) => [family, family])),
          }}
          value={appearance.fontFamily}
          onOpenChange={loadFonts}
          onValueChange={(fontFamily) => onChange({ fontFamily: fontFamily ?? systemFont })}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent {...captureWhileLocked(appearance.locked)}>
            <SelectGroup>
              <SelectItem value={systemFont}>System default</SelectItem>
              {fontLoad === 'loading' ? <SelectLabel>Loading system fonts…</SelectLabel> : null}
              {fontLoad === 'error' ? <SelectLabel>System fonts unavailable.</SelectLabel> : null}
              {fonts.map((family) => (
                <SelectItem key={family} value={family}>
                  {family}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}

const iconButtonClass = 'text-white hover:bg-white/15 hover:text-white'

const menuPanelClass =
  'flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-visible rounded-2xl p-3'

function TextStyle({
  appearance,
  onChange,
}: {
  readonly appearance: OverlayAppearance
  readonly onChange: (patch: Partial<OverlayAppearance>) => void
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Text style"
                  className={iconButtonClass}
                />
              }
            />
          }
        >
          <TextAaIcon />
        </TooltipTrigger>
        <TooltipContent>Text style</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={4}
        className={menuPanelClass}
        {...captureWhileLocked(appearance.locked)}
      >
        <TextStyleFields appearance={appearance} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

function OpacitySlider({
  opacity,
  className,
  onDraft,
  onCommit,
}: {
  readonly opacity: number
  readonly className?: string
  readonly onDraft: (opacity: number) => void
  readonly onCommit: (opacity: number) => void
}) {
  return (
    <Slider
      className={cn(
        '[&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:rounded-full [&_[data-slot=slider-track]]:h-1',
        className,
      )}
      min={overlayOpacity.min}
      max={overlayOpacity.max}
      step={0.05}
      value={[opacity]}
      aria-label="Overlay opacity"
      onValueChange={(value) => onDraft(firstValue(value))}
      onValueCommitted={(value) => onCommit(firstValue(value))}
    />
  )
}

interface ToolActions {
  readonly state: OverlayState
  readonly opacity: number
  readonly change: (patch: Partial<OverlayAppearance>) => void
  readonly retry: () => void
  readonly onOpacityDraft: (opacity: number) => void
  readonly onOpacityCommit: (opacity: number) => void
}

const canRetry = (state: OverlayState) => state.canRetry && !state.translating && !state.paused

function MenuRow({
  disabled,
  onClick,
  children,
}: {
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      className="w-full justify-start gap-2 font-normal"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function MoreMenu({
  tools,
  actions,
}: {
  readonly tools: ReadonlyArray<OverlayTool>
  readonly actions: ToolActions
}) {
  const { state, opacity, change } = actions
  const { appearance } = state

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More"
                  className={iconButtonClass}
                />
              }
            />
          }
        >
          <DotsThreeIcon weight="bold" />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={4}
        className={menuPanelClass}
        {...captureWhileLocked(appearance.locked)}
      >
        {tools.includes('retry') ? (
          <MenuRow disabled={!canRetry(state)} onClick={actions.retry}>
            <ArrowsClockwiseIcon />
            Retry translation
          </MenuRow>
        ) : null}
        {tools.includes('original') ? (
          <MenuRow onClick={() => change({ showOriginal: !appearance.showOriginal })}>
            {appearance.showOriginal ? <EyeSlashIcon /> : <EyeIcon />}
            {appearance.showOriginal ? 'Hide original text' : 'Show original text'}
          </MenuRow>
        ) : null}
        {tools.includes('textStyle') ? (
          <>
            <Separator />
            <div className="px-1 text-xs font-medium">Text style</div>
            <TextStyleFields appearance={appearance} onChange={change} />
          </>
        ) : null}
        {tools.includes('opacity') ? (
          <>
            <Separator />
            <Field orientation="horizontal" className="items-center gap-3 px-1">
              <FieldTitle className="shrink-0 text-xs text-muted-foreground">Opacity</FieldTitle>
              <FieldContent className="flex-1 gap-0 pt-1">
                <OpacitySlider
                  opacity={opacity}
                  onDraft={actions.onOpacityDraft}
                  onCommit={actions.onOpacityCommit}
                />
              </FieldContent>
            </Field>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

const subscribeToWidth = (onChange: () => void) => {
  window.addEventListener('resize', onChange)

  return () => window.removeEventListener('resize', onChange)
}

const useToolbarLayout = () =>
  toolbarLayout(useSyncExternalStore(subscribeToWidth, () => window.innerWidth))

function Usage({ state }: { readonly state: OverlayState }) {
  const { usage } = state
  const tokens = usage.inputTokens + usage.outputTokens

  if (tokens === 0) {
    return <p className="truncate text-[11px] text-white/70">No tokens consumed yet</p>
  }

  return (
    <Tooltip>
      <TooltipTrigger className="app-no-drag block truncate text-left text-[11px] text-white/70">
        {formatTokens(tokens)} tokens
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-4">
            <span className="text-zinc-400">Input:</span>
            <span className="text-zinc-300">{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-zinc-400">Output:</span>
            <span className="text-zinc-300">{formatTokens(usage.outputTokens)}</span>
          </div>
          <div className="mt-1 border-t border-zinc-700 pt-1">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-400">Est. Cost:</span>
              <span className="text-green-600">
                {usage.costUsd === undefined ? 'Unknown' : formatUsd(usage.costUsd)}
              </span>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function StatusBadges({ state }: { readonly state: OverlayState }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {state.paused ? (
        <Tooltip>
          <TooltipTrigger>
            <div className="px-10 py-2.5">
              <Badge className="text-[10px] uppercase" variant="secondary">
                Paused
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Hooked game text is being ignored. No translation requests will be sent while the
            overlay is paused.
          </TooltipContent>
        </Tooltip>
      ) : null}
      {state.cacheHit ? (
        <Tooltip>
          <TooltipTrigger>
            <div className="px-10 py-2.5">
              <Badge className="text-[10px] uppercase" variant="secondary">
                Cache Hit
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            The translation was retrieved from cache. No API call was made to the translation
            service.
          </TooltipContent>
        </Tooltip>
      ) : null}
      {state.translating ? (
        <div className="px-10 py-2">
          <Badge
            variant="secondary"
            className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            <Spinner data-icon="inline-start" />
            Translating...
          </Badge>
        </div>
      ) : null}
    </div>
  )
}

function ResizeGrip({ disabled }: { readonly disabled: boolean }) {
  const start = useRef<ResizeStart | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)

  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    start.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    }
  }

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current

    if (from === undefined || from.pointerId !== event.pointerId || frame.current !== undefined) {
      return
    }

    const width = Math.max(minimumSize.width, from.width + event.screenX - from.screenX)
    const height = Math.max(minimumSize.height, from.height + event.screenY - from.screenY)

    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      window.wenbu.resizeOverlay(width, height)
    })
  }

  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (start.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      start.current = undefined
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Resize overlay"
      title="Resize overlay"
      disabled={disabled}
      className="app-no-drag absolute right-2 bottom-2 size-6 cursor-nwse-resize rounded-full border border-white/10 bg-white/5 p-0 transition hover:bg-white/10 focus-visible:border-white/30 focus-visible:ring-3 focus-visible:ring-white/15 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-40"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <span className="pointer-events-none absolute right-[6px] bottom-[7px] h-px w-2 rounded-full bg-white/50" />
      <span className="pointer-events-none absolute right-[9px] bottom-[10px] h-px w-2 rounded-full bg-white/70" />
    </Button>
  )
}

function Overlay({ state }: { readonly state: OverlayState }) {
  const saveAppearance = useAtomSet(saveOverlayAppearanceAtom)
  const setPaused = useAtomSet(setOverlayPausedAtom)
  const retry = useAtomSet(retryTranslationAtom)
  const [draftOpacity, setDraftOpacity] = useState<number | undefined>(undefined)
  const { appearance } = state
  const opacity = draftOpacity ?? appearance.opacity
  const fontFamily = appearance.fontFamily === systemFont ? undefined : appearance.fontFamily

  const { inline, overflow } = useToolbarLayout()

  const change = (patch: Partial<OverlayAppearance>) =>
    saveAppearance({ payload: { ...appearance, ...patch } })

  const actions: ToolActions = {
    state,
    opacity,
    change,
    retry: () => retry({ payload: undefined }),
    onOpacityDraft: setDraftOpacity,
    onOpacityCommit: (value) => {
      setDraftOpacity(undefined)
      change({ opacity: value })
    },
  }

  return (
    <main className="h-screen overflow-hidden bg-transparent text-white" style={{ opacity }}>
      <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl">
        <div
          className={cn(
            appearance.locked ? 'app-no-drag' : 'app-drag',
            'flex items-start gap-4 border-b border-white/10 px-4 py-3',
          )}
          {...captureWhileLocked(appearance.locked)}
        >
          <div className="min-w-30 flex-1">
            <p className="truncate text-xs font-medium">
              {state.gameTitle ?? 'Translation Overlay'}
            </p>
            <Usage state={state} />
          </div>

          <div className="app-no-drag flex shrink-0 items-center gap-2 self-center">
            <ToolButton
              label={state.paused ? 'Resume translation overlay' : 'Pause translation overlay'}
              onClick={() => setPaused({ payload: { paused: !state.paused } })}
            >
              {state.paused ? <PlayIcon /> : <PauseIcon />}
            </ToolButton>
            {inline.includes('textStyle') ? (
              <TextStyle appearance={appearance} onChange={change} />
            ) : null}
            <ToolButton
              label={appearance.locked ? 'Unlock overlay' : 'Lock overlay'}
              onClick={() => change({ locked: !appearance.locked })}
            >
              {appearance.locked ? <LockIcon /> : <LockOpenIcon />}
            </ToolButton>
            {inline.includes('original') ? (
              <ToolButton
                label={appearance.showOriginal ? 'Hide original text' : 'Show original text'}
                onClick={() => change({ showOriginal: !appearance.showOriginal })}
              >
                {appearance.showOriginal ? <EyeSlashIcon /> : <EyeIcon />}
              </ToolButton>
            ) : null}
            {inline.includes('retry') ? (
              <ToolButton
                label="Retry translation"
                disabled={!canRetry(state)}
                onClick={actions.retry}
              >
                <ArrowsClockwiseIcon />
              </ToolButton>
            ) : null}
            {inline.includes('opacity') ? (
              <>
                <Separator orientation="vertical" className="bg-white/10" />
                <Field orientation="horizontal" className="w-auto shrink-0 items-center gap-2">
                  <FieldTitle className="text-[11px] leading-none font-medium text-white/55">
                    Opacity
                  </FieldTitle>
                  <FieldContent className="w-20 flex-none gap-0 pt-1">
                    <OpacitySlider
                      opacity={opacity}
                      className="[&_[data-slot=slider-range]]:bg-white/65 [&_[data-slot=slider-track]]:bg-white/15"
                      onDraft={actions.onOpacityDraft}
                      onCommit={actions.onOpacityCommit}
                    />
                  </FieldContent>
                </Field>
              </>
            ) : null}
            {overflow.length === 0 ? null : <MoreMenu tools={overflow} actions={actions} />}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col justify-center gap-3 px-4 py-2">
            {appearance.showOriginal && state.sourceText !== undefined ? (
              <>
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-white/70">
                  {state.sourceText}
                </p>
                <Separator className="bg-white/10" />
              </>
            ) : null}
            <p
              className="leading-snug font-semibold break-words whitespace-pre-wrap"
              style={{
                color: appearance.fontColor,
                fontFamily,
                fontSize: `${appearance.fontSize}px`,
              }}
            >
              {state.translatedText ?? state.message}
            </p>
          </div>
        </ScrollArea>

        <StatusBadges state={state} />
        <ResizeGrip disabled={appearance.locked} />
      </section>
    </main>
  )
}

export function OverlayPage() {
  const result = useAtomValue(overlayAtom)

  return AsyncResult.isSuccess(result) ? <Overlay state={result.value} /> : null
}
