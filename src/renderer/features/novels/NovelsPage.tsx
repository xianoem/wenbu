import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BookOpenTextIcon,
  ClipboardTextIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  type NewChapter,
  type NovelSummary,
  type SearchResult,
  SiteFailed,
  SiteResults,
} from '#contract/Novels'
import { formErrorOf } from '#lib/forms'
import { novelReaderAtom, openNovelAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '#ui/input-group'
import { Spinner } from '#ui/spinner'
import { NovelCover } from './components/NovelCover'
import { PasteDialog } from './components/PasteDialog'
import {
  addNovelFromUrlAtom,
  looksLikeLink,
  novelsKeys,
  searchAtom,
  shelfAtom,
  shownTitle,
  tintOf,
} from './novels'

const heroTints = {
  amber: 'from-tint-amber',
  violet: 'from-tint-violet',
  teal: 'from-tint-teal',
  slate: 'from-tint-slate',
} as const

const heroLetters = {
  amber: 'text-tint-amber-foreground/25',
  violet: 'text-tint-violet-foreground/25',
  teal: 'text-tint-teal-foreground/25',
  slate: 'text-tint-slate-foreground/25',
} as const

const progressOf = (novel: NovelSummary) =>
  novel.chapters === 0 || novel.reading === null
    ? 0
    : Math.min(1, novel.reading.chapter / novel.chapters)

const continueOf = (novels: ReadonlyArray<NovelSummary>) =>
  novels
    .filter((novel) => novel.reading !== null)
    .toSorted((left, right) =>
      (right.reading?.readAt ?? '').localeCompare(left.reading?.readAt ?? ''),
    )[0] ?? novels[0]

function ContinueCard({ novel }: { readonly novel: NovelSummary }) {
  const openReader = useAtomSet(novelReaderAtom)
  const openNovel = useAtomSet(openNovelAtom)
  const tint = tintOf(novel.id)
  const chapter = novel.reading?.chapter ?? 1

  const line = [
    novel.reading === null ? 'Not started' : `Chapter ${chapter}`,
    novel.readingTitle,
    novel.newChapters > 0 ? `${novel.newChapters} new chapters` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <div
      className={cn(
        'relative h-[250px] overflow-hidden rounded-[24px] bg-linear-120 to-[oklch(0.17_0.01_285)] to-70% shadow-card',
        heroTints[tint],
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute top-5 right-8 font-serif text-5xl leading-none font-semibold [writing-mode:vertical-rl]',
          heroLetters[tint],
        )}
      >
        {novel.title.slice(0, 6)}
      </div>
      <div className="absolute bottom-6 left-7 max-w-[62%]">
        <div className="text-xs font-medium text-muted-foreground">
          {novel.reading === null ? 'Start reading' : 'Continue reading'}
        </div>
        <div className="mt-1 text-[26px] leading-tight font-semibold tracking-tight">
          {shownTitle(novel)}
        </div>
        <div className="mt-1 truncate text-sm text-foreground/75">{line}</div>
        <div className="mt-4 flex gap-2">
          <Button
            className="rounded-full"
            onClick={() => openReader({ novelId: novel.id, chapter })}
          >
            <PlayIcon />
            Continue
          </Button>
          <Button variant="secondary" className="rounded-full" onClick={() => openNovel(novel.id)}>
            Details
          </Button>
        </div>
      </div>
    </div>
  )
}

const chapterState = (chapter: NewChapter) => {
  if (chapter.translated) {
    return { dot: 'bg-success', label: 'Translated' }
  }

  return chapter.hasText
    ? { dot: 'bg-success', label: 'Ready' }
    : { dot: 'bg-info', label: 'Waiting for text' }
}

function NewChapters({ chapters }: { readonly chapters: ReadonlyArray<NewChapter> }) {
  const openReader = useAtomSet(novelReaderAtom)

  return (
    <section className="flex flex-col rounded-[24px] bg-card px-[18px] py-4 shadow-card">
      <div className="text-[13px] font-medium text-muted-foreground">New chapters</div>
      {chapters.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          New chapters of the novels you read show up here.
        </p>
      ) : null}
      {chapters.slice(0, 5).map((chapter) => {
        const state = chapterState(chapter)

        return (
          <Button
            key={`${chapter.novelId}:${chapter.number}`}
            variant="ghost"
            className="mt-1.5 -mx-2 h-auto items-start justify-start gap-2.5 px-2 py-1.5 text-left font-normal whitespace-normal"
            onClick={() => openReader({ novelId: chapter.novelId, chapter: chapter.number })}
          >
            <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', state.dot)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{chapter.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {chapter.novelTitle} · Ch. {chapter.number} · {state.label}
              </span>
            </span>
          </Button>
        )
      })}
    </section>
  )
}

