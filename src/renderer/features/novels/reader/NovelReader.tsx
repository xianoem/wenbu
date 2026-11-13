import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ListIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChapterView } from '#contract/Novels'
import { daysSince, formatUsd } from '#lib/format'
import {
  type NovelReaderOpening,
  novelReaderAtom,
  openNovelAtom,
  screenAtom,
  settingsPageAtom,
} from '#lib/navigation'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { Spinner } from '#ui/spinner'
import { TitleBar } from '../../../shell/TitleBar'
import { PasteDialog } from '../components/PasteDialog'
import {
  allChaptersAtom,
  chapterViewAtom,
  novelDetailsAtom,
  novelsKeys,
  type ReaderDisplay,
  readerDisplayAtom,
  retranslateChapterAtom,
  saveReadingAtom,
} from '../novels'
import { DisplayPopover, themes } from './DisplayPopover'
import { PeoplePopover } from './PeoplePopover'
import { Previously, RECAP_AFTER_DAYS } from './Previously'
import { SelectionPopover, type SelectedText } from './SelectionPopover'
import { SuggestedTerms } from './SuggestedTerms'
import { TermText } from './TermText'

const columnWidths: Record<ReaderDisplay['width'], string> = {
  narrow: 'max-w-[540px]',
  comfortable: 'max-w-[640px]',
  wide: 'max-w-[780px]',
}

function ChapterList({
  view,
  onOpen,
}: {
  readonly view: ChapterView
  readonly onOpen: (number: number) => void
}) {
  const result = useAtomValue(allChaptersAtom(view.novelId))
  const rows = AsyncResult.isSuccess(result) ? result.value.rows : []

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Chapters"
            className="size-8 text-muted-foreground data-popup-open:bg-secondary data-popup-open:text-foreground"
          />
        }
      >
        <ListIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] rounded-[20px] bg-card p-2 shadow-card">
        <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(480px,calc(var(--available-height)-16px))]">
          <div className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <Button
                key={row.number}
                variant="ghost"
                className={cn(
                  'h-8 justify-start gap-2 px-2 font-normal',
                  row.number === view.number && 'bg-secondary font-medium',
                  row.extra && 'opacity-60',
                )}
                onClick={() => onOpen(row.number)}
              >
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {row.number}
                </span>
                <span className="flex-1 truncate text-left">
                  {row.titleTranslated ?? row.title}
                </span>
                {row.status === 'translated' ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-success" />
                ) : null}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function Notice({ view, onPaste }: { readonly view: ChapterView; readonly onPaste: () => void }) {
  const retranslate = useAtomSet(retranslateChapterAtom, { mode: 'promiseExit' })
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)

  if (!view.hasText) {
    return (
      <div className="mt-8 rounded-[18px] bg-card px-5 py-4 font-sans text-sm shadow-card">
        <div className="font-medium">No source has this chapter’s text yet</div>
        <p className="mt-1 text-muted-foreground">
          Paste it to read it here. Pasted text is never replaced by a site.
        </p>
        <Button className="mt-3 rounded-full" onClick={onPaste}>
          Paste this chapter
        </Button>
      </div>
    )
  }

  if (view.state === 'no-preset') {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-[18px] bg-card px-4 py-3 font-sans text-sm shadow-card">
        <WarningCircleIcon weight="fill" className="size-4 shrink-0 text-warning" />
        <span className="flex-1">Choose a model for Novels to read this translated.</span>
        <Button
          variant="secondary"
          className="h-7 rounded-full px-3 text-xs"
          onClick={() => {
            setSettingsPage('novels')
            setScreen('settings')
          }}
        >
          Open settings
        </Button>
      </div>
    )
  }

  if (view.state === 'failed' || view.state === 'stopped') {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-[18px] bg-card px-4 py-3 font-sans text-sm shadow-card">
        <WarningCircleIcon weight="fill" className="size-4 shrink-0 text-destructive" />
        <span className="flex-1">{view.message ?? 'The translation stopped.'}</span>
        <Button
          variant="secondary"
          className="h-7 gap-1.5 rounded-full px-3 text-xs"
          onClick={() =>
            void retranslate({
              payload: { novelId: view.novelId, number: view.number },
              reactivityKeys: novelsKeys,
            })
          }
        >
          <ArrowClockwiseIcon />
          Try again
        </Button>
      </div>
    )
  }

  return null
}

