import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowSquareOutIcon,
  BellIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  StarIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { type ReactNode, useState } from 'react'
import type { DLsiteWorkPage as WorkPage, ListedWork } from '#contract/Details'
import { formatBytes } from '#lib/format'
import { gameIdAtom, openWorkAtom, screenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Dialog, DialogContent, DialogTitle } from '#ui/dialog'
import { ScrollArea } from '#ui/scroll-area'
import { Skeleton } from '#ui/skeleton'
import { JapanVpnNote } from './components/JapanVpnNote'
import {
  circleWorksAtom,
  detailsErrorOf,
  dlsiteListKeys,
  dlsiteWorkAtom,
  formatExpected,
  formatReleaseDate,
  formatYen,
  watchWorkAtom,
  workTypeLabel,
} from './details'

const shownThumbnails = 6

const moreLimit = 4

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

const imagesOf = (page: WorkPage): ReadonlyArray<string> => {
  if (page.samples.length > 0) {
    return page.samples
  }

  return page.coverUrl === null ? [] : [page.coverUrl]
}

function Screenshots({ page }: { readonly page: WorkPage }) {
  const images = imagesOf(page)

  const [index, setIndex] = useState(0)
  const shown = images[index]
  const step = (by: number) => setIndex((index + by + images.length) % images.length)

  if (shown === undefined) {
    return <div className="h-[300px] rounded-[22px] bg-muted" />
  }

  return (
    <div className="relative h-[300px] overflow-hidden rounded-[22px] bg-black shadow-card">
      <img src={shown} alt="" className="size-full object-contain" />
      {images.length > 1 ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous screenshot"
            className="absolute top-1/2 left-3.5 -translate-y-1/2 rounded-full bg-black/35 text-white hover:bg-black/55 hover:text-white"
            onClick={() => step(-1)}
          >
            <CaretLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next screenshot"
            className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded-full bg-black/35 text-white hover:bg-black/55 hover:text-white"
            onClick={() => step(1)}
          >
            <CaretRightIcon />
          </Button>
          <div className="absolute right-3.5 bottom-3.5 flex gap-1.5">
            {images.slice(0, shownThumbnails).map((image, at) => (
              <Button
                key={image}
                variant="ghost"
                aria-label={`Screenshot ${at + 1}`}
                aria-pressed={at === index}
                className={cn(
                  'aspect-4/3 h-auto w-[72px] overflow-hidden rounded-lg p-0 opacity-75 hover:opacity-100',
                  at === index && 'opacity-100 ring-2 ring-white',
                )}
                onClick={() => setIndex(at)}
              >
                <img src={image} alt="" className="size-full object-cover" />
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PriceCard({ page }: { readonly page: WorkPage }) {
  const watch = useAtomSet(watchWorkAtom, { mode: 'promiseExit' })
  const [copied, setCopied] = useState(false)
  const onSale = page.discountRate !== null && page.officialPrice !== null

  const copy = async () => {
    await navigator.clipboard.writeText(page.url)
    setCopied(true)
  }

  return (
    <section className="rounded-[20px] bg-card px-[18px] py-4 shadow-card">
      {page.announced ? (
        <div>
          <div className="text-lg font-semibold">
            Coming {page.expected === null ? 'soon' : formatExpected(page.expected)}
          </div>
          <div className="text-xs text-muted-foreground">Announced on DLsite</div>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">
              {page.price === null ? '—' : formatYen(page.price)}
            </span>
            {onSale && page.officialPrice !== null ? (
              <span className="text-sm text-muted-foreground line-through">
                {formatYen(page.officialPrice)}
              </span>
            ) : null}
          </div>
          {onSale ? (
            <div className="text-xs text-warning">
              {page.discountRate}% off
              {page.saleEndsOn === null ? '' : ` until ${formatReleaseDate(page.saleEndsOn)}`}
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <Button className="rounded-full" onClick={() => window.wenbu.openExternal(page.url)}>
          <ArrowSquareOutIcon />
          {page.announced ? 'Open on DLsite' : 'Buy on DLsite'}
        </Button>
        {page.announced ? (
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={() =>
              void watch({
                payload: { code: page.code, watched: !page.watched },
                reactivityKeys: dlsiteListKeys,
              })
            }
          >
            <BellIcon weight={page.watched ? 'fill' : 'regular'} />
            {page.watched ? 'Watching' : 'Watch'}
          </Button>
        ) : (
          <Button variant="secondary" className="rounded-full" onClick={() => void copy()}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy DLsite link'}
          </Button>
        )}
      </div>
    </section>
  )
}

function MoreFromCircle({ page }: { readonly page: WorkPage }) {
  const result = useAtomValue(circleWorksAtom(page.circleId))
  const setOpenWork = useAtomSet(openWorkAtom)
  const setGameId = useAtomSet(gameIdAtom)
  const setScreen = useAtomSet(screenAtom)

  if (page.circleId === '' || !AsyncResult.isSuccess(result)) {
    return null
  }

  const others = result.value.filter((work) => work.code !== page.code)
  const owned = others.filter((work) => work.gameId !== null).length

  if (others.length === 0) {
    return null
  }

  const open = (work: ListedWork) => {
    if (work.gameId === null) {
      return setOpenWork(work.code)
    }

    setOpenWork(undefined)
    setGameId(work.gameId)
    setScreen('library')
  }

  return (
    <section className="mt-5">
      <div className="flex items-center">
        <h2 className="flex-1 text-[13px] font-medium text-muted-foreground">
          More from {page.circle}
        </h2>
        {owned === 0 ? null : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckIcon />
            {owned} in your Library
          </span>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-3">
        {others.slice(0, moreLimit).map((work) => (
          <Button
            key={work.code}
            variant="ghost"
            className="h-auto min-w-0 flex-col items-stretch gap-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent"
            onClick={() => open(work)}
          >
            <span className="relative block aspect-4/3 overflow-hidden rounded-[10px] bg-muted">
              {work.coverUrl === null ? null : (
                <img src={work.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
              )}
              {work.gameId === null ? null : (
                <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-success text-black">
                  <CheckIcon className="size-3" />
                </span>
              )}
            </span>
            <span className="mt-1.5 truncate text-xs font-semibold">{work.title}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

function Loaded({ page }: { readonly page: WorkPage }) {
  const facts = [
    page.circle,
    page.releasedOn === null ? undefined : formatReleaseDate(page.releasedOn),
  ].filter(Boolean)

  const roles = page.roles.filter((role) => role.role !== 'Created by')

  return (
    <>
      <Screenshots page={page} />
      {page.restricted ? (
        <JapanVpnNote className="mt-4">
          DLsite shows only part of this game outside Japan. Set your VPN to Japan for its price,
          genres, release date and screenshots.
        </JapanVpnNote>
      ) : null}
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_270px] gap-[26px]">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{page.title}</h1>
          <p className="mt-1 text-muted-foreground">{facts.join(' · ')}</p>
          {page.description === '' ? null : (
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-foreground/90">
              {page.description}
            </p>
          )}
          {page.genres.length === 0 ? null : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {page.genres.map((genre) => (
                <span key={genre.id} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                  {genre.name}
                </span>
              ))}
            </div>
          )}
          <MoreFromCircle page={page} />
        </div>
        <div className="flex flex-col gap-3">
          <PriceCard page={page} />
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2 px-1 text-[13px]">
            {page.rating === null ? null : (
              <Fact label="Rating">
                <span className="inline-flex items-center gap-1">
                  <StarIcon weight="fill" className="size-3.5" />
                  {page.rating.toFixed(2)}
                  {page.ratingCount === null ? null : (
                    <span className="text-muted-foreground">
                      · {page.ratingCount.toLocaleString('en-US')}
                    </span>
                  )}
                </span>
              </Fact>
            )}
            {page.sold === null ? null : (
              <Fact label="Sold">{page.sold.toLocaleString('en-US')}</Fact>
            )}
            {page.wishlist === null ? null : (
              <Fact label="Wishlists">{page.wishlist.toLocaleString('en-US')}</Fact>
            )}
            {page.workType === '' ? null : (
              <Fact label="Type">
                {[
                  workTypeLabel(page.workType),
                  page.fileSize === null ? undefined : formatBytes(page.fileSize),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Fact>
            )}
            {page.languages.length === 0 ? null : (
              <Fact label="Language">{page.languages.join(', ')}</Fact>
            )}
            {roles.map((role) => (
              <Fact key={role.role} label={role.role}>
                {role.names.join(', ')}
              </Fact>
            ))}
          </dl>
        </div>
      </div>
    </>
  )
}

function LoadingWork() {
  return (
    <div aria-label="Loading the work" aria-busy>
      <Skeleton className="h-[300px] rounded-[22px]" />
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_270px] gap-[26px]">
        <div className="flex min-w-0 flex-col">
          <Skeleton className="h-8 w-3/5 rounded-lg" />
          <Skeleton className="mt-2.5 h-4 w-1/4" />
          <Skeleton className="mt-4 h-3.5 w-full" />
          <Skeleton className="mt-2 h-3.5 w-11/12" />
          <Skeleton className="mt-2 h-3.5 w-2/3" />
          <div className="mt-4 flex gap-1.5">
            {[64, 88, 72, 96, 60].map((width) => (
              <Skeleton key={width} className="h-5 rounded-full" style={{ width }} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[148px] rounded-[20px]" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}

function Work({ code }: { readonly code: string }) {
  const result = useAtomValue(dlsiteWorkAtom(code))

  return (
    <>
      {AsyncResult.isSuccess(result) ? <Loaded page={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-sm text-destructive">
          {detailsErrorOf(result.cause)?.message ?? 'DLsite could not be reached.'}
        </p>
      ) : null}
      {AsyncResult.isInitial(result) ? <LoadingWork /> : null}
    </>
  )
}

export function DLsiteWorkDialog() {
  const code = useAtomValue(openWorkAtom)
  const setOpenWork = useAtomSet(openWorkAtom)

  return (
    <Dialog
      open={code !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setOpenWork(undefined)
        }
      }}
    >
      <DialogContent className="flex h-[calc(100%-4rem)] max-w-[min(1400px,calc(100%-4rem))] flex-col gap-0 overflow-hidden rounded-[26px] bg-background p-0 sm:max-w-[min(1400px,calc(100%-4rem))]">
        <DialogTitle className="sr-only">DLsite work {code}</DialogTitle>
        <div className="flex h-12 shrink-0 items-center px-6">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-info" />
            {code}
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 pb-6">
            {code === undefined ? null : <Work key={code} code={code} />}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
