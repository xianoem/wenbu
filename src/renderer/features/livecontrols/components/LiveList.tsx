import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { ScrollArea } from '#ui/scroll-area'
import type { ListStatus } from '../hooks/useLiveList'

interface LiveListProps<A> {
  readonly items: ReadonlyArray<A>
  readonly status: ListStatus
  readonly error: string | undefined
  readonly noun: string
  readonly rowHeight: number
  readonly matches: (item: A, query: string) => boolean
  readonly rowKey: (item: A) => string
  readonly renderRow: (item: A) => ReactNode
  readonly className?: string
}

const statusLine = (status: ListStatus, noun: string, count: number) =>
  status === 'loading' ? `Loading ${noun}...` : `${count} ${noun}`

export function LiveList<A>({
  items,
  status,
  error,
  noun,
  rowHeight,
  matches,
  rowKey,
  renderRow,
  className,
}: LiveListProps<A>) {
  const [query, setQuery] = useState('')
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const search = query.trim().toLowerCase()
  const visible = search === '' ? items : items.filter((item) => matches(item, search))

  // oxlint-disable-next-line react/incompatible-library -- the virtualizer re-renders this list itself; nothing downstream memoizes its functions.
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    initialRect: { width: 520, height: 390 },
    overscan: 6,
  })

  const setScrollAreaRoot = (node: HTMLDivElement | null) =>
    setScrollElement(
      node?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null,
    )

  const body = () => {
    if (error !== undefined && status === 'failed') {
      return <div className="p-4 text-sm text-destructive">{error}</div>
    }

    if (visible.length === 0 && status !== 'loading') {
      return <div className="p-4 text-sm text-muted-foreground">No {noun} found.</div>
    }

    return (
      <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = visible[row.index]

          return item === undefined ? null : (
            <div
              key={rowKey(item)}
              className="absolute inset-x-0 top-0 px-2 py-1"
              style={{ height: `${row.size}px`, transform: `translate3d(0, ${row.start}px, 0)` }}
            >
              {renderRow(item)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card',
        className,
      )}
    >
      <div className="border-b p-3">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`Search ${noun}`}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={`Search ${noun}...`}
          />
        </InputGroup>
        <div className="mt-2 text-xs text-muted-foreground">
          {statusLine(status, noun, visible.length)}
        </div>
      </div>
      <ScrollArea ref={setScrollAreaRoot} className="min-h-0 flex-1">
        {body()}
      </ScrollArea>
    </section>
  )
}
