import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsOutLineHorizontalIcon,
  ArrowsOutLineVerticalIcon,
  BookOpenIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CornersInIcon,
  CornersOutIcon,
  DotsThreeIcon,
  FileIcon,
  type Icon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  RowsIcon,
} from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  GalleryPage,
  GalleryVersion,
  OpenedGallery,
  ReadingDirection,
  ViewerLayout,
} from '#contract/Galleries'
import { pageImageUrl } from '#contract/PageImage'
import { type ViewerOpening, viewerAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { galleriesKeys, galleryAtom, saveReadingAtom } from '../galleries'
import { bitmapCache } from './bitmapCache'
import { pageDecoders } from './decoders'
import { pageLoader } from './pageLoader'
import { isDecoded, PageView } from './PageView'
import { Scrubber } from './Scrubber'
import { type Fit, matchingPage, pageBoxes, readingOrder, spreadOf, spreadsOf } from './spreads'
import { scrollAfterZoom, zoomBy, zoomLimits } from './zoom'

const memoryBudget = 256 * 1024 * 1024

const barsIdleMs = 2000

const hintMs = 3000

const pageGap = 8

const saveAfterMs = 1000

const widthStep = 128

const layouts: ReadonlyArray<{
  readonly id: ViewerLayout
  readonly label: string
  readonly Icon: Icon
}> = [
  { id: 'single', label: 'Single page', Icon: FileIcon },
  { id: 'spread', label: 'Spread', Icon: BookOpenIcon },
  { id: 'scroll', label: 'Scroll', Icon: RowsIcon },
]

const keyOf = (page: GalleryPage) => `${page.file}|${page.modifiedMs}`

const decodeWidth = (page: GalleryPage, shownWidth: number) => {
  const wanted = Math.ceil((shownWidth * window.devicePixelRatio) / widthStep) * widthStep

  return page.width === null ? wanted : Math.min(page.width, wanted)
}

const pagesOf = (gallery: OpenedGallery, version: GalleryVersion) => {
  const pages = version === 'translated' ? gallery.translated : gallery.original

  return pages.length > 0 ? pages : [...gallery.translated, ...gallery.original]
}

function useSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    if (element === null) {
      return
    }

    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })

    // Measured at once as well: a resize observer reports only when the window next renders.
    measure()

    const observer = new ResizeObserver(measure)

    observer.observe(element)

    return () => observer.disconnect()
  }, [element])

  return size
}

function BarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  readonly label: string
  readonly active?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'size-7 rounded-full text-muted-foreground',
        active && 'bg-secondary text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

const Separator = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

