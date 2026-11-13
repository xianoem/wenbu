import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ClipboardTextIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  PlayIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { ChapterRow, NovelDetails } from '#contract/Novels'
import { formatUsd } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { novelReaderAtom, openNovelAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { Spinner } from '#ui/spinner'
import { monthDay } from '../galleries/galleries'
import { AskFirst } from './components/AskFirst'
import { NovelCover } from './components/NovelCover'
import { PasteDialog } from './components/PasteDialog'
import {
  chapterPageAtom,
  novelDetailsAtom,
  novelsKeys,
  refreshNovelAtom,
  removeNovelAtom,
  shownTitle,
  tintOf,
} from './novels'

const bannerTints = {
  amber: 'from-tint-amber',
  violet: 'from-tint-violet',
  teal: 'from-tint-teal',
  slate: 'from-tint-slate',
} as const

const pageSize = 10

const sourceNote = (novel: NovelDetails) => {
  const hosts = novel.textSources.map((source) => source.siteName).join(', ')

  if (novel.officialSource === null) {
    return hosts === '' ? 'Pasted' : `Text from ${hosts}`
  }

  return hosts === ''
    ? `${novel.officialSource.siteName} · free chapters only`
    : `${novel.officialSource.siteName} · text from ${hosts}`
}

const statusLabel = (status: NovelDetails['status']) => {
  if (status === null) {
    return null
  }

  return status === 'ongoing' ? 'Ongoing' : 'Finished'
}

function Stat({
  label,
  value,
  note,
}: {
  readonly label: string
  readonly value: string
  readonly note: string
}) {
  return (
    <div className="rounded-[18px] bg-muted/60 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

function StatusPill({ row }: { readonly row: ChapterRow }) {
  if (row.status === 'translated') {
    return <span className="text-xs text-muted-foreground">Translated</span>
  }

  const ready = row.status === 'original' || row.status === 'on-site'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs',
        ready ? 'bg-success/15 text-success' : 'bg-info/15 text-info',
      )}
    >
      <span className={cn('size-1.5 rounded-full', ready ? 'bg-success' : 'bg-info')} />
      {ready ? 'Ready' : 'No text yet'}
    </span>
  )
}

