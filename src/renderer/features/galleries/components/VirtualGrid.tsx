import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

export function VirtualGrid<A>({
  items,
  minWidth,
  gap,
  rowGap,
  estimateRow,
  keyOf,
  children,
}: {
  readonly items: ReadonlyArray<A>
  readonly minWidth: number
  readonly gap: number
  readonly rowGap: number
  readonly estimateRow: (columnWidth: number) => number
  readonly keyOf: (item: A) => string
  readonly children: (item: A, index: number) => ReactNode
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  const [offset, setOffset] = useState(0)

  useLayoutEffect(() => {
    const element = grid.current
    const main = element?.closest('main') ?? null

    if (element === null || main === null) {
      return
    }

    setScroller(main)

    const measure = () => {
      setWidth(element.clientWidth)

      setOffset(
        element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop,
      )
    }

    measure()

    const observer = new ResizeObserver(measure)

    observer.observe(element)
    observer.observe(main.firstElementChild ?? main)

    return () => observer.disconnect()
  }, [])

  const columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  const columnWidth = (width - gap * (columns - 1)) / columns
  const rows = Math.ceil(items.length / columns)

  // oxlint-disable-next-line react/incompatible-library -- the virtualizer re-renders this grid itself; nothing downstream memoizes its functions.
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller,
    estimateSize: () => estimateRow(columnWidth),
    overscan: 1,
    gap: rowGap,
    scrollMargin: offset,
  })

  return (
    <div ref={grid} className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
      {width === 0
        ? null
        : virtualizer.getVirtualItems().map((row) => {
            const inRow = items.slice(row.index * columns, (row.index + 1) * columns)

            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="absolute inset-x-0 top-0 grid"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  columnGap: `${gap}px`,
                  transform: `translate3d(0, ${row.start - offset}px, 0)`,
                }}
              >
                {inRow.map((item, at) => (
                  <div key={keyOf(item)}>{children(item, row.index * columns + at)}</div>
                ))}
              </div>
            )
          })}
    </div>
  )
}
