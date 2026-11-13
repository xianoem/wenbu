import { cn } from 'cn'
import { type MouseEvent, type PointerEvent, useRef, useState } from 'react'
import type { BlockStatus, PageBox, TextBlock } from '#contract/MangaEditor'
import type { ShownPage } from './PageView'

export type Line = ReadonlyArray<TextBlock>

const badgeColors: Record<BlockStatus, string> = {
  reading: 'fill-info',
  translating: 'fill-info',
  draft: 'fill-muted-foreground',
  approved: 'fill-success',
  failed: 'fill-destructive',
}

interface Point {
  readonly x: number
  readonly y: number
}

const pointOf = (event: MouseEvent<Element>, page: ShownPage): Point => {
  const bounds = (event.currentTarget.closest('svg') ?? event.currentTarget).getBoundingClientRect()

  return {
    x: ((event.clientX - bounds.left) / bounds.width) * page.width,
    y: ((event.clientY - bounds.top) / bounds.height) * page.height,
  }
}

const boxBetween = (from: Point, to: Point): PageBox => ({
  x: Math.round(Math.min(from.x, to.x)),
  y: Math.round(Math.min(from.y, to.y)),
  width: Math.round(Math.abs(to.x - from.x)),
  height: Math.round(Math.abs(to.y - from.y)),
})

const contains = (box: PageBox, point: Point) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height

function Badge({
  box,
  number,
  status,
  radius,
}: {
  readonly box: PageBox
  readonly number: number
  readonly status: BlockStatus
  readonly radius: number
}) {
  return (
    <g transform={`translate(${box.x + box.width} ${box.y})`}>
      <circle r={radius} className={cn(badgeColors[status], 'stroke-black/70')} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-white font-mono font-semibold"
        style={{ fontSize: radius * 1.05 }}
      >
        {number}
      </text>
    </g>
  )
}

export function ReviewOverlay({
  page,
  lines,
  selected,
  drawing,
  onSelect,
  onDraw,
}: {
  readonly page: ShownPage
  readonly lines: ReadonlyArray<Line>
  readonly selected: string | undefined
  readonly drawing: boolean
  readonly onSelect: (id: string) => void
  readonly onDraw: (box: PageBox) => void
}) {
  const [drag, setDrag] = useState<{ from: Point; to: Point }>()
  const radius = 10 / page.scale

  return (
    <svg
      viewBox={`0 0 ${page.width} ${page.height}`}
      className={cn('absolute inset-0 size-full', drawing && 'cursor-crosshair')}
      onPointerDown={(event) => {
        if (drawing) {
          event.currentTarget.setPointerCapture(event.pointerId)

          const point = pointOf(event, page)

          setDrag({ from: point, to: point })
        }
      }}
      onPointerMove={(event) =>
        drag === undefined ? undefined : setDrag({ ...drag, to: pointOf(event, page) })
      }
      onPointerUp={() => {
        if (drag !== undefined) {
          const box = boxBetween(drag.from, drag.to)

          if (box.width >= 4 && box.height >= 4) {
            onDraw(box)
          }
        }

        setDrag(undefined)
      }}
    >
      {lines.map((line, index) => {
        const chosen = line.some((block) => block.id === selected)

        return line.map((block, part) => (
          <g
            key={block.id}
            className={drawing ? 'pointer-events-none' : 'cursor-pointer'}
            onClick={() => onSelect(block.id)}
          >
            <rect
              {...block.box}
              rx={radius / 3}
              className={cn(
                'stroke-[2px] [vector-effect:non-scaling-stroke]',
                chosen
                  ? 'fill-info/15 stroke-info [stroke-dasharray:6_4]'
                  : 'fill-transparent stroke-transparent hover:stroke-info/60',
                block.status === 'reading' && 'animate-pulse fill-info/20',
              )}
            />
            {part === 0 ? (
              <Badge box={block.box} number={index + 1} status={block.status} radius={radius} />
            ) : null}
          </g>
        ))
      })}
      {drag === undefined ? null : (
        <rect
          {...boxBetween(drag.from, drag.to)}
          className="fill-info/15 stroke-info stroke-[2px] [stroke-dasharray:5_4] [vector-effect:non-scaling-stroke]"
        />
      )}
    </svg>
  )
}