function ScrollStage({
  pages,
  page,
  fit,
  zoom,
  stage,
  bitmapOf,
  onVisible,
}: {
  readonly pages: ReadonlyArray<GalleryPage>
  readonly page: number
  readonly fit: Fit
  readonly zoom: number
  readonly stage: { readonly width: number; readonly height: number }
  readonly bitmapOf: (page: GalleryPage) => ImageBitmap | undefined
  readonly onVisible: (page: number) => void
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const reported = useRef(page)
  const target = useRef<number | undefined>(page)

  const boxOf = (index: number) => {
    const box = pageBoxes([pages[index] ?? { width: null, height: null }], stage, fit)[0]

    return box === undefined ? undefined : { width: box.width * zoom, height: box.height * zoom }
  }

  const heightOf = (index: number) => (boxOf(index)?.height ?? 0) + pageGap

  // oxlint-disable-next-line react/incompatible-library -- the virtualizer re-renders this list itself; nothing downstream memoizes its functions.
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scroller,
    estimateSize: heightOf,
    overscan: 2,
    initialOffset: () =>
      Array.from({ length: page }, (_, index) => heightOf(index)).reduce(
        (sum, height) => sum + height,
        0,
      ),
    onChange: (instance) => {
      const offset = instance.scrollOffset ?? 0

      if (target.current !== undefined) {
        const wanted = instance.getOffsetForIndex(target.current, 'start')?.[0]

        if (wanted === undefined || Math.abs(offset - wanted) > 2) {
          return
        }

        target.current = undefined
      }

      const visible = instance
        .getVirtualItems()
        .find((item) => item.end > offset + stage.height / 3)

      if (visible !== undefined && visible.index !== reported.current) {
        reported.current = visible.index
        onVisible(visible.index)
      }
    },
  })

  useEffect(() => {
    if (page !== reported.current) {
      reported.current = page
      target.current = page
      virtualizer.scrollToIndex(page, { align: 'start' })
    }
  }, [page, virtualizer])

  useEffect(() => {
    target.current = reported.current
    virtualizer.measure()
    virtualizer.scrollToIndex(reported.current, { align: 'start' })
  }, [zoom, virtualizer])

  return (
    <div ref={setScroller} className="absolute inset-0 overflow-auto">
      <div
        className="relative"
        style={{ height: virtualizer.getTotalSize(), width: Math.max(1, zoom) * stage.width }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const shown = pages[item.index]
          const box = boxOf(item.index)

          return shown === undefined || box === undefined ? null : (
            <div
              key={item.key}
              className="absolute inset-x-0 top-0 flex justify-center"
              style={{ transform: `translate3d(0, ${item.start}px, 0)` }}
            >
              <PageView
                page={shown}
                width={box.width}
                height={box.height}
                bitmap={bitmapOf(shown)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stage({
  gallery,
  opening,
}: {
  readonly gallery: OpenedGallery
  readonly opening: ViewerOpening
}) {
  const setViewer = useAtomSet(viewerAtom)
  const save = useAtomSet(saveReadingAtom)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null)
  const stage = useSize(stageElement)
  const both = gallery.original.length > 0 && gallery.translated.length > 0
  const [version, setVersion] = useState<GalleryVersion>(opening.version)
  const [page, setPage] = useState(opening.page)
  const [layout, setLayout] = useState<ViewerLayout>(gallery.reading?.layout ?? 'single')
  const [direction, setDirection] = useState<ReadingDirection>(gallery.reading?.direction ?? 'ltr')
  const [shifted, setShifted] = useState(gallery.reading?.shiftSpread ?? false)
  const [fit, setFit] = useState<Fit>('page')
  const [zoom, setZoom] = useState<number>(zoomLimits.fitted)
  const viewportRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef<number | undefined>(undefined)
  const zoomAnchor = useRef<Parameters<typeof scrollAfterZoom> | undefined>(undefined)
  const panning = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
  const [fullscreen, setFullscreen] = useState(false)
  const [hint, setHint] = useState(false)
  const [barsShown, setBarsShown] = useState(true)
  const idleTimer = useRef<number | undefined>(undefined)

  const [{ cache, loader }] = useState(() => {
    const kept = bitmapCache<ImageBitmap>(memoryBudget)

    return { cache: kept, loader: pageLoader(pageDecoders(), kept) }
  })

  const bitmaps = useSyncExternalStore(cache.subscribe, cache.snapshot)

  const pages = pagesOf(gallery, version)
  const spreads = layout === 'spread' ? spreadsOf(pages, shifted) : pages.map((_, index) => [index])
  const current = spreadOf(spreads, page)
  const shown = spreads[current] ?? []
  const rtl = direction === 'rtl'
  const bitmapOf = (shownPage: GalleryPage) => bitmaps.get(keyOf(shownPage))

  const boxesOf = (spread: ReadonlyArray<number>) =>
    pageBoxes(
      spread.map((index) => pages[index] ?? { width: null, height: null }),
      stage,
      fit,
    )

  useEffect(() => {
    if (stage.width === 0) {
      return
    }

    const order = readingOrder(spreads, current, layout === 'spread' ? 3 : 6, 1)

    const requests = order.flatMap((index) => {
      const wanted = pages[index]
      const spread = spreads[spreadOf(spreads, index)] ?? [index]
      const box = boxesOf(spread)[spread.indexOf(index)]

      if (wanted === undefined || box === undefined || !isDecoded(wanted)) {
        return []
      }

      const onScreen = shown.includes(index)

      return [
        {
          key: keyOf(wanted),
          url: pageImageUrl(wanted.file, wanted.modifiedMs),
          width: decodeWidth(wanted, box.width * (onScreen ? zoom : zoomLimits.fitted)),
        },
      ]
    })

    loader.want(requests)

    cache.keep(
      requests.map((request) => request.key),
      memoryBudget,
      shown.length,
    )
  })

  useEffect(() => () => cache.clear(), [cache])

  const turnTo = (target: number) => setPage(Math.min(pages.length - 1, Math.max(0, target)))
  const next = () => turnTo(spreads[current + 1]?.[0] ?? page)
  const previous = () => turnTo(spreads[current - 1]?.[0] ?? page)

  const switchVersion = (target: GalleryVersion) => {
    if (target !== version) {
      setPage(matchingPage(pages, page, pagesOf(gallery, target)))
      setVersion(target)
    }
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement === null) {
      void root?.requestFullscreen()
    } else {
      void document.exitFullscreen()
    }
  }

  const close = () => setViewer(undefined)

  const zoomTo = (to: number, pointer?: { readonly x: number; readonly y: number }) => {
    const viewport = viewportRef.current

    if (to === zoom) {
      return
    }

    if (viewport !== null) {
      zoomAnchor.current = [
        { left: viewport.scrollLeft, top: viewport.scrollTop },
        pointer ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        zoom,
        to,
      ]
    }

    setZoom(to)
  }

  const pointerIn = (event: { readonly clientX: number; readonly clientY: number }) => {
    const box = viewportRef.current?.getBoundingClientRect()

    return box === undefined
      ? undefined
      : { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const anchor = zoomAnchor.current

    if (anchor === undefined || viewport === null) {
      return
    }

    const scroll = scrollAfterZoom(...anchor)

    viewport.scrollLeft = scroll.left
    viewport.scrollTop = scroll.top
    zoomAnchor.current = undefined
  })

  useLayoutEffect(() => {
    const viewport = viewportRef.current

    if (viewport === null || startedAt.current === current) {
      return
    }

    startedAt.current = current
    viewport.scrollTop = 0
    viewport.scrollLeft = rtl ? viewport.scrollWidth : 0
  })

  useEffect(() => {
    if (stageElement === null) {
      return
    }

    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault()
        zoomTo(zoomBy(zoom, -Math.sign(event.deltaY)), pointerIn(event))
      }
    }

    stageElement.addEventListener('wheel', wheel, { passive: false })

    return () => stageElement.removeEventListener('wheel', wheel)
  })

  const onControl = (target: EventTarget) =>
    target instanceof Element && target.closest('button, [role="slider"]') !== null

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current

    if (
      zoom === zoomLimits.fitted ||
      viewport === null ||
      event.button !== 0 ||
      onControl(event.target)
    ) {
      return
    }

    panning.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pan = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const start = panning.current

    if (start !== undefined && viewport !== null) {
      viewport.scrollLeft = start.left - (event.clientX - start.x)
      viewport.scrollTop = start.top - (event.clientY - start.y)
    }
  }

  const showBars = () => {
    setBarsShown(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setBarsShown(false), barsIdleMs)
  }

  useEffect(() => {
    const changed = () => {
      const entered = document.fullscreenElement !== null

      setFullscreen(entered)
      setHint(entered)

      if (entered) {
        window.setTimeout(() => setHint(false), hintMs)
      }
    }

    document.addEventListener('fullscreenchange', changed)

    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const zoomKeys: Record<string, (() => void) | undefined> = {
        '+': () => zoomTo(zoomBy(zoom, 1)),
        '=': () => zoomTo(zoomBy(zoom, 1)),
        '-': () => zoomTo(zoomBy(zoom, -1)),
        '0': () => zoomTo(zoomLimits.fitted),
      }

      const zoomAction = zoomKeys[event.key]

      if (
        zoomAction !== undefined &&
        !event.altKey &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault()
        zoomAction()

        return
      }

      if (
        event.target instanceof HTMLInputElement ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return
      }

      const actions: Record<string, (() => void) | undefined> = {
        ArrowLeft: rtl ? next : previous,
        ArrowRight: rtl ? previous : next,
        ' ': event.shiftKey ? previous : next,
        Home: () => turnTo(0),
        End: () => turnTo(pages.length - 1),
        f: toggleFullscreen,
        F: toggleFullscreen,
        '1': () => setLayout('single'),
        '2': () => setLayout('spread'),
        '3': () => setLayout('scroll'),
        t: both
          ? () => switchVersion(version === 'translated' ? 'original' : 'translated')
          : undefined,
        T: both
          ? () => switchVersion(version === 'translated' ? 'original' : 'translated')
          : undefined,
        // Electron leaves HTML full screen only when asked, so Esc does that before it closes.
        Escape: document.fullscreenElement === null ? close : toggleFullscreen,
      }

      const action = actions[event.key]

      if (action !== undefined) {
        event.preventDefault()
        action()
      }
    }

    window.addEventListener('keydown', press)

    return () => window.removeEventListener('keydown', press)
  })

  const reading = { folder: gallery.folder, page, version, direction, shiftSpread: shifted, layout }
  const latest = useRef(reading)

  useEffect(() => {
    latest.current = reading

    const timer = window.setTimeout(() => {
      void save({ payload: latest.current })

      setViewer({
        folder: gallery.folder,
        page: latest.current.page,
        version: latest.current.version,
      })
    }, saveAfterMs)

    return () => window.clearTimeout(timer)
  })

  useEffect(
    () => () => {
      void save({ payload: latest.current, reactivityKeys: galleriesKeys })
    },
    [save],
  )

  const boxes = boxesOf(shown)
  const ordered = rtl ? [...shown].toReversed() : shown
  const bars = barsShown && !fullscreen
  const [leftTurn, rightTurn] = rtl ? [next, previous] : [previous, next]

  const counter =
    shown.length > 1
      ? `${(shown[0] ?? 0) + 1}–${(shown.at(-1) ?? 0) + 1}`
      : `${(shown[0] ?? 0) + 1}`

  const edge = (side: 'left' | 'right') => (
    <div
      className={cn(
        'group absolute inset-y-0 z-10 flex w-[22%] items-center',
        side === 'left' ? 'left-0 justify-start pl-6' : 'right-0 justify-end pr-6',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={(side === 'left') === rtl ? 'Next page' : 'Previous page'}
        className={cn(
          'rounded-full bg-card/60 text-muted-foreground shadow-card backdrop-blur-md transition-opacity hover:bg-card/85 hover:text-foreground',
          fullscreen
            ? 'size-[52px] opacity-0 group-hover:opacity-100 [&_svg]:size-[22px]'
            : 'size-10',
          !fullscreen && !barsShown && 'opacity-0',
        )}
        onClick={side === 'left' ? leftTurn : rightTurn}
      >
        {side === 'left' ? <CaretLeftIcon /> : <CaretRightIcon />}
      </Button>
    </div>
  )

  return (
    <div
      ref={setRoot}
      className={cn(
        'relative flex min-h-0 flex-1 flex-col bg-[oklch(0.11_0.004_285.823)]',
        fullscreen && 'bg-black',
        !barsShown && 'cursor-none',
      )}
      onMouseMove={showBars}
    >
      <div
        ref={setStageElement}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          zoom > zoomLimits.fitted && layout !== 'scroll' && 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={() => {
          panning.current = undefined
        }}
        onDoubleClick={(event) => {
          if (!onControl(event.target)) {
            zoomTo(zoom === zoomLimits.fitted ? 2 : zoomLimits.fitted, pointerIn(event))
          }
        }}
      >
        {layout === 'scroll' ? (
          <ScrollStage
            pages={pages}
            page={page}
            fit={fit}
            zoom={zoom}
            stage={stage}
            bitmapOf={bitmapOf}
            onVisible={setPage}
          />
        ) : (
          <div ref={viewportRef} className="absolute inset-0 overflow-auto">
            <div
              className={cn(
                'flex min-h-full w-max min-w-full justify-center',
                fit === 'width' ? 'items-start' : 'items-center',
              )}
            >
              {ordered.map((index) => {
                const shownPage = pages[index]
                const box = boxes[shown.indexOf(index)]

                return shownPage === undefined || box === undefined ? null : (
                  <PageView
                    key={shownPage.file}
                    page={shownPage}
                    width={box.width * zoom}
                    height={box.height * zoom}
                    bitmap={bitmapOf(shownPage)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {layout === 'scroll' ? null : (
          <>
            {edge('left')}
            {edge('right')}
          </>
        )}

        <div
          className={cn(
            'absolute top-3.5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-card/80 p-1.5 shadow-card backdrop-blur-xl transition-opacity',
            !bars && 'pointer-events-none opacity-0',
          )}
        >
          <Button
            variant="ghost"
            className="h-7 max-w-72 gap-1.5 rounded-full px-3 text-[13px] font-normal"
            onClick={close}
          >
            <CaretLeftIcon />
            <span className="truncate">{gallery.title}</span>
          </Button>
          {both ? (
            <>
              <Separator />
              <div className="inline-flex rounded-full bg-muted/60 p-[3px]">
                {(['original', 'translated'] as const).map((option) => (
                  <Button
                    key={option}
                    variant="ghost"
                    aria-pressed={version === option}
                    className={cn(
                      'h-7 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
                      version === option && 'bg-background font-medium text-foreground shadow-card',
                    )}
                    onClick={() => switchVersion(option)}
                  >
                    {option === 'original' ? 'Original' : 'Translated'}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
          <Separator />
          {layouts.map((option) => (
            <BarButton
              key={option.id}
              label={option.label}
              active={layout === option.id}
              onClick={() => setLayout(option.id)}
            >
              <option.Icon />
            </BarButton>
          ))}
          <Separator />
          <BarButton
            label={rtl ? 'Right to left' : 'Left to right'}
            onClick={() => setDirection(rtl ? 'ltr' : 'rtl')}
          >
            {rtl ? <ArrowLeftIcon /> : <ArrowRightIcon />}
          </BarButton>
          <BarButton
            label={fit === 'page' ? 'Fit page' : 'Fit width'}
            onClick={() => setFit(fit === 'page' ? 'width' : 'page')}
          >
            {fit === 'page' ? <ArrowsOutLineVerticalIcon /> : <ArrowsOutLineHorizontalIcon />}
          </BarButton>
          <BarButton label="Zoom out" onClick={() => zoomTo(zoomBy(zoom, -1))}>
            <MagnifyingGlassMinusIcon />
          </BarButton>
          <Button
            variant="ghost"
            aria-label="Fit to screen"
            title="Fit to screen"
            className="h-7 min-w-12 rounded-full px-1.5 text-[12px] font-normal text-muted-foreground tabular-nums"
            onClick={() => zoomTo(zoomLimits.fitted)}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <BarButton label="Zoom in" onClick={() => zoomTo(zoomBy(zoom, 1))}>
            <MagnifyingGlassPlusIcon />
          </BarButton>
          <BarButton label="Full screen" onClick={toggleFullscreen}>
            <CornersOutIcon />
          </BarButton>
          {layout === 'spread' ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More"
                    className="size-7 rounded-full text-muted-foreground"
                  >
                    <DotsThreeIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem checked={shifted} onCheckedChange={setShifted}>
                  Shift spread
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div
          className={cn(
            'absolute bottom-4 left-1/2 z-20 -translate-x-1/2 transition-opacity',
            !bars && 'pointer-events-none opacity-0',
          )}
        >
          <Scrubber pages={pages} shown={shown} direction={direction} onPage={turnTo} />
        </div>

        {fullscreen ? (
          <span className="pointer-events-none absolute bottom-3.5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-[3px] text-xs text-white/70">
            {counter} / {pages.length}
          </span>
        ) : null}

        {hint ? (
          <div className="pointer-events-none absolute top-[18px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card/85 px-4 py-2 text-[13px] shadow-card backdrop-blur-xl">
            <CornersInIcon />
            Full screen ·{' '}
            <kbd className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
              Esc
            </kbd>{' '}
            to leave ·{' '}
            <kbd className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">←</kbd>
            <kbd className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
              →
            </kbd>{' '}
            to turn pages
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function GalleryViewer({ opening }: { readonly opening: ViewerOpening }) {
  const result = useAtomValue(galleryAtom(opening.folder))
  const setViewer = useAtomSet(viewerAtom)

  if (AsyncResult.isSuccess(result)) {
    return <Stage key={opening.folder} gallery={result.value} opening={opening} />
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[oklch(0.11_0.004_285.823)] text-muted-foreground">
      <p>
        {AsyncResult.isFailure(result) ? 'This gallery is no longer in Galleries.' : 'Opening…'}
      </p>
      {AsyncResult.isFailure(result) ? (
        <Button variant="secondary" className="rounded-full" onClick={() => setViewer(undefined)}>
          Back to Galleries
        </Button>
      ) : null}
    </div>
  )
}
