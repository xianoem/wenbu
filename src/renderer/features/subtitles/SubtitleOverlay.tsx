import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ClockCounterClockwiseIcon,
  EyeSlashIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PauseIcon,
  PlayIcon,
  TextAaIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { SubtitleLine, SubtitleState } from '#contract/Subtitles'
import { Button } from '#ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import {
  setSubtitleOverlayLockedAtom,
  setSubtitleOverlayVisibleAtom,
  setSubtitlesPausedAtom,
  setSubtitleTextSizeAtom,
  subtitleBacklogAtom,
  subtitlesAtom,
} from './subtitles'

const translationSizes = [20, 24, 30, 36] as const

const minimumWidth = 360

const lingerMs = (line: SubtitleLine) => 4000 + 60 * (line.translation ?? line.original).length

const sizeOf = (textSize: number): number =>
  translationSizes[Math.min(3, Math.max(0, textSize))] ?? translationSizes[1]

function Control({
  label,
  active,
  onClick,
  children,
}: {
  readonly label: string
  readonly active?: boolean
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
            aria-label={label}
            className={cn(
              'rounded-[9px] text-white/80 hover:bg-white/12 hover:text-white',
              active && 'bg-white/12 text-white',
            )}
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

function statusText(state: SubtitleState) {
  if (state.status === 'paused') {
    return 'Paused'
  }

  if (state.status === 'loading-model') {
    return 'Loading the speech model'
  }

  if (state.status === 'failed') {
    return state.message ?? 'Stopped'
  }

  return state.translationDelay === undefined
    ? 'Listening'
    : `Listening · ${state.translationDelay.toFixed(1)} s`
}

function Line({
  line,
  size,
  showOriginal,
  faded,
}: {
  readonly line: SubtitleLine
  readonly size: number
  readonly showOriginal: boolean
  readonly faded: boolean
}) {
  const waiting = line.translation === undefined

  if (faded) {
    return (
      <p className="leading-snug font-medium text-white/50" style={{ fontSize: size * 0.75 }}>
        {line.translation ?? line.original}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {showOriginal && !waiting ? (
        <p className="text-white/55" style={{ fontSize: Math.round(size * 0.58) }}>
          {line.original}
        </p>
      ) : null}
      <p
        className={cn(
          'leading-snug font-semibold tracking-[-0.01em] transition-colors duration-150',
          waiting ? 'text-white/55' : 'text-white',
        )}
        style={{ fontSize: size }}
      >
        {line.translation ?? line.original}
      </p>
    </div>
  )
}

const atBottom = (element: HTMLElement) =>
  element.scrollTop + element.clientHeight >= element.scrollHeight - 2

function HistoryLines({
  size,
  showOriginal,
  onLive,
}: {
  readonly size: number
  readonly showOriginal: boolean
  readonly onLive: () => void
}) {
  const backlog = useAtomValue(subtitleBacklogAtom)
  const lines = AsyncResult.isSuccess(backlog) ? backlog.value.slice(-200) : []
  const list = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (list.current !== null) {
      list.current.scrollTop = list.current.scrollHeight
    }
  }, [])

  return (
    <div className="relative">
      <div
        ref={list}
        data-history
        className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1 [scrollbar-color:rgb(255_255_255/0.25)_transparent] [scrollbar-width:thin]"
        onWheel={(event) => {
          if (event.deltaY > 0 && list.current !== null && atBottom(list.current)) {
            onLive()
          }
        }}
      >
        {lines.length === 0 ? (
          <p className="text-white/55" style={{ fontSize: Math.round(size * 0.7) }}>
            No lines yet.
          </p>
        ) : null}
        {lines.map((line) => (
          <div key={line.id} className="flex flex-col gap-0.5">
            {showOriginal ? (
              <p className="text-white/50" style={{ fontSize: Math.round(size * 0.5) }}>
                {line.original}
              </p>
            ) : null}
            <p
              className="leading-snug font-medium text-white/90"
              style={{ fontSize: Math.round(size * 0.75) }}
            >
              {line.translation ?? line.original}
            </p>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        className="absolute right-0 bottom-0 h-7 rounded-full bg-white/90 px-3 text-xs text-black shadow-lg hover:bg-white"
        onClick={onLive}
      >
        Back to live
      </Button>
    </div>
  )
}

function useDragWindow(locked: boolean) {
  const start = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const onControl =
      event.target instanceof Element &&
      event.target.closest('button, [role="separator"], [data-history]') !== null

    if (locked || event.button !== 0 || onControl) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)

    start.current = {
      pointerId: event.pointerId,
      x: event.screenX - window.screenX,
      y: event.screenY - window.screenY,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current

    if (from !== undefined && from.pointerId === event.pointerId) {
      window.wenbu.moveOverlay(event.screenX - from.x, event.screenY - from.y)
    }
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      start.current = undefined
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish }
}

function WidthHandle() {
  const start = useRef<{ pointerId: number; screenX: number; width: number } | undefined>(undefined)

  const begin = (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { pointerId: event.pointerId, screenX: event.screenX, width: window.outerWidth }
  }

  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const from = start.current

    if (from === undefined || from.pointerId !== event.pointerId) {
      return
    }

    window.wenbu.resizeOverlay(
      Math.max(minimumWidth, from.width + event.screenX - from.screenX),
      window.outerHeight,
    )
  }

  const finish = (event: PointerEvent<HTMLSpanElement>) => {
    if (start.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      start.current = undefined
    }
  }

  return (
    <span
      role="separator"
      aria-label="Resize subtitles"
      className="absolute top-1/2 -right-2.5 h-9 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/60"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  )
}

function Card({ state }: { readonly state: SubtitleState }) {
  const setPaused = useAtomSet(setSubtitlesPausedAtom)
  const setLocked = useAtomSet(setSubtitleOverlayLockedAtom)
  const setVisible = useAtomSet(setSubtitleOverlayVisibleAtom)
  const setTextSize = useAtomSet(setSubtitleTextSizeAtom)
  const [hovered, setHovered] = useState(false)
  const [history, setHistory] = useState(false)
  const locked = state.overlayLocked
  const size = sizeOf(state.textSize)
  const showOriginal = state.overlayMode === 'both'
  const [previous, latest] = [state.recent.at(-2), state.recent.at(-1)]
  const shown = `${latest?.id ?? ''}|${latest?.translation ?? ''}|${state.partial ?? ''}`
  const [quietFor, setQuietFor] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (latest === undefined || state.partial !== undefined) {
      return
    }

    const timer = window.setTimeout(() => setQuietFor(shown), lingerMs(latest))

    return () => window.clearTimeout(timer)
  }, [shown, latest, state.partial])

  const quiet = latest === undefined || quietFor === shown

  const show = hovered || history || !quiet
  const drag = useDragWindow(locked)

  const cycleSize = () =>
    setTextSize({ payload: { textSize: (state.textSize + 1) % translationSizes.length } })

  return (
    <div
      className={cn(
        'relative w-full transition-opacity duration-300',
        show ? 'opacity-100' : 'opacity-0',
      )}
      onPointerEnter={() => {
        setHovered(true)
        window.wenbu.captureOverlayMouse(true)
      }}
      onPointerLeave={() => {
        setHovered(false)
        window.wenbu.captureOverlayMouse(false)
      }}
    >
      <div
        className={cn(
          'relative flex flex-col gap-2.5 rounded-[20px] bg-[oklch(0.141_0.005_285.823/0.74)] px-6 pt-2.5 pb-4 shadow-[0_12px_32px_rgb(0_0_0/0.3),0_0_0_1px_oklch(1_0_0/0.07)] backdrop-blur-xl backdrop-saturate-[1.15]',
          !locked &&
            hovered &&
            'cursor-grab outline-1 outline-offset-[5px] outline-white/35 outline-dashed active:cursor-grabbing',
        )}
        {...drag}
        onWheel={(event) => {
          if (!history && event.deltaY < 0) {
            setHistory(true)
          }
        }}
      >
        <div
          className={cn(
            'flex items-center transition-opacity duration-200',
            hovered ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <span className="inline-flex flex-1 items-center gap-1.5 text-xs text-white/55">
            <span
              className={cn(
                'size-1.5 rounded-full',
                state.status === 'listening' ? 'bg-success' : 'bg-white/40',
              )}
            />
            {statusText(state)}
          </span>
          <div className="-mr-2 flex items-center gap-0.5">
            <Control
              label={state.status === 'paused' ? 'Resume' : 'Pause'}
              onClick={() => setPaused({ payload: { paused: state.status !== 'paused' } })}
            >
              {state.status === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </Control>
            <Control
              label={history ? 'Back to live' : 'Earlier lines · scroll up'}
              active={history}
              onClick={() => setHistory(!history)}
            >
              <ClockCounterClockwiseIcon />
            </Control>
            <Control label="Text size" onClick={cycleSize}>
              <TextAaIcon />
            </Control>
            <span className="mx-1 h-4 w-px bg-white/15" />
            <Control
              label={locked ? 'Unlock to move · Ctrl+Shift+S' : 'Lock position · Ctrl+Shift+S'}
              active={!locked}
              onClick={() => setLocked({ payload: { locked: !locked } })}
            >
              {locked ? <LockSimpleIcon /> : <LockSimpleOpenIcon />}
            </Control>
            <Control label="Hide" onClick={() => setVisible({ payload: { visible: false } })}>
              <EyeSlashIcon />
            </Control>
          </div>
        </div>
        {history ? (
          <HistoryLines size={size} showOriginal={showOriginal} onLive={() => setHistory(false)} />
        ) : (
          <>
            {previous === undefined ? null : (
              <Line line={previous} size={size} showOriginal={false} faded />
            )}
            {latest === undefined ? (
              <p className="text-white/55" style={{ fontSize: Math.round(size * 0.7) }}>
                Subtitles appear here when someone speaks.
              </p>
            ) : (
              <Line line={latest} size={size} showOriginal={showOriginal} faded={false} />
            )}
            {state.partial === undefined ? null : (
              <p className="text-white/40" style={{ fontSize: Math.round(size * 0.62) }}>
                {state.partial}…
              </p>
            )}
          </>
        )}
        {locked || !hovered ? null : <WidthHandle />}
      </div>
    </div>
  )
}

export function SubtitleOverlay() {
  const state = useAtomValue(subtitlesAtom)
  const content = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = content.current

    if (element === null) {
      return
    }

    const observer = new ResizeObserver(() =>
      window.wenbu.resizeOverlay(window.outerWidth, Math.ceil(element.scrollHeight) + 24),
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-screen w-screen items-end overflow-hidden p-3 font-sans select-none">
      <div ref={content} className="w-full">
        {AsyncResult.isSuccess(state) ? <Card state={state.value} /> : null}
      </div>
    </div>
  )
}
