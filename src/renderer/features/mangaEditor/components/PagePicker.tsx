import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useState } from 'react'
import type { EditorPage } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { useCoreCall } from '#lib/rpc'
import { imageKey } from '../mangaEditor'
import { pageThumbnailUrl } from '#contract/PageImage'
import { type FindImage, pageFile } from './pageImages'

export const pageDot = (page: EditorPage) => {
  if (page.done.includes('letter')) {
    return 'bg-success'
  }

  return page.done.length > 0 ? 'bg-warning' : 'bg-muted-foreground/30'
}

// The system thumbnail: decoding every whole page here froze the picker.
function Thumbnail({
  folder,
  page,
  number,
  active,
  find,
  onPick,
}: {
  readonly folder: string
  readonly page: EditorPage
  readonly number: number
  readonly active: boolean
  readonly find: FindImage
  readonly onPick: () => void
}) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let gone = false

    pageFile(find, imageKey(folder, page.name, 'original', 0)).then(
      (file) => {
        if (!gone) {
          setUrl(pageThumbnailUrl(file))
        }
      },
      () => undefined,
    )

    return () => {
      gone = true
    }
  }, [find, folder, page.name])

  return (
    <Button
      variant="ghost"
      aria-label={`Page ${number}`}
      title={page.name}
      data-active-page={active ? 'true' : undefined}
      onClick={onPick}
      className="flex h-auto min-w-0 flex-col items-start gap-1.5 rounded-none p-0 text-left hover:bg-transparent"
    >
      <span
        className={cn(
          'relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10',
          active && 'ring-2 ring-primary',
        )}
      >
        {url === undefined ? null : (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        )}
      </span>
      <span className="flex items-center gap-1.5 pl-px">
        <span className={cn('size-1.5 shrink-0 rounded-full', pageDot(page))} />
        <span
          className={cn(
            'font-mono text-[11px] text-muted-foreground',
            active && 'font-semibold text-foreground',
          )}
        >
          {number}
        </span>
      </span>
    </Button>
  )
}

export function PagePicker({
  folder,
  pages,
  index,
  onPage,
}: {
  readonly folder: string
  readonly pages: ReadonlyArray<EditorPage>
  readonly index: number
  readonly onPage: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const call = useCoreCall()

  const find: FindImage = ({ payload }) => call((client) => client('findMangaEditorImage', payload))
  const trimmed = query.trim().toLowerCase()

  const shown = pages
    .map((page, at) => ({ page, at }))
    .filter(
      ({ page, at }) =>
        trimmed === '' ||
        String(at + 1).includes(trimmed) ||
        page.name.toLowerCase().includes(trimmed),
    )

  const pick = (at: number) => {
    onPage(at)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }

    const number = Number.parseInt(query, 10)

    if (Number.isInteger(number) && number >= 1 && number <= pages.length) {
      pick(number - 1)

      return
    }

    const only = shown.length === 1 ? shown[0] : undefined

    if (only !== undefined) {
      pick(only.at)
    }
  }

  return (
    <div className="flex h-7 items-center gap-0.5 rounded-full bg-muted/50 px-0.5 ring-1 ring-foreground/8">
      <Button
        size="icon-xs"
        variant="ghost"
        className="rounded-full text-muted-foreground"
        aria-label="Previous page"
        disabled={index === 0}
        onClick={() => onPage(index - 1)}
      >
        <CaretLeftIcon />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              aria-label="All pages"
              className={cn(
                'h-6 min-w-16 rounded-full px-2 font-mono text-[13px] font-semibold tabular-nums',
                open && 'bg-muted',
              )}
            >
              {index + 1}
              <span className="px-1 text-muted-foreground">/</span>
              <span className="text-muted-foreground">{pages.length}</span>
            </Button>
          }
        />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-85 gap-0 overflow-hidden rounded-[18px] p-0"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Go to page…"
              aria-label="Go to page"
              className="h-7 flex-1 rounded-full border-0 bg-muted/60 px-2.5 text-[12px] shadow-none focus-visible:ring-0 md:text-[12px]"
            />
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {index + 1} / {pages.length}
            </span>
          </div>
          <div className="no-scrollbar h-85 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-muted-foreground">No pages match.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2.5 p-3 pb-6">
                {shown.map(({ page, at }) => (
                  <Thumbnail
                    key={page.name}
                    folder={folder}
                    page={page}
                    number={at + 1}
                    active={at === index}
                    find={find}
                    onPick={() => pick(at)}
                  />
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        size="icon-xs"
        variant="ghost"
        className="rounded-full text-muted-foreground"
        aria-label="Next page"
        disabled={index >= pages.length - 1}
        onClick={() => onPage(index + 1)}
      >
        <CaretRightIcon />
      </Button>
    </div>
  )
}