function Chapter({
  view,
  display,
  onTermAdded,
  onPaste,
}: {
  readonly view: ChapterView
  readonly display: ReaderDisplay
  readonly onTermAdded: () => void
  readonly onPaste: () => void
}) {
  const article = useRef<HTMLElement>(null)
  const [selected, setSelected] = useState<SelectedText | undefined>(undefined)
  const terms = useMemo(() => new Map(view.terms.map((term) => [term.id, term])), [view.terms])
  const close = useCallback(() => setSelected(undefined), [])

  const select = () => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    const node = selection?.anchorNode?.parentElement?.closest('[data-original]')

    if (
      selection === null ||
      text.length < 2 ||
      node === null ||
      node === undefined ||
      article.current === null
    ) {
      return
    }

    const range = selection.getRangeAt(0).getBoundingClientRect()
    const box = article.current.getBoundingClientRect()

    setSelected({ text, top: range.bottom - box.top + 8, left: Math.max(0, range.left - box.left) })
  }

  const translating = view.state === 'translating' || view.state === 'waiting'

  return (
    <article
      ref={article}
      className={cn(
        'relative mx-auto px-6 pt-8 pb-40',
        columnWidths[display.width],
        display.font === 'serif' ? 'font-serif' : 'font-sans',
      )}
      style={{ fontSize: display.size, lineHeight: display.lineHeight }}
      onMouseUp={select}
    >
      <h1 className="text-center text-[1.55em] leading-tight font-semibold">
        {view.titleTranslated ?? view.title}
      </h1>
      {view.titleTranslated === null ? null : (
        <div className="mt-1 text-center font-serif text-[0.85em] text-muted-foreground">
          {view.title}
        </div>
      )}
      <Notice view={view} onPaste={onPaste} />
      {view.paragraphs.map((paragraph, index) => {
        const showTranslation = display.translation && paragraph.translated !== null
        const showOriginal = display.original || paragraph.translated === null

        return (
          // oxlint-disable-next-line react/no-array-index-key -- paragraphs are a fixed list for the chapter; their position is their identity.
          <div key={index} data-paragraph={index} className="mt-4">
            {showTranslation && paragraph.translated !== null ? (
              <TermText
                text={paragraph.translated}
                spans={paragraph.translatedTerms}
                terms={terms}
                className="text-foreground/90"
              />
            ) : null}
            {showOriginal ? (
              <div data-original="">
                <TermText
                  text={paragraph.original}
                  spans={paragraph.originalTerms}
                  terms={terms}
                  className={cn(
                    'font-serif',
                    showTranslation
                      ? 'mt-1 text-[0.83em] leading-relaxed text-muted-foreground/75'
                      : 'text-foreground/90',
                    translating &&
                      paragraph.translated === null &&
                      display.translation &&
                      'animate-pulse',
                  )}
                />
              </div>
            ) : null}
          </div>
        )
      })}
      {view.note === null ? null : (
        <details className="mt-8 font-sans text-sm text-muted-foreground">
          <summary className="cursor-pointer">Author’s note</summary>
          <p className="mt-2 font-serif whitespace-pre-line">{view.note}</p>
        </details>
      )}
      {selected === undefined ? null : (
        <SelectionPopover
          novelId={view.novelId}
          chapter={view.number}
          selected={selected}
          onClose={close}
          onTermAdded={onTermAdded}
        />
      )}
    </article>
  )
}

function BottomBar({
  view,
  progress,
  onOpen,
}: {
  readonly view: ChapterView | undefined
  readonly progress: number
  readonly onOpen: (number: number) => void
}) {
  return (
    <>
      <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-28 bg-linear-to-t from-[inherit] to-transparent" />
      <div className="absolute right-6 bottom-5 left-6 flex items-center gap-3 rounded-full bg-card/90 px-4 py-2 text-xs text-muted-foreground shadow-card backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous chapter"
          disabled={view?.previous === null || view === undefined}
          onClick={() =>
            view?.previous === null || view === undefined ? undefined : onOpen(view.previous)
          }
        >
          <CaretLeftIcon />
        </Button>
        <span className="text-foreground tabular-nums">
          {view === undefined ? '' : `${view.number} / ${view.chapters}`}
        </span>
        <div className="h-1 flex-1 rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-foreground/70"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next chapter"
          disabled={view?.next === null || view === undefined}
          onClick={() =>
            view?.next === null || view === undefined ? undefined : onOpen(view.next)
          }
        >
          <CaretRightIcon />
        </Button>
        <span className="h-3 w-px bg-sidebar-border" />
        {view?.state === 'translating' ? (
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3" />
            Translating
          </span>
        ) : (
          <span className="text-success">
            ● {view?.readyAhead ?? 0} {view?.readyAhead === 1 ? 'chapter' : 'chapters'} ready ahead
          </span>
        )}
        {view?.costUsd === null || view?.costUsd === undefined ? null : (
          <span className="tabular-nums">{formatUsd(view.costUsd)} this chapter</span>
        )}
      </div>
    </>
  )
}

