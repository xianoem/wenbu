import { useAtom, useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  CaretDownIcon,
  CaretLeftIcon,
  CheckIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FunnelSimpleIcon,
  type Icon,
  ImagesSquareIcon,
  MagnifyingGlassIcon,
  SortDescendingIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useDeferredValue, useLayoutEffect, useRef, useState } from 'react'
import type {
  EntryListing,
  GalleryEntry,
  GalleryFilter,
  GallerySort,
  ListEntries,
} from '#contract/Galleries'
import { formErrorOf } from '#lib/forms'
import { galleryFolderAtom, gallerySortAtom, openGalleryAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { ContinueCard, FolderTile, GalleryTile } from './components/EntryTiles'
import { VirtualGrid } from './components/VirtualGrid'
import { GalleryPage } from './GalleryPage'
import {
  addRootAtom,
  continueReadingAtom,
  indexChangesAtom,
  listingAtom,
  nameOf,
  plural,
  removeRootAtom,
  rootsAtom,
  useFreshAtom,
} from './galleries'

const filters: ReadonlyArray<{ readonly id: GalleryFilter; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'translated', label: 'Translated' },
  { id: 'unread', label: 'Unread' },
]

const sorts: ReadonlyArray<{ readonly id: GallerySort; readonly label: string }> = [
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'Title' },
  { id: 'read', label: 'Recently read' },
]

const tileRow = (columnWidth: number) => columnWidth * 1.4 + 90

function useListing(request: ListEntries) {
  const result = useFreshAtom(listingAtom(request))
  const [last, setLast] = useState<EntryListing | undefined>(undefined)
  const current = AsyncResult.isSuccess(result) ? result.value : undefined

  if (current !== undefined && current !== last) {
    setLast(current)
  }

  return current ?? last
}

function SearchField({
  value,
  placeholder,
  onChange,
}: {
  readonly value: string
  readonly placeholder: string
  readonly onChange: (value: string) => void
}) {
  return (
    <InputGroup className="h-9 w-56 rounded-full">
      <InputGroupAddon>
        <MagnifyingGlassIcon />
      </InputGroupAddon>
      <InputGroupInput
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </InputGroup>
  )
}

