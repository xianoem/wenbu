import { ArrowsLeftRightIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { type ReactNode, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { pageImageUrl } from '#contract/PageImage'
import type { GamePicture, PictureStyle, ShownLine } from '#contract/Pictures'
import { Button } from '#ui/button'
import { PictureCanvas } from './PictureCanvas'

const percent = (part: number, whole: number) => `${(part / Math.max(1, whole)) * 100}%`

const editorPlacement = (picture: GamePicture, line: ShownLine) => {
  const horizontal =
    line.x / picture.width > 0.55
      ? { right: percent(picture.width - line.x - line.w, picture.width) }
      : { left: percent(line.x, picture.width) }

  const vertical =
    line.y / picture.height > 0.5
      ? { bottom: `calc(${percent(picture.height - line.y, picture.height)} + 12px)` }
      : { top: `calc(${percent(line.y + line.h, picture.height)} + 12px)` }

  return { ...horizontal, ...vertical }
}

function LineBox({
  picture,
  line,
  selected,
  onSelect,
}: {
  readonly picture: GamePicture
  readonly line: ShownLine
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={`Line ${line.id}: ${line.source}`}
      className={cn(
        'absolute h-auto rounded-[4px] border-0 p-0 ring-[1.5px] ring-tint-violet-foreground outline-none hover:bg-white/5',
        selected && 'ring-2 ring-white',
        line.keep && 'opacity-60 ring-1 ring-white/60',
      )}
      style={{
        left: percent(line.x - 3, picture.width),
        top: percent(line.y - 3, picture.height),
        width: percent(line.w + 6, picture.width),
        height: percent(line.h + 6, picture.height),
        boxShadow: selected ? '0 0 0 5px oklch(0.86 0.07 290 / 0.45)' : undefined,
      }}
      onClick={onSelect}
    >
      <span className="absolute -top-2.5 -left-2.5 flex size-4.5 items-center justify-center rounded-full bg-tint-violet-foreground text-[11px] font-semibold text-card">
        {line.id}
      </span>
    </Button>
  )
}

export type StageTool = 'select' | 'draw'

export interface DrawnBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

interface Point {
  readonly x: number
  readonly y: number
}

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

export const nextZoom = (zoom: number, direction: 1 | -1) => {
  const steps = direction === 1 ? ZOOMS : ZOOMS.toReversed()

  return steps.find((step) => (direction === 1 ? step > zoom : step < zoom)) ?? zoom
}

/** A box smaller than this on either side is a slip of the mouse, not a drawn box. */
const MIN_DRAWN = 4

const boxOf = (start: Point, end: Point): DrawnBox => ({
  x: Math.round(Math.min(start.x, end.x)),
  y: Math.round(Math.min(start.y, end.y)),
  w: Math.round(Math.abs(end.x - start.x)),
  h: Math.round(Math.abs(end.y - start.y)),
})

const isControl = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('button, input, [role=slider], [data-editor]') !== null

export function PictureStage({
  picture,
  cleaned,
  pictureStyle,
  selected,
  split,
  showOriginal,
  zoom,
  tool,
  onSelect,
  onSplit,
  onZoom,
  onDraw,
  editor,
}: {
  readonly picture: GamePicture
  readonly cleaned: ImageBitmap | undefined
  readonly pictureStyle: PictureStyle
  readonly selected: number | undefined
  readonly split: number
  readonly showOriginal: boolean
  readonly zoom: number
  readonly tool: StageTool
  readonly onSelect: (line: number | undefined) => void
  readonly onSplit: (split: number) => void
  readonly onZoom: (zoom: number) => void
  readonly onDraw: (box: DrawnBox) => void
  readonly editor: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const anchor = useRef<Point | undefined>(undefined)
  const shownZoom = useRef(zoom)

  const pan = useRef<{ readonly from: Point; readonly scroll: Point; moved: boolean } | undefined>(
    undefined,
  )

  const [draft, setDraft] = useState<{ readonly start: Point; readonly end: Point }>()
  const shownSplit = showOriginal || cleaned === undefined ? 1 : split
  const line = picture.lines.find((candidate) => candidate.id === selected)

  const dragTo = (clientX: number) => {
    const bounds = frame.current?.getBoundingClientRect()

    if (bounds !== undefined && bounds.width > 0) {
      onSplit(Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)))
    }
  }

  const pictureAt = (clientX: number, clientY: number): Point => {
    const bounds = frame.current?.getBoundingClientRect()

    if (bounds === undefined || bounds.width === 0) {
      return { x: 0, y: 0 }
    }

    const x = ((clientX - bounds.left) / bounds.width) * picture.width
    const y = ((clientY - bounds.top) / bounds.height) * picture.height

    return {
      x: Math.min(picture.width, Math.max(0, x)),
      y: Math.min(picture.height, Math.max(0, y)),
    }
  }

  const onWheel = useEffectEvent((event: WheelEvent) => {
    const bounds = scroller.current?.getBoundingClientRect()

    if (!event.ctrlKey || bounds === undefined) {
      return
    }

    event.preventDefault()
    anchor.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    onZoom(nextZoom(zoom, event.deltaY < 0 ? 1 : -1))
  })

  useEffect(() => {
    const element = scroller.current
    const listener = (event: WheelEvent) => onWheel(event)

    element?.addEventListener('wheel', listener, { passive: false })

    return () => element?.removeEventListener('wheel', listener)
  }, [])

  // Keeps the point under the pointer, or the middle of the view, in place as the zoom changes.
  useLayoutEffect(() => {
    const element = scroller.current
    const before = shownZoom.current

    shownZoom.current = zoom

    if (element === null || before === zoom) {
      return
    }

    const at = anchor.current ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 }
    const ratio = zoom / before

    anchor.current = undefined
    element.scrollLeft = (element.scrollLeft + at.x) * ratio - at.x
    element.scrollTop = (element.scrollTop + at.y) * ratio - at.y
  }, [zoom])

  const cursor = () => {
    if (tool === 'draw') {
      return 'cursor-crosshair'
    }

    return zoom > 1 ? 'cursor-grab' : undefined
  }

  return (
    <div
      ref={scroller}
      className={cn(
        'relative min-h-0 flex-1 overflow-auto px-6 pt-20 pb-32 [container-type:size]',
        cursor(),
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 || isControl(event.target)) {
          return
        }

        event.currentTarget.setPointerCapture(event.pointerId)

        if (tool === 'draw') {
          const start = pictureAt(event.clientX, event.clientY)

          setDraft({ start, end: start })

          return
        }

        pan.current = {
          from: { x: event.clientX, y: event.clientY },
          scroll: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
          moved: false,
        }
      }}
      onPointerMove={(event) => {
        if (draft !== undefined) {
          setDraft({ ...draft, end: pictureAt(event.clientX, event.clientY) })

          return
        }

        const panning = pan.current

        if (panning === undefined) {
          return
        }

        const dx = event.clientX - panning.from.x
        const dy = event.clientY - panning.from.y

        panning.moved = panning.moved || Math.abs(dx) + Math.abs(dy) > 3
        event.currentTarget.scrollLeft = panning.scroll.x - dx
        event.currentTarget.scrollTop = panning.scroll.y - dy
      }}
      onPointerUp={() => {
        if (draft !== undefined) {
          const box = boxOf(draft.start, draft.end)

          setDraft(undefined)

          if (box.w >= MIN_DRAWN && box.h >= MIN_DRAWN) {
            onDraw(box)
          }

          return
        }

        if (pan.current !== undefined && !pan.current.moved) {
          onSelect(undefined)
        }

        pan.current = undefined
      }}
    >
      <div className="grid min-h-full w-max min-w-full place-items-center">
        <div
          ref={frame}
          className="relative shadow-[0_16px_40px_rgb(0_0_0/0.5)]"
          style={{
            width: `calc(min(100cqw, 100cqh * ${picture.width} / ${picture.height}) * ${zoom})`,
            aspectRatio: `${picture.width} / ${picture.height}`,
          }}
        >
          <img
            alt=""
            draggable={false}
            src={pageImageUrl(picture.original, 0)}
            className="checker pointer-events-none absolute inset-0 size-full select-none"
          />
          {cleaned === undefined ? null : (
            <PictureCanvas
              image={cleaned}
              lines={picture.lines}
              pictureStyle={pictureStyle}
              className="pointer-events-none absolute inset-0 size-full"
              style={{ clipPath: `inset(0 0 0 ${shownSplit * 100}%)` }}
            />
          )}
          <div className={cn(tool === 'draw' && 'pointer-events-none')}>
            {picture.lines.map((each) => (
              <LineBox
                key={each.id}
                picture={picture}
                line={each}
                selected={each.id === selected}
                onSelect={() => onSelect(each.id)}
              />
            ))}
          </div>
          {draft === undefined ? null : (
            <div
              className="pointer-events-none absolute rounded-[3px] border-[1.5px] border-dashed border-white bg-white/10"
              style={{
                left: percent(Math.min(draft.start.x, draft.end.x), picture.width),
                top: percent(Math.min(draft.start.y, draft.end.y), picture.height),
                width: percent(Math.abs(draft.end.x - draft.start.x), picture.width),
                height: percent(Math.abs(draft.end.y - draft.start.y), picture.height),
              }}
            />
          )}
          {cleaned === undefined || showOriginal ? null : (
            <div
              role="slider"
              aria-label="Original and translated"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split * 100)}
              tabIndex={-1}
              className="absolute -top-2.5 -bottom-2.5 z-10 w-0.5 -translate-x-1/2 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
              style={{ left: `${split * 100}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                dragTo(event.clientX)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  dragTo(event.clientX)
                }
              }}
            >
              <span className="absolute top-1/2 left-1/2 flex size-8.5 -translate-1/2 items-center justify-center rounded-full bg-white text-lg text-black shadow-[0_4px_14px_rgb(0_0_0/0.5)]">
                <ArrowsLeftRightIcon />
              </span>
            </div>
          )}
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-muted-foreground">
            Original
          </span>
          {cleaned === undefined || showOriginal ? null : (
            <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-tint-violet px-2.5 py-0.5 text-[11.5px] font-medium text-tint-violet-foreground">
              Translated
            </span>
          )}
          {line === undefined ? null : (
            <div
              data-editor
              className="absolute z-20 cursor-auto rounded-2xl bg-card p-1 shadow-[0_16px_40px_rgb(0_0_0/0.55),0_0_0_1px_oklch(1_0_0/0.08)]"
              style={editorPlacement(picture, line)}
            >
              {editor}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
