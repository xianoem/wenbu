import { cn } from 'cn'
import { Predicate } from 'effect'
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export interface PageSize {
  readonly width: number
  readonly height: number
}

export interface ShownPage extends PageSize {
  readonly scale: number
}

export type Zoom = 'fit' | 'width' | number

function useSize(element: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<PageSize>()

  useEffect(() => {
    const current = element.current

    if (current === null) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })

    observer.observe(current)

    return () => observer.disconnect()
  }, [element])

  return size
}

const MARGIN = 24

function scaleFor(zoom: Zoom, page: PageSize | undefined, box: PageSize | undefined) {
  if (Predicate.isNumber(zoom)) {
    return zoom
  }

  if (page === undefined || box === undefined) {
    return undefined
  }

  const width = (box.width - MARGIN * 2) / page.width

  return zoom === 'width' ? width : Math.min(width, (box.height - MARGIN * 2) / page.height)
}

interface Anchor {
  readonly x: number
  readonly y: number
  readonly clientX: number
  readonly clientY: number
}

export function PageView({
  src,
  zoom,
  panning,
  onZoom,
  onScale,
  children,
}: {
  readonly src: string | undefined
  readonly zoom: Zoom
  readonly panning: boolean
  readonly onZoom: (zoom: Zoom) => void
  readonly onScale: (scale: number) => void
  readonly children?: (page: ShownPage) => ReactNode
}) {
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
  const anchor = useRef<Anchor | undefined>(undefined)
  const box = useSize(area)
  const [page, setPage] = useState<PageSize>()
  const scale = scaleFor(zoom, page, box)

  useEffect(() => {
    if (scale !== undefined) {
      onScale(scale)
    }
  }, [onScale, scale])

  // Ctrl+wheel zooms; React's wheel listener is passive, which would let the page zoom too.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    const element = area.current
    const sheet = element?.firstElementChild?.firstElementChild

    if (!(event.ctrlKey || event.metaKey) || scale === undefined || element === null) {
      return
    }

    event.preventDefault()

    if (sheet instanceof HTMLElement) {
      const bounds = sheet.getBoundingClientRect()

      anchor.current = {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
        clientX: event.clientX,
        clientY: event.clientY,
      }
    }

    onZoom(Math.min(4, Math.max(0.05, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15))))
  })

  useEffect(() => {
    const element = area.current
    const listener = (event: WheelEvent) => onWheel(event)

    element?.addEventListener('wheel', listener, { passive: false })

    return () => element?.removeEventListener('wheel', listener)
  }, [])

  useLayoutEffect(() => {
    const element = area.current
    const sheet = element?.firstElementChild?.firstElementChild
    const point = anchor.current

    anchor.current = undefined

    if (
      element === null ||
      point === undefined ||
      scale === undefined ||
      !(sheet instanceof HTMLElement)
    ) {
      return
    }

    const bounds = sheet.getBoundingClientRect()

    element.scrollLeft += bounds.left + point.x * bounds.width - point.clientX
    element.scrollTop += bounds.top + point.y * bounds.height - point.clientY
  }, [scale])

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const current = area.current

    if (!panning || current === null) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)

    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: current.scrollLeft,
      top: current.scrollTop,
    }
  }

  const pan = (event: PointerEvent<HTMLDivElement>) => {
    const current = area.current
    const from = drag.current

    if (current === null || from === undefined) {
      return
    }

    current.scrollLeft = from.left - (event.clientX - from.x)
    current.scrollTop = from.top - (event.clientY - from.y)
  }

  return (
    <div
      ref={area}
      onPointerDown={startPan}
      onPointerMove={pan}
      onPointerUp={() => {
        drag.current = undefined
      }}
      className={cn(
        'no-scrollbar relative min-h-0 flex-1 overflow-auto bg-[oklch(0.115_0.004_285)]',
        panning && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div
        className="flex min-h-full min-w-full items-center justify-center"
        style={{ padding: MARGIN }}
      >
        <div
          className={cn('relative shrink-0 bg-white shadow-card', panning && 'pointer-events-none')}
          style={
            page === undefined || scale === undefined
              ? { visibility: 'hidden' }
              : { width: page.width * scale, height: page.height * scale }
          }
        >
          <img
            src={src}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={(event) =>
              setPage({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            className="block size-full select-none"
          />
          {page === undefined || scale === undefined ? null : children?.({ ...page, scale })}
        </div>
      </div>
      {page === undefined ? (
        <div className="absolute inset-6 animate-pulse rounded-xl bg-muted" />
      ) : null}
    </div>
  )
}