function Library({
  novels,
  onAdd,
}: {
  readonly novels: ReadonlyArray<NovelSummary>
  readonly onAdd: () => void
}) {
  const openNovel = useAtomSet(openNovelAtom)

  return (
    <section className="mt-7">
      <h2 className="text-[13px] font-medium text-muted-foreground">Library</h2>
      <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-4 gap-y-6">
        {novels.map((novel) => (
          <Button
            key={novel.id}
            variant="ghost"
            className="h-auto min-w-0 flex-col items-stretch gap-0 p-0 text-left font-normal whitespace-normal hover:bg-transparent"
            onClick={() => openNovel(novel.id)}
          >
            <span className="relative block">
              <NovelCover
                id={novel.id}
                title={novel.title}
                className="aspect-3/4 rounded-[14px] shadow-card"
                size="text-xl"
              />
              {novel.newChapters > 0 ? (
                <span className="absolute top-2 left-2 rounded-full bg-info px-1.5 text-[11px] leading-4 font-semibold text-black tabular-nums">
                  +{novel.newChapters}
                </span>
              ) : null}
            </span>
            <span className="mt-2 block h-1 rounded-full bg-muted">
              <span
                className="block h-1 rounded-full bg-foreground/80"
                style={{ width: `${Math.round(progressOf(novel) * 100)}%` }}
              />
            </span>
            <span className="mt-1.5 truncate text-[13px] font-semibold">{shownTitle(novel)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {novel.sourceLabel} · {novel.chapters} ch.
            </span>
          </Button>
        ))}
        <Button
          variant="ghost"
          className="flex aspect-3/4 h-auto flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-input text-xs font-normal text-muted-foreground"
          onClick={onAdd}
        >
          <PlusIcon className="size-5" />
          Paste a novel
        </Button>
      </div>
    </section>
  )
}

function SearchResults({
  query,
  onClose,
}: {
  readonly query: string
  readonly onClose: () => void
}) {
  const updates = useAtomValue(searchAtom(query))
  const add = useAtomSet(addNovelFromUrlAtom, { mode: 'promiseExit' })
  const openNovel = useAtomSet(openNovelAtom)
  const [adding, setAdding] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const all = AsyncResult.isSuccess(updates) ? updates.value : []
  const results = all.filter(Schema.is(SiteResults)).flatMap((update) => update.results)
  const failed = all.filter(Schema.is(SiteFailed))

  const open = async (result: SearchResult) => {
    if (result.novelId !== null) {
      openNovel(result.novelId)

      return
    }

    setAdding(result.url)
    setError(undefined)

    const exit = await add({ payload: { url: result.url }, reactivityKeys: novelsKeys })

    setAdding(undefined)

    if (Exit.isSuccess(exit)) {
      openNovel(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <section className="mt-6 rounded-[24px] bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-[13px] font-medium text-muted-foreground">
          Results for “{query}”
        </span>
        {AsyncResult.isWaiting(updates) ? <Spinner className="size-3.5" /> : null}
        <Button variant="ghost" size="icon-sm" aria-label="Close results" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {results.length === 0 && !AsyncResult.isWaiting(updates) ? (
        <p className="px-1 pt-2 text-[13px] text-muted-foreground">
          Nothing found on the sites Wenbu knows.
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {results.map((result) => (
          <Button
            key={result.url}
            variant="ghost"
            disabled={adding !== undefined}
            className="h-auto items-start justify-start gap-3 rounded-[14px] bg-background/60 p-2.5 text-left font-normal whitespace-normal"
            onClick={() => void open(result)}
          >
            <NovelCover
              id={result.url}
              title={result.title}
              className="h-16 w-12 shrink-0 rounded-[8px]"
              size="text-xs"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{result.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {result.siteName}
                {result.official ? ' · Official' : ''}
                {result.author === null ? '' : ` · ${result.author}`}
                {result.latestChapter === null ? '' : ` · ${result.latestChapter}`}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {result.novelId === null ? 'Add to library' : 'In your library'}
              </span>
            </span>
            {adding === result.url ? <Spinner className="size-3.5" /> : null}
          </Button>
        ))}
      </div>
      {failed.map((site) => (
        <p key={site.site} className="px-1 pt-2 text-xs text-muted-foreground">
          {site.site}: {site.message}
        </p>
      ))}
      {error === undefined ? null : <p className="px-1 pt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}

function EmptyShelf({ onPaste }: { readonly onPaste: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-2.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <BookOpenTextIcon className="size-6" />
      </div>
      <p className="mt-1 text-base font-semibold">No novels yet</p>
      <p className="max-w-sm text-muted-foreground">
        Search for a novel, paste a link to its page on a site Wenbu knows, or paste its chapters.
      </p>
      <Button variant="secondary" className="mt-2 rounded-full" onClick={onPaste}>
        <ClipboardTextIcon />
        Paste chapters
      </Button>
    </div>
  )
}

function InputIcon({ busy, link }: { readonly busy: boolean; readonly link: boolean }) {
  if (busy) {
    return <Spinner className="size-3.5" />
  }

  return link ? <LinkIcon /> : <MagnifyingGlassIcon />
}

export function NovelsPage() {
  const shelf = useAtomValue(shelfAtom)
  const add = useAtomSet(addNovelFromUrlAtom, { mode: 'promiseExit' })
  const openNovel = useAtomSet(openNovelAtom)
  const openReader = useAtomSet(novelReaderAtom)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | undefined>(undefined)
  const [pasting, setPasting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const novels = AsyncResult.isSuccess(shelf) ? shelf.value.novels : []
  const current = continueOf(novels)
  const link = looksLikeLink(input.trim())

  const submit = async () => {
    const text = input.trim()

    setError(undefined)

    if (text === '') {
      return
    }

    if (!looksLikeLink(text)) {
      setQuery(text)

      return
    }

    setBusy(true)

    const exit = await add({ payload: { url: text }, reactivityKeys: novelsKeys })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setInput('')
      openNovel(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-[28px] font-semibold tracking-tight">Novels</h1>
        <InputGroup className="h-9 w-96 rounded-full">
          <InputGroupAddon>
            <InputIcon busy={busy} link={link} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search novels or paste a link"
            placeholder="Search titles, or paste a novel’s link to add it"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void submit()
              }
            }}
          />
          {link && !busy ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton className="rounded-full" onClick={() => void submit()}>
                <PlusIcon />
                Add novel
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <Button
          variant="secondary"
          className="h-9 rounded-full px-4"
          onClick={() => setPasting(true)}
        >
          <ClipboardTextIcon />
          Paste
        </Button>
      </div>
      {busy ? (
        <p className="mt-2 text-right text-xs text-muted-foreground">
          Reading the novel’s page. If the site shows a check, a window opens for you to pass it.
        </p>
      ) : null}
      {error === undefined ? null : (
        <p className="mt-2 text-right text-xs text-destructive">{error}</p>
      )}
      {query === undefined ? null : (
        <SearchResults query={query} onClose={() => setQuery(undefined)} />
      )}
      {AsyncResult.isSuccess(shelf) && novels.length === 0 && query === undefined ? (
        <EmptyShelf onPaste={() => setPasting(true)} />
      ) : null}
      {current === undefined ? null : (
        <>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_300px] gap-5">
            <ContinueCard novel={current} />
            <NewChapters chapters={AsyncResult.isSuccess(shelf) ? shelf.value.newChapters : []} />
          </div>
          <Library
            novels={novels.filter((novel) => novel.id !== current.id)}
            onAdd={() => setPasting(true)}
          />
        </>
      )}
      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        onDone={(novelId, chapter) => openReader({ novelId, chapter })}
      />
    </div>
  )
}