function FoldersMenu({ onError }: { readonly onError: (message: string | undefined) => void }) {
  const roots = useAtomValue(rootsAtom)
  const add = useAtomSet(addRootAtom, { mode: 'promiseExit' })
  const remove = useAtomSet(removeRootAtom, { mode: 'promiseExit' })
  const added = AsyncResult.isSuccess(roots) ? roots.value.filter((root) => !root.downloads) : []

  const addFolder = async () => {
    const folder = await window.wenbu.chooseFolder()

    if (folder === undefined) {
      return
    }

    const exit = await add({ payload: { path: folder }, reactivityKeys: ['galleries'] })

    onError(formErrorOf(exit)?.message)
  }

  const removeFolder = async (path: string) => {
    const exit = await remove({ payload: { path }, reactivityKeys: ['galleries'] })

    onError(formErrorOf(exit)?.message)
  }

  return (
    <div className="flex">
      <Button
        variant="secondary"
        className={cn('h-9 gap-2 rounded-full px-4', added.length > 0 && 'rounded-r-none pr-3')}
        onClick={() => void addFolder()}
      >
        <FolderPlusIcon />
        Add folder
      </Button>
      {added.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="secondary"
                aria-label="Folders Galleries reads"
                className="h-9 rounded-l-none border-l border-background/60 pr-3 pl-2"
              >
                <CaretDownIcon className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-72">
            <DropdownMenuLabel>Added folders</DropdownMenuLabel>
            {added.map((root) => (
              <DropdownMenuItem key={root.path} onClick={() => void removeFolder(root.path)}>
                <TrashIcon />
                <span className="truncate">Remove {root.path}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function MenuTrigger({ Icon, label }: { readonly Icon: Icon; readonly label: string }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-[13px] font-normal text-muted-foreground"
        />
      }
    >
      <Icon />
      {label}
      <CaretDownIcon className="size-3" />
    </DropdownMenuTrigger>
  )
}

function FilterRow({
  listing,
  filter,
  source,
  onFilter,
  onSource,
}: {
  readonly listing: EntryListing | undefined
  readonly filter: GalleryFilter
  readonly source: string | undefined
  readonly onFilter: (filter: GalleryFilter) => void
  readonly onSource: (source: string | undefined) => void
}) {
  const [sort, setSort] = useAtom(gallerySortAtom)
  const sortLabel = sorts.find((option) => option.id === sort)?.label ?? 'Recently added'

  return (
    <div className="mt-7 flex flex-wrap items-center gap-1.5">
      {filters.map(({ id, label }) => (
        <Button
          key={id}
          variant={filter === id ? 'default' : 'secondary'}
          aria-pressed={filter === id}
          className="h-7 rounded-full px-3 text-[13px] font-normal"
          onClick={() => onFilter(id)}
        >
          {label} <span className="opacity-60">{listing?.counts[id] ?? 0}</span>
        </Button>
      ))}
      <span className="flex-1" />
      {listing === undefined || listing.sources.length === 0 ? null : (
        <DropdownMenu>
          <MenuTrigger Icon={FunnelSimpleIcon} label={`Source: ${source ?? 'All'}`} />
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={source ?? ''}
              onValueChange={(value: string) => onSource(value === '' ? undefined : value)}
            >
              <DropdownMenuRadioItem value="">All sources</DropdownMenuRadioItem>
              {listing.sources.map((name) => (
                <DropdownMenuRadioItem key={name} value={name}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <MenuTrigger Icon={SortDescendingIcon} label={sortLabel} />
        <DropdownMenuContent align="end">
          {sorts.map((option) => (
            <DropdownMenuItem key={option.id} onClick={() => setSort(option.id)}>
              <CheckIcon className={cn(sort !== option.id && 'invisible')} />
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ContinueReading() {
  const result = useFreshAtom(continueReadingAtom)
  const setOpenGallery = useAtomSet(openGalleryAtom)
  const galleries = AsyncResult.isSuccess(result) ? result.value : []

  if (galleries.length === 0) {
    return null
  }

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-medium text-muted-foreground">Continue reading</h2>
      <div className="mt-2.5 grid grid-cols-3 gap-4">
        {galleries.map((gallery) => (
          <ContinueCard
            key={gallery.folder}
            gallery={gallery}
            onOpen={() => setOpenGallery(gallery.folder)}
          />
        ))}
      </div>
    </section>
  )
}

function Entries({ entries }: { readonly entries: ReadonlyArray<GalleryEntry> }) {
  const setFolder = useAtomSet(galleryFolderAtom)
  const setOpenGallery = useAtomSet(openGalleryAtom)

  return (
    <VirtualGrid
      items={entries}
      minWidth={170}
      gap={20}
      rowGap={28}
      estimateRow={tileRow}
      keyOf={(entry) => entry.folder}
    >
      {(entry) =>
        entry.kind === 'folder' ? (
          <FolderTile folder={entry} onOpen={() => setFolder(entry.folder)} />
        ) : (
          <GalleryTile gallery={entry} onOpen={() => setOpenGallery(entry.folder)} />
        )
      }
    </VirtualGrid>
  )
}

function EmptyShelf({ searching }: { readonly searching: boolean }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-2.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <ImagesSquareIcon className="size-6" />
      </div>
      <p className="mt-1 text-base font-semibold">
        {searching ? 'No galleries match' : 'No galleries yet'}
      </p>
      <p className="max-w-sm text-muted-foreground">
        {searching
          ? 'Try other words, or another filter.'
          : 'Galleries reads your Downloads folder and the folders you add. A gallery is a folder of pages.'}
      </p>
    </div>
  )
}

function Shelf({ folder }: { readonly folder: string | undefined }) {
  const sort = useAtomValue(gallerySortAtom)
  const setFolder = useAtomSet(galleryFolderAtom)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<GalleryFilter>('all')
  const [source, setSource] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const search = useDeferredValue(query)

  const request: ListEntries = {
    filter,
    sort,
    search,
    ...(folder === undefined ? {} : { folder }),
    ...(source === undefined ? {} : { source }),
  }

  const listing = useListing(request)
  const header = listing?.header ?? null
  const narrowed = search.trim() !== '' || filter !== 'all' || source !== undefined

  return (
    <div className="flex flex-col">
      {folder === undefined ? null : (
        <Button
          variant="ghost"
          className="-ml-2 h-7 w-fit gap-1.5 rounded-full px-2 text-[13px] font-normal text-muted-foreground"
          onClick={() => setFolder(header?.parent ?? undefined)}
        >
          <CaretLeftIcon />
          {header?.parent === null || header === null ? 'Galleries' : nameOf(header.parent)}
        </Button>
      )}

      <div className={cn('flex items-center gap-2.5', folder !== undefined && 'mt-1.5')}>
        <h1 className="min-w-0 flex-1 truncate text-[28px] font-semibold tracking-tight">
          {folder === undefined ? 'Galleries' : (header?.title ?? nameOf(folder))}
        </h1>
        <SearchField
          value={query}
          placeholder={
            folder === undefined ? 'Search titles, artists, tags' : 'Search in this folder'
          }
          onChange={setQuery}
        />
        {folder === undefined ? (
          <FoldersMenu onError={setError} />
        ) : (
          <Button
            variant="secondary"
            size="icon"
            aria-label="Show in folder"
            className="size-9 rounded-full"
            onClick={() => window.wenbu.revealPath(folder)}
          >
            <FolderOpenIcon />
          </Button>
        )}
      </div>

      {header === null ? null : (
        <p className="mt-1 text-muted-foreground">
          {[
            header.galleries > 0 ? plural(header.galleries, 'gallery', 'galleries') : undefined,
            header.folders > 0 ? plural(header.folders, 'folder') : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(' and ')}{' '}
          · {plural(header.pages, 'page')}
        </p>
      )}

      {error === undefined ? null : (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
          <WarningCircleIcon />
          {error}
        </p>
      )}

      {folder === undefined ? (
        <>
          {narrowed ? null : <ContinueReading />}
          <FilterRow
            listing={listing}
            filter={filter}
            source={source}
            onFilter={setFilter}
            onSource={setSource}
          />
        </>
      ) : null}

      <div className={folder === undefined ? 'mt-[18px]' : 'mt-7'}>
        {listing !== undefined && listing.entries.length === 0 ? (
          <EmptyShelf searching={narrowed} />
        ) : (
          <Entries entries={listing?.entries ?? []} />
        )}
      </div>
    </div>
  )
}

const scrolledTo = new Map<string, number>()

function useScrollMemory(view: string) {
  const anchor = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const main = anchor.current?.closest('main')

    if (main === null || main === undefined) {
      return
    }

    main.scrollTop = scrolledTo.get(view) ?? 0

    const remember = () => scrolledTo.set(view, main.scrollTop)

    main.addEventListener('scroll', remember, { passive: true })

    return () => main.removeEventListener('scroll', remember)
  }, [view])

  return anchor
}

export function GalleriesPage() {
  useAtomMount(indexChangesAtom)

  const openGallery = useAtomValue(openGalleryAtom)
  const folder = useAtomValue(galleryFolderAtom)
  const anchor = useScrollMemory(openGallery ?? `folder:${folder ?? ''}`)

  return (
    <div ref={anchor} className="flex flex-col">
      {openGallery === undefined ? (
        <Shelf key={folder ?? ''} folder={folder} />
      ) : (
        <GalleryPage folder={openGallery} />
      )}
    </div>
  )
}
