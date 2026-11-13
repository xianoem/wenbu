import { SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import type { GalleryPage, ReadingDirection } from '#contract/Galleries'
import { Button } from '#ui/button'
import { Thumbnail } from '../components/Thumbnail'

const previewSize = 256

export function Scrubber({
  pages,
  shown,
  direction,
  onPage,
}: {
  readonly pages: ReadonlyArray<GalleryPage>
  readonly shown: ReadonlyArray<number>
  readonly direction: ReadingDirection
  readonly onPage: (page: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)

  const [hover, setHover] = useState<{ readonly page: number; readonly x: number } | undefined>(
    undefined,
  )

  const dragging = useRef(false)
  const last = Math.max(1, pages.length - 1)
  const first = shown[0] ?? 0
  const progress = first / last
  const rtl = direction === 'rtl'

  const pageAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()

    if (box === undefined || box.width === 0) {
      return undefined
    }

    const along = Math.min(1, Math.max(0, (clientX - box.left) / box.width))

    return { page: Math.round((rtl ? 1 - along : along) * last), x: clientX - box.left }
  }

  const point = (clientX: number) => {
    const found = pageAt(clientX)

    setHover(found)

    if (found !== undefined && dragging.current) {
      onPage(found.page)
    }
  }

  const label = shown.length > 1 ? `${first + 1}–${(shown.at(-1) ?? first) + 1}` : `${first + 1}`
  const startButton = { label: 'First page', Icon: SkipBackIcon, page: 0 }
  const endButton = { label: 'Last page', Icon: SkipForwardIcon, page: pages.length - 1 }
  const [leftButton, rightButton] = rtl ? [endButton, startButton] : [startButton, endButton]
  const previewPage = hover === undefined ? undefined : pages[hover.page]

  const edgeButton = (button: typeof startButton) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={button.label}
      className="size-7 rounded-full text-muted-foreground"
      onClick={() => onPage(button.page)}
    >
      <button.Icon />
    </Button>
  )

  return (
    <div className="flex w-[640px] max-w-[calc(100vw-32px)] items-center gap-3.5 rounded-full bg-card/80 py-2 pr-[18px] pl-2.5 shadow-card backdrop-blur-xl">
      {edgeButton(leftButton)}
      <div
        ref={track}
        role="slider"
        aria-label="Page"
        aria-valuemin={1}
        aria-valuemax={pages.length}
        aria-valuenow={first + 1}
        tabIndex={-1}
        className="relative h-4 flex-1 cursor-pointer touch-none"
        onPointerDown={(event) => {
          dragging.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          point(event.clientX)
        }}
        onPointerMove={(event) => point(event.clientX)}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerLeave={() => {
          if (!dragging.current) {
            setHover(undefined)
          }
        }}
      >
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <span
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={
            rtl
              ? { right: 0, width: `${progress * 100}%` }
              : { left: 0, width: `${progress * 100}%` }
          }
        />
        <span
          className="absolute top-1/2 size-3.5 -translate-1/2 rounded-full bg-primary shadow-[0_0_0_4px_oklch(0.92_0.004_286.32/0.2)]"
          style={{ left: `${(rtl ? 1 - progress : progress) * 100}%` }}
        />
        {hover === undefined || previewPage === undefined ? null : (
          <span
            className="pointer-events-none absolute bottom-7 w-24 -translate-x-1/2 rounded-[14px] bg-card p-[5px] text-center text-xs shadow-card"
            style={{ left: hover.x }}
          >
            <Thumbnail
              file={previewPage.file}
              version={previewPage.modifiedMs}
              size={previewSize}
              className="aspect-[0.7] rounded-[9px]"
            />
            <span className="mt-1 block">{hover.page + 1}</span>
          </span>
        )}
      </div>
      {edgeButton(rightButton)}
      <span className="text-[13px] whitespace-nowrap">
        {label} <span className="text-muted-foreground">/ {pages.length}</span>
      </span>
    </div>
  )
}
