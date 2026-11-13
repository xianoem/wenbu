import { FolderSimpleIcon, TranslateIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { FolderTile as Folder, GalleryTile as Gallery } from '#contract/Galleries'
import { Button } from '#ui/button'
import { plural, progressOf, shortDate, shownPages, versionBadge } from '../galleries'
import { Thumbnail } from './Thumbnail'

const coverShape = 'aspect-[3/4.2] rounded-[18px] shadow-card'

function ReadBar({ progress }: { readonly progress: number }) {
  if (progress === 0) {
    return null
  }

  return (
    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/35">
      <span className="block h-full bg-primary" style={{ width: `${progress * 100}%` }} />
    </span>
  )
}

function VersionBadge({ gallery }: { readonly gallery: Gallery }) {
  const badge = versionBadge(gallery)

  if (badge === undefined) {
    return null
  }

  return (
    <span className="absolute right-2 bottom-2 inline-flex h-[22px] items-center gap-1 rounded-full bg-black/50 px-2 text-[11px] font-medium text-white backdrop-blur-md">
      <TranslateIcon className="size-3" />
      {badge}
    </span>
  )
}

const tileButton =
  'h-auto w-full flex-col items-stretch gap-0 rounded-[18px] p-0 text-left font-normal whitespace-normal hover:bg-transparent'

export function GalleryTile({
  gallery,
  onOpen,
}: {
  readonly gallery: Gallery
  readonly onOpen: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={`Open ${gallery.title}`}
      className={tileButton}
      onClick={onOpen}
    >
      <span className={cn('relative block overflow-hidden', coverShape)}>
        {gallery.cover === null ? null : (
          <Thumbnail
            file={gallery.cover}
            version={gallery.coverVersion}
            className="absolute inset-0"
          />
        )}
        <VersionBadge gallery={gallery} />
        <ReadBar progress={progressOf(gallery)} />
      </span>
      <span className="mt-2.5 line-clamp-2 leading-snug font-semibold">{gallery.title}</span>
      <span className="mt-[3px] truncate text-xs text-muted-foreground">
        {gallery.artists.length === 0 ? 'No details' : gallery.artists.join(', ')}
      </span>
      <span className="mt-px truncate text-xs text-muted-foreground">
        {plural(shownPages(gallery), 'page')} · Added {shortDate(gallery.addedAt)}
      </span>
    </Button>
  )
}

const sheetPlaces = [
  'left-[10%] top-[17%] -rotate-[8deg]',
  'left-[28%] top-[15%] rotate-[7deg]',
  'left-[19%] top-[11%]',
]

export function FolderTile({
  folder,
  onOpen,
}: {
  readonly folder: Folder
  readonly onOpen: () => void
}) {
  const sheets = folder.covers.slice(0, 3).toReversed()

  return (
    <Button
      variant="ghost"
      aria-label={`Open ${folder.title}`}
      className={tileButton}
      onClick={onOpen}
    >
      <span className="relative block aspect-[3/4.2] rounded-[18px] bg-muted/50 ring-1 ring-foreground/5 ring-inset">
        {sheets.map((cover, at) => (
          <Thumbnail
            key={cover}
            file={cover}
            version={0}
            className={cn(
              'absolute aspect-[3/4.2] w-[62%] rounded-[10px] shadow-[0_6px_16px_rgb(0_0_0/0.45)]',
              sheetPlaces[at + 3 - sheets.length],
            )}
          />
        ))}
      </span>
      <span className="mt-2.5 line-clamp-2 leading-snug font-semibold">{folder.title}</span>
      <span className="mt-[3px] flex items-center gap-1 truncate text-xs text-muted-foreground">
        <FolderSimpleIcon className="size-3" />
        {plural(folder.galleries, 'gallery', 'galleries')}
      </span>
      <span className="mt-px truncate text-xs text-muted-foreground">
        Added {shortDate(folder.addedAt)}
      </span>
    </Button>
  )
}

export function ContinueCard({
  gallery,
  onOpen,
}: {
  readonly gallery: Gallery
  readonly onOpen: () => void
}) {
  const page = (gallery.reading?.page ?? 0) + 1

  const pages =
    gallery.reading?.version === 'original' ? gallery.originalPages : shownPages(gallery)

  return (
    <Button
      variant="ghost"
      aria-label={`Continue ${gallery.title}`}
      className="h-auto min-w-0 justify-start gap-3.5 rounded-3xl bg-card p-3 text-left font-normal shadow-card hover:bg-card"
      onClick={onOpen}
    >
      <span className="relative block aspect-[3/4.2] w-14 shrink-0 overflow-hidden rounded-xl">
        {gallery.cover === null ? null : (
          <Thumbnail
            file={gallery.cover}
            version={gallery.coverVersion}
            className="absolute inset-0"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{gallery.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Page {page} of {pages}
        </span>
        <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${progressOf(gallery) * 100}%` }}
          />
        </span>
      </span>
    </Button>
  )
}