export function NovelReader({ opening }: { readonly opening: NovelReaderOpening }) {
  const setReading = useAtomSet(novelReaderAtom)
  const openNovel = useAtomSet(openNovelAtom)
  const display = useAtomValue(readerDisplayAtom)
  const saveReading = useAtomSet(saveReadingAtom)
  const [version, setVersion] = useState(0)
  const [pasting, setPasting] = useState(false)
  const [progress, setProgress] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const result = useAtomValue(chapterViewAtom(`${opening.novelId}|${opening.chapter}|${version}`))
  const view = AsyncResult.isSuccess(result) ? result.value : undefined
  const details = useAtomValue(novelDetailsAtom(opening.novelId))
  const [firstChapter] = useState(opening.chapter)

  const [away, setAway] = useState<number | null | undefined>(undefined)

  if (away === undefined && AsyncResult.isSuccess(details)) {
    const reading = details.value.reading

    setAway(reading === null ? null : daysSince(reading.readAt))
  }

  const open = useCallback(
    (chapter: number) => {
      setReading({ novelId: opening.novelId, chapter })
      scroller.current?.scrollTo({ top: 0 })
    },
    [opening.novelId, setReading],
  )

  useEffect(() => {
    if (away === undefined) {
      return
    }

    saveReading({
      payload: { novelId: opening.novelId, number: opening.chapter, paragraph: 0 },
      reactivityKeys: novelsKeys,
    })
  }, [away, opening.novelId, opening.chapter, saveReading])

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'ArrowLeft' && view?.previous !== null && view?.previous !== undefined) {
        open(view.previous)
      }

      if (event.key === 'ArrowRight' && view?.next !== null && view?.next !== undefined) {
        open(view.next)
      }
    }

    window.addEventListener('keydown', keys)

    return () => window.removeEventListener('keydown', keys)
  }, [open, view?.next, view?.previous])

  const scrolled = () => {
    const element = scroller.current

    if (element === null) {
      return
    }

    const room = element.scrollHeight - element.clientHeight

    setProgress(room <= 0 ? 1 : element.scrollTop / room)
  }

  return (
    <div className={cn('relative flex h-screen flex-col', themes[display.theme].background)}>
      <TitleBar logs={false}>
        <div className="app-no-drag flex min-w-0 flex-1 items-center">
          <Button
            variant="ghost"
            className="ml-1.5 h-7 max-w-64 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground"
            onClick={() => {
              openNovel(opening.novelId)
              setReading(undefined)
            }}
          >
            <CaretLeftIcon />
            <span className="truncate">{view?.novelTitle ?? 'Novels'}</span>
          </Button>
          <div className="app-drag min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
            {view === undefined ? null : (
              <>
                <span className="text-foreground">
                  Chapter {view.number}
                  {view.titleTranslated === null ? '' : ` · ${view.titleTranslated}`}
                </span>{' '}
                <span className="font-serif">{view.title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <DisplayPopover />
            <SuggestedTerms novelId={opening.novelId} chapter={opening.chapter} />
            {view === undefined ? null : <PeoplePopover terms={view.terms} />}
            {view === undefined ? null : <ChapterList view={view} onOpen={open} />}
          </div>
        </div>
      </TitleBar>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onScroll={scrolled}>
        {away !== null &&
        away !== undefined &&
        away >= RECAP_AFTER_DAYS &&
        opening.chapter === firstChapter ? (
          <Previously
            novelId={opening.novelId}
            chapter={firstChapter}
            daysAway={away}
            onOpen={open}
          />
        ) : null}
        {view === undefined ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {AsyncResult.isFailure(result) ? (
              'This chapter could not be opened.'
            ) : (
              <Spinner className="size-5" />
            )}
          </div>
        ) : (
          <Chapter
            view={view}
            display={display}
            onTermAdded={() => setVersion(version + 1)}
            onPaste={() => setPasting(true)}
          />
        )}
      </div>
      <BottomBar view={view} progress={progress} onOpen={open} />
      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        novelId={opening.novelId}
        startAt={opening.chapter}
        onDone={() => setVersion(version + 1)}
      />
    </div>
  )
}
