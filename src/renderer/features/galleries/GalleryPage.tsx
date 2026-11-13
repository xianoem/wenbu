import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowCounterClockwiseIcon,
  BookOpenIcon,
  CaretLeftIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  UserIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { GalleryPage as Page, GalleryVersion, OpenedGallery } from '#contract/Galleries'
import { formatMoment } from '#lib/format'
import { galleryFolderAtom, openGalleryAtom, viewerAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Thumbnail } from './components/Thumbnail'
import { VirtualGrid } from './components/VirtualGrid'
import { galleryAtom, monthDay, nameOf, useFreshAtom } from './galleries'

const tagsShown = 8

const versions: ReadonlyArray<{ readonly id: GalleryVersion; readonly label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'translated', label: 'Translated' },
]

const firstVersion = (gallery: OpenedGallery): GalleryVersion => {
  if (gallery.reading !== null) {
    return gallery.reading.version
  }

  return gallery.translated.length > 0 ? 'translated' : 'original'
}

const coverVersionOf = (gallery: OpenedGallery) =>
  [...gallery.translated, ...gallery.original].find((page) => page.file === gallery.cover)
    ?.modifiedMs ?? 0

const pagesOf = (gallery: OpenedGallery, version: GalleryVersion) =>
  version === 'translated' ? gallery.translated : gallery.original

function Chip({
  children,
  dim = false,
  onClick,
}: {
  readonly children: React.ReactNode
  readonly dim?: boolean
  readonly onClick?: () => void
}) {
  const className = cn(
    'inline-flex h-6 items-center gap-[5px] rounded-full bg-secondary px-2.5 text-xs font-normal whitespace-nowrap [&_svg]:size-3.5',
    dim ? 'text-muted-foreground' : 'text-foreground',
  )

  if (onClick === undefined) {
    return <span className={className}>{children}</span>
  }

  return (
    <Button variant="secondary" className={className} onClick={onClick}>
      {children}
    </Button>
  )
}

function Stat({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-muted/50 px-[18px] py-3.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-0.5 text-xl font-semibold tracking-tight">{children}</div>
    </div>
  )
}