export function OrderOverlay({
  page,
  blocks,
  numbered,
  onNumber,
}: {
  readonly page: ShownPage
  readonly blocks: ReadonlyArray<TextBlock>
  readonly numbered: ReadonlyArray<string>
  readonly onNumber: (id: string) => void
}) {
  const radius = 10 / page.scale

  const order = [
    ...numbered,
    ...blocks.map((block) => block.id).filter((id) => !numbered.includes(id)),
  ]

  const byId = new Map(blocks.map((block) => [block.id, block]))

  const path = order
    .map((id) => byId.get(id)?.box)
    .filter((box) => box !== undefined)
    .map((box) => `${box.x + box.width} ${box.y}`)
    .join(' L ')

  return (
    <svg viewBox={`0 0 ${page.width} ${page.height}`} className="absolute inset-0 size-full">
      {path === '' ? null : (
        <path
          d={`M ${path}`}
          className="fill-none stroke-info/60 stroke-[2.5px] [stroke-dasharray:6_6] [vector-effect:non-scaling-stroke]"
        />
      )}
      {order.map((id, index) => {
        const block = byId.get(id)

        if (block === undefined) {
          return null
        }

        const done = numbered.includes(id)

        return (
          <g key={id} className="cursor-pointer" onClick={() => onNumber(id)}>
            <rect
              {...block.box}
              className={cn(
                'stroke-[2px] [vector-effect:non-scaling-stroke]',
                done
                  ? 'fill-info/15 stroke-info'
                  : 'fill-transparent stroke-info/40 hover:fill-info/10',
              )}
            />
            <g transform={`translate(${block.box.x + block.box.width} ${block.box.y})`}>
              <circle r={radius} className={done ? 'fill-info' : 'fill-muted-foreground'} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white font-mono font-semibold"
                style={{ fontSize: radius * 1.05 }}
              >
                {index + 1}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

export function BrushOverlay({
  page,
  brushSize,
  onStroke,
}: {
  readonly page: ShownPage
  readonly brushSize: number
  readonly onStroke: (png: Uint8Array) => Promise<void>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<Point | undefined>(undefined)
  const painting = useRef(false)
  const sent = useRef(0)
  const [pending, setPending] = useState(0)

  const paint = (point: Point) => {
    const context = canvas.current?.getContext('2d')

    if (context === null || context === undefined) {
      return
    }

    context.strokeStyle = 'rgb(255,0,0)'
    context.lineWidth = brushSize
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(last.current?.x ?? point.x, last.current?.y ?? point.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    last.current = point
  }

  const finish = () => {
    const element = canvas.current

    if (!painting.current || element === null) {
      return
    }

    painting.current = false
    last.current = undefined
    sent.current += 1
    setPending(sent.current)

    element.toBlob((blob) => {
      void blob
        ?.arrayBuffer()
        .then((buffer) => onStroke(new Uint8Array(buffer)))
        .finally(() => {
          sent.current -= 1
          setPending(sent.current)

          if (sent.current === 0) {
            element.getContext('2d')?.clearRect(0, 0, element.width, element.height)
          }
        })
    }, 'image/png')
  }

  return (
    <canvas
      ref={canvas}
      width={page.width}
      height={page.height}
      className={cn(
        'absolute inset-0 size-full cursor-crosshair opacity-45',
        pending > 0 && 'animate-pulse',
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        painting.current = true
        paint(pointOf(event, page))
      }}
      onPointerMove={(event) => (painting.current ? paint(pointOf(event, page)) : undefined)}
      onPointerUp={finish}
      onLostPointerCapture={finish}
      onPointerCancel={finish}
    />
  )
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const moved = (box: PageBox, handle: Handle, dx: number, dy: number): PageBox => {
  const left = handle === 'nw' || handle === 'sw'
  const top = handle === 'nw' || handle === 'ne'

  if (handle === 'move') {
    return { ...box, x: Math.round(box.x + dx), y: Math.round(box.y + dy) }
  }

  const x = left ? box.x + dx : box.x
  const y = top ? box.y + dy : box.y
  const width = left ? box.width - dx : box.width + dx
  const height = top ? box.height - dy : box.height + dy

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(8, Math.round(width)),
    height: Math.max(8, Math.round(height)),
  }
}

export function LetterOverlay({
  page,
  blocks,
  selected,
  onSelect,
  onMove,
}: {
  readonly page: ShownPage
  readonly blocks: ReadonlyArray<TextBlock>
  readonly selected: string | undefined
  readonly onSelect: (id: string) => void
  readonly onMove: (block: TextBlock, box: PageBox) => void
}) {
  const [drag, setDrag] = useState<{ handle: Handle; from: Point; box: PageBox }>()
  const block = blocks.find((candidate) => candidate.id === selected)
  const area = block?.lettering.textBox ?? block?.box
  const shown = drag === undefined ? area : undefined
  const handle = 10 / page.scale

  const start = (event: PointerEvent<SVGElement>, which: Handle) => {
    if (area === undefined) {
      return
    }

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ handle: which, from: pointOf(event, page), box: area })
    setPreview(area)
  }

  const [preview, setPreview] = useState<PageBox>()

  return (
    <svg
      viewBox={`0 0 ${page.width} ${page.height}`}
      className="absolute inset-0 size-full"
      onPointerMove={(event) => {
        if (drag !== undefined) {
          const point = pointOf(event, page)

          setPreview(moved(drag.box, drag.handle, point.x - drag.from.x, point.y - drag.from.y))
        }
      }}
      onPointerUp={() => {
        if (drag !== undefined && block !== undefined && preview !== undefined) {
          onMove(block, preview)
        }

        setDrag(undefined)
        setPreview(undefined)
      }}
      onClick={(event) => {
        const point = pointOf(event, page)

        const hit = blocks.find((candidate) =>
          contains(candidate.lettering.textBox ?? candidate.box, point),
        )

        if (hit !== undefined) {
          onSelect(hit.id)
        }
      }}
    >
      {blocks.map((candidate) => (
        <rect
          key={candidate.id}
          {...(candidate.lettering.textBox ?? candidate.box)}
          className="fill-transparent stroke-info/30 stroke-[1px] [stroke-dasharray:4_4] [vector-effect:non-scaling-stroke]"
        />
      ))}
      {(preview ?? shown) === undefined ? null : (
        <g>
          <rect
            {...(preview ?? shown)}
            onPointerDown={(event) => start(event, 'move')}
            className="cursor-move fill-info/5 stroke-info stroke-[2px] [vector-effect:non-scaling-stroke]"
          />
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
            const box = preview ?? shown ?? { x: 0, y: 0, width: 0, height: 0 }
            const x = corner.endsWith('w') ? box.x : box.x + box.width
            const y = corner.startsWith('n') ? box.y : box.y + box.height

            return (
              <rect
                key={corner}
                x={x - handle / 2}
                y={y - handle / 2}
                width={handle}
                height={handle}
                rx={handle / 4}
                onPointerDown={(event) => start(event, corner)}
                className={cn(
                  'fill-white stroke-info stroke-[1.5px] [vector-effect:non-scaling-stroke]',
                  corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                )}
              />
            )
          })}
        </g>
      )}
    </svg>
  )
}