function Chapters({
  novel,
  onPaste,
}: {
  readonly novel: NovelDetails
  readonly onPaste: (number: number | null) => void
}) {
  const openReader = useAtomSet(novelReaderAtom)
  const [newestFirst, setNewestFirst] = useState(true)
  const [page, setPage] = useState(0)
  const result = useAtomValue(chapterPageAtom(`${novel.id}|${page}|${newestFirst ? 'new' : 'old'}`))
  const rows = AsyncResult.isSuccess(result) ? result.value.rows : []
  const total = AsyncResult.isSuccess(result) ? result.value.total : 0
  const pages = Math.max(1, Math.ceil(total / pageSize))

  const pageButtons = [...new Set([0, page - 1, page, page + 1, pages - 1])]
    .filter((at) => at >= 0 && at < pages)
    .toSorted((left, right) => left - right)

  return (
    <section className="mt-7">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-medium text-muted-foreground">Chapters</h2>
        <Button
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-[13px] font-normal text-muted-foreground"
          onClick={() => onPaste(null)}
        >
          <ClipboardTextIcon />
          Paste chapters
        </Button>
        <Button
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-[13px] font-normal text-muted-foreground"
          onClick={() => {
            setNewestFirst(!newestFirst)
            setPage(0)
          }}
        >
          {newestFirst ? <SortDescendingIcon /> : <SortAscendingIcon />}
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </Button>
      </div>
      <div className="mt-2.5 overflow-hidden rounded-[20px] bg-card shadow-card">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_110px_90px_130px] items-center gap-4 px-[18px] py-2 text-xs text-muted-foreground">
          <span className="text-right">#</span>
          <span>Chapter</span>
          <span>Text from</span>
          <span>Released</span>
          <span className="text-right">Status</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.number}
            className={cn(
              'grid grid-cols-[44px_minmax(0,1fr)_110px_90px_130px] items-center gap-4 border-t px-[18px] py-2',
              row.extra && 'opacity-60',
            )}
          >
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {row.number}
            </span>
            <Button
              variant="ghost"
              className="-mx-2 h-auto min-w-0 flex-col items-start gap-0 px-2 py-1 text-left font-normal"
              onClick={() => openReader({ novelId: novel.id, chapter: row.number })}
            >
              <span className="w-full truncate">{row.titleTranslated ?? row.title}</span>
              {row.titleTranslated === null ? null : (
                <span className="w-full truncate font-serif text-xs text-muted-foreground">
                  {row.title}
                </span>
              )}
            </Button>
            <span className="truncate text-xs text-muted-foreground">{row.textFrom ?? '—'}</span>
            <span className="text-xs text-muted-foreground">
              {row.releasedAt === null ? '—' : monthDay(row.releasedAt)}
            </span>
            <span className="flex justify-end">
              {row.status === 'no-text' ? (
                <Button
                  variant="ghost"
                  title={
                    row.locked
                      ? 'Paid on its Official Source, and no host has it yet'
                      : 'No source has its text yet'
                  }
                  className="h-6 gap-1 rounded-full px-2.5 text-xs"
                  onClick={() => onPaste(row.number)}
                >
                  {row.locked ? <LockSimpleIcon /> : null}
                  Paste text
                </Button>
              ) : (
                <StatusPill row={row} />
              )}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1 border-t px-[18px] py-2.5 text-[13px] text-muted-foreground">
          <span className="flex-1 text-xs tabular-nums">
            {total === 0
              ? 'No chapters yet'
              : `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}`}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <CaretLeftIcon />
          </Button>
          {pageButtons.map((at) => (
            <Button
              key={at}
              variant={at === page ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="rounded-full tabular-nums"
              onClick={() => setPage(at)}
            >
              {at + 1}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            <CaretRightIcon />
          </Button>
        </div>
      </div>
    </section>
  )
}

function Details({ novel }: { readonly novel: NovelDetails }) {
  const openReader = useAtomSet(novelReaderAtom)
  const openNovel = useAtomSet(openNovelAtom)
  const refresh = useAtomSet(refreshNovelAtom, { mode: 'promiseExit' })
  const remove = useAtomSet(removeNovelAtom, { mode: 'promiseExit' })
  const [pasteAt, setPasteAt] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const chapter = novel.reading?.chapter ?? 1
  const source = novel.textSources[0]
  const checkable = novel.officialSource !== null || source !== undefined

  const run = async (action: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setBusy(true)
    setError(undefined)

    const exit = await action()

    setBusy(false)
    setError(formErrorOf(exit)?.message)
  }

  const facts = [novel.author, novel.tags[0], statusLabel(novel.status)].filter(
    (fact) => fact !== null && fact !== undefined,
  )

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'relative -mx-10 -mt-7 h-[210px] overflow-hidden bg-linear-160 to-background to-85%',
          bannerTints[tintOf(novel.id)],
        )}
      >
        <Button
          variant="ghost"
          className="absolute top-4 left-6 h-7 gap-1.5 rounded-full px-2 text-[13px] font-normal text-foreground/80"
          onClick={() => openNovel(undefined)}
        >
          <CaretLeftIcon />
          Novels
        </Button>
      </div>
      <div className="relative -mt-[120px] flex items-end gap-5">
        <NovelCover
          id={novel.id}
          title={novel.title}
          className="h-[170px] w-[122px] shrink-0 rounded-[16px] shadow-card"
          size="text-xl"
        />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
            {shownTitle(novel)}
          </h1>
          <div className="mt-1 truncate text-muted-foreground">
            <span className="font-serif">{novel.title}</span>
            {facts.length === 0 ? '' : ` · ${facts.join(' · ')}`}
          </div>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon"
                  className="rounded-full"
                  aria-label="More"
                />
              }
            >
              {busy ? <Spinner className="size-3.5" /> : <DotsThreeIcon />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {!checkable ? null : (
                <DropdownMenuItem
                  onClick={() =>
                    void run(() =>
                      refresh({ payload: { novelId: novel.id }, reactivityKeys: novelsKeys }),
                    )
                  }
                >
                  <ArrowClockwiseIcon />
                  Check for new chapters
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  void remove({ payload: { novelId: novel.id }, reactivityKeys: novelsKeys }).then(
                    (exit) => {
                      if (Exit.isSuccess(exit)) {
                        openNovel(undefined)
                      }
                    },
                  )
                }
              >
                <TrashIcon />
                Remove from library
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="rounded-full"
            onClick={() => openReader({ novelId: novel.id, chapter })}
          >
            <PlayIcon />
            {novel.reading === null ? 'Start reading' : `Continue · Ch. ${chapter}`}
          </Button>
        </div>
      </div>
      {error === undefined ? null : (
        <p className="mt-2 text-right text-xs text-destructive">{error}</p>
      )}
      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="Chapters" value={String(novel.chapters)} note={sourceNote(novel)} />
        <Stat
          label="Translated"
          value={String(novel.translatedChapters)}
          note={`${novel.readyAhead} ready ahead`}
        />
        <Stat
          label="Glossary"
          value={`${novel.glossaryTerms} terms`}
          note={
            novel.suggestedTerms === 0 ? 'Nothing to review' : `${novel.suggestedTerms} suggested`
          }
        />
        <Stat label="Spent" value={formatUsd(novel.spentUsd)} note="This novel" />
      </div>
      {novel.synopsisTranslated === null && novel.synopsis === null ? null : (
        <div className="mt-5">
          <p className="leading-relaxed whitespace-pre-line text-foreground/90">
            {novel.synopsisTranslated ?? novel.synopsis}
          </p>
          {novel.tags.length === 0 ? null : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {novel.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <AskFirst novelId={novel.id} />
      <Chapters novel={novel} onPaste={setPasteAt} />
      <PasteDialog
        open={pasteAt !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPasteAt(undefined)
          }
        }}
        novelId={novel.id}
        startAt={pasteAt ?? null}
        onDone={(novelId, number) => openReader({ novelId, chapter: number })}
      />
    </div>
  )
}

export function NovelPage({ novelId }: { readonly novelId: string }) {
  const result = useAtomValue(novelDetailsAtom(novelId))
  const openNovel = useAtomSet(openNovelAtom)

  if (AsyncResult.isSuccess(result)) {
    return <Details novel={result.value} />
  }

  if (AsyncResult.isFailure(result)) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">This novel is no longer in the library.</p>
        <Button variant="secondary" className="rounded-full" onClick={() => openNovel(undefined)}>
          Back to Novels
        </Button>
      </div>
    )
  }

  return null
}