function VersionSwitch({
  version,
  onChange,
}: {
  readonly version: GalleryVersion
  readonly onChange: (version: GalleryVersion) => void
}) {
  return (
    <div className="inline-flex rounded-full bg-muted/60 p-[3px]">
      {versions.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          aria-pressed={version === option.id}
          className={cn(
            'h-7 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
            version === option.id && 'bg-background font-medium text-foreground shadow-card',
          )}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

function Tags({ tags }: { readonly tags: ReadonlyArray<string> }) {
  const [all, setAll] = useState(false)
  const shown = all ? tags : tags.slice(0, tagsShown)

  if (tags.length === 0) {
    return null
  }

  return (
    <div className="mt-[18px] flex flex-wrap gap-1.5">
      {shown.map((tag) => (
        <Chip key={tag}>{tag}</Chip>
      ))}
      {tags.length > tagsShown ? (
        <Chip dim onClick={() => setAll(!all)}>
          {all ? 'Fewer tags' : `+${tags.length - tagsShown} tags`}
        </Chip>
      ) : null}
    </div>
  )
}

function PageTile({
  page,
  number,
  onOpen,
}: {
  readonly page: Page
  readonly number: number
  readonly onOpen: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={`Read from page ${number}`}
      className="relative block aspect-[0.7] h-auto w-full overflow-hidden rounded-xl p-0 ring-1 ring-foreground/5"
      onClick={onOpen}
    >
      <Thumbnail file={page.file} version={page.modifiedMs} className="absolute inset-0" />
      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-[7px] py-px text-[11px] text-white">
        {number}
      </span>
    </Button>
  )
}

const readLabel = (gallery: OpenedGallery, pages: number) => {
  if (gallery.reading === null) {
    return 'Not started'
  }

  return `${Math.round(((gallery.reading.page + 1) / Math.max(1, pages)) * 100)}%`
}

function Details({ gallery }: { readonly gallery: OpenedGallery }) {
  const folder = useAtomValue(galleryFolderAtom)
  const setOpenGallery = useAtomSet(openGalleryAtom)
  const setViewer = useAtomSet(viewerAtom)
  const [version, setVersion] = useState(() => firstVersion(gallery))
  const pages = pagesOf(gallery, version)
  const both = gallery.original.length > 0 && gallery.translated.length > 0
  const added = DateTime.makeUnsafe(gallery.addedAt)

  const read = (page: number, readVersion: GalleryVersion) =>
    setViewer({ folder: gallery.folder, page, version: readVersion })

  return (
    <div className="relative flex flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-7 left-1/2 h-[250px] w-screen -translate-x-1/2 overflow-hidden"
      >
        {gallery.cover === null ? null : (
          <div className="absolute -inset-10 opacity-75 blur-[38px] saturate-[1.2]">
            <Thumbnail
              file={gallery.cover}
              version={coverVersionOf(gallery)}
              className="size-full bg-transparent"
            />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-b from-transparent from-20% to-background" />
      </div>

      <Button
        variant="ghost"
        className="relative -mt-1.5 -ml-2 h-7 w-fit gap-1.5 rounded-full px-2 text-[13px] font-normal"
        onClick={() => setOpenGallery(undefined)}
      >
        <CaretLeftIcon />
        {folder === undefined ? 'Galleries' : nameOf(folder)}
      </Button>

      <div className="relative mt-2 flex items-end gap-6">
        <div className="relative aspect-[3/4.2] w-40 shrink-0 overflow-hidden rounded-[20px] shadow-card">
          {gallery.cover === null ? null : (
            <Thumbnail
              file={gallery.cover}
              version={coverVersionOf(gallery)}
              className="absolute inset-0"
            />
          )}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="flex flex-wrap gap-2">
            {gallery.source === null ? null : (
              <Chip dim>
                <DownloadSimpleIcon />
                {gallery.source}
              </Chip>
            )}
            {gallery.artists.map((artist) => (
              <Chip key={artist} dim>
                <UserIcon />
                {artist}
              </Chip>
            ))}
          </div>
          <h1 className="mt-2.5 text-[28px] leading-tight font-semibold tracking-tight">
            {gallery.title}
          </h1>
          {gallery.titleJapanese === null ? null : (
            <p className="mt-0.5 text-muted-foreground">{gallery.titleJapanese}</p>
          )}
          <div className="mt-[18px] flex gap-2">
            <Button
              className="h-9 gap-2 rounded-full px-4"
              onClick={() =>
                read(gallery.reading?.page ?? 0, gallery.reading?.version ?? firstVersion(gallery))
              }
            >
              <BookOpenIcon />
              {gallery.reading === null
                ? 'Read'
                : `Continue reading · p. ${gallery.reading.page + 1}`}
            </Button>
            {gallery.reading === null ? null : (
              <Button
                variant="secondary"
                className="h-9 gap-2 rounded-full px-4"
                onClick={() => read(0, version)}
              >
                <ArrowCounterClockwiseIcon />
                Read from start
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon"
              aria-label="Show in folder"
              className="size-9 rounded-full"
              onClick={() => window.wenbu.revealPath(gallery.folder)}
            >
              <FolderOpenIcon />
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3.5">
        <Stat label="Pages">{pages.length}</Stat>
        <Stat label="Read">
          {readLabel(gallery, pagesOf(gallery, gallery.reading?.version ?? version).length)}
          {gallery.reading === null ? null : (
            <span className="text-[13px] font-normal text-muted-foreground">
              {' '}
              · {formatMoment(gallery.reading.readAt).toLowerCase()}
            </span>
          )}
        </Stat>
        <Stat label={gallery.downloaded ? 'Downloaded' : 'Added'}>
          {monthDay(gallery.addedAt)}{' '}
          <span className="text-[13px] font-normal text-muted-foreground">
            {DateTime.getPartUtc(added, 'year')}
          </span>
        </Stat>
      </div>

      <Tags tags={gallery.tags} />

      <div className="mt-[26px] flex items-center">
        <h2 className="flex-1 text-[13px] font-medium text-muted-foreground">Pages</h2>
        {both ? <VersionSwitch version={version} onChange={setVersion} /> : null}
      </div>

      <div className="mt-3.5">
        <VirtualGrid
          items={pages}
          minWidth={118}
          gap={14}
          rowGap={14}
          estimateRow={(width) => width / 0.7}
          keyOf={(page) => page.name}
        >
          {(page, index) => (
            <PageTile page={page} number={index + 1} onOpen={() => read(index, version)} />
          )}
        </VirtualGrid>
      </div>
    </div>
  )
}

export function GalleryPage({ folder }: { readonly folder: string }) {
  const result = useFreshAtom(galleryAtom(folder))
  const setOpenGallery = useAtomSet(openGalleryAtom)

  if (AsyncResult.isSuccess(result)) {
    return <Details key={result.value.folder} gallery={result.value} />
  }

  if (AsyncResult.isFailure(result)) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-2.5 text-center">
        <WarningCircleIcon className="size-6 text-muted-foreground" />
        <p className="text-muted-foreground">This gallery is no longer in Galleries.</p>
        <Button
          variant="secondary"
          className="rounded-full"
          onClick={() => setOpenGallery(undefined)}
        >
          Back to Galleries
        </Button>
      </div>
    )
  }

  return <p className="text-muted-foreground">Opening {nameOf(folder)}…</p>
}
