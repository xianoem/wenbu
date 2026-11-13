import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ExportIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { LineCounts, LineFilter, TranslationLine, WriteSkip } from '#contract/GameTranslation'
import type { Game, GameEngine } from '#contract/Library'
import { fitOf } from '#contract/TextFit'
import { formErrorOf } from '#lib/forms'
import { translationReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { ScrollArea } from '#ui/scroll-area'
import { ExportDialog } from './ExportDialog'
import { FitPreview } from './FitPreview'
import { OutsideChangesNotice } from './OutsideChangesNotice'
import { Textarea } from '#ui/textarea'
import { libraryKeys, translationKeys, translationSettingsAtom } from '../library/library'
import {
  applyTranslationEditsAtom,
  type LineState,
  lineKey,
  lineKeys,
  linesKey,
  placeOf,
  retranslateLineAtom,
  saveTranslationLineAtom,
  setTranslationLineLockedAtom,
  shortenTranslationLineAtom,
  stateOf,
  translationLineAtom,
  translationLinesAtom,
} from './translationLines'

const pageSize = 300

const filters: ReadonlyArray<{
  readonly id: LineFilter
  readonly label: string
  readonly count: keyof LineCounts
}> = [
  { id: 'all', label: 'All', count: 'all' },
  { id: 'review', label: 'Needs review', count: 'review' },
  { id: 'missing', label: 'Not translated', count: 'missing' },
  { id: 'skipped', label: 'Not in the game', count: 'skipped' },
  { id: 'too-long', label: 'Too long', count: 'tooLong' },
  { id: 'edited', label: 'Edited', count: 'edited' },
  { id: 'locked', label: 'Locked', count: 'locked' },
]

const dotColors: Record<LineState, string> = {
  model: 'bg-success',
  edited: 'bg-info',
  locked: 'bg-tint-violet-foreground',
  missing: 'bg-destructive',
}

const stateLabels: Record<LineState, { readonly text: string; readonly className: string }> = {
  model: { text: 'Translated', className: 'bg-success/10 text-success' },
  edited: { text: 'Edited', className: 'bg-info/12 text-info' },
  locked: { text: 'Locked', className: 'bg-tint-violet text-tint-violet-foreground' },
  missing: { text: 'Not translated', className: 'bg-destructive/12 text-destructive' },
}

const skipReasons: Record<WriteSkip, string> = {
  'source-mismatch': 'the original changed after it was read',
  'broken-formatting': 'the translation lost control codes, placeholders or line breaks',
  'missing-location': 'the line is no longer in its file',
}

const oneLine = (text: string) => text.replace(/\n/g, ' ')

function StatePill({ line }: { readonly line: TranslationLine }) {
  const label = stateLabels[stateOf(line)]

  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        label.className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label.text}
    </span>
  )
}

function LineButton({
  line,
  engine,
  selected,
  onSelect,
}: {
  readonly line: TranslationLine
  readonly engine: GameEngine
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const tooLong =
    line.translatedText !== undefined &&
    fitOf(engine, line.context, line.translatedText)?.status === 'too-long'

  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full items-start justify-start gap-2.5 rounded-2xl px-3 py-2 text-left font-normal whitespace-normal',
        selected && 'bg-muted',
      )}
      onClick={onSelect}
    >
      <span className={cn('mt-[7px] size-[7px] shrink-0 rounded-full', dotColors[stateOf(line)])} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[13px]',
            line.translatedText === undefined && 'text-muted-foreground',
          )}
        >
          {line.translatedText === undefined ? 'Not translated' : oneLine(line.translatedText)}
        </span>
        {tooLong ? (
          <span className="mt-0.5 inline-flex h-5 w-fit items-center rounded-full bg-tint-amber px-2 text-[11px] font-medium text-tint-amber-foreground">
            Too long
          </span>
        ) : null}
        <span className="truncate text-xs text-muted-foreground">{oneLine(line.sourceText)}</span>
      </span>
      {line.locked ? <LockSimpleIcon weight="fill" className="mt-1 text-muted-foreground" /> : null}
    </Button>
  )
}

function SameSource({
  game,
  lines,
  text,
}: {
  readonly game: Game
  readonly lines: ReadonlyArray<TranslationLine>
  readonly text: string
}) {
  const save = useAtomSet(saveTranslationLineAtom)

  if (lines.length === 0) {
    return null
  }

  return (
    <div className="mt-4">
      <p className="text-[13px] font-medium text-muted-foreground">Same original text elsewhere</p>
      <ul className="mt-1.5 flex flex-col">
        {lines.map((other) => (
          <li
            key={other.entryId}
            className="flex items-start gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] hover:bg-foreground/4"
          >
            <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
              {placeOf(other)}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">
              {other.translatedText ?? 'Not translated'}
            </span>
            {other.locked || other.translatedText === text ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 rounded-full px-2 text-xs font-normal"
                disabled={text.trim() === ''}
                onClick={() =>
                  save({
                    payload: { gameId: game.id, entryId: other.entryId, text },
                    reactivityKeys: lineKeys,
                  })
                }
              >
                Use mine
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Detail({ game, entryId }: { readonly game: Game; readonly entryId: string }) {
  const result = useAtomValue(translationLineAtom(lineKey(game.id, entryId)))

  if (!AsyncResult.isSuccess(result)) {
    return <div className="rounded-[20px] bg-muted p-4" />
  }

  const { line, before, sameSource } = result.value

  return (
    <LineEditor
      key={`${line.entryId}:${line.translatedText ?? ''}:${String(line.locked)}`}
      game={game}
      line={line}
      before={before}
      sameSource={sameSource}
    />
  )
}

function LineEditor({
  game,
  line,
  before,
  sameSource,
}: {
  readonly game: Game
  readonly line: TranslationLine
  readonly before: TranslationLine | undefined
  readonly sameSource: ReadonlyArray<TranslationLine>
}) {
  const save = useAtomSet(saveTranslationLineAtom, { mode: 'promiseExit' })
  const setLocked = useAtomSet(setTranslationLineLockedAtom, { mode: 'promiseExit' })
  const retranslate = useAtomSet(retranslateLineAtom, { mode: 'promiseExit' })
  const shorten = useAtomSet(shortenTranslationLineAtom, { mode: 'promiseExit' })
  const saved = line.translatedText ?? ''
  const [draft, setDraft] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const target = { gameId: game.id, entryId: line.entryId }
  const changed = draft !== saved

  const report = async (pending: Promise<Exit.Exit<unknown, unknown>>) => {
    setBusy(true)
    setError(formErrorOf(await pending)?.message)
    setBusy(false)
  }

  const saveDraft = (lock: boolean) =>
    report(
      (async () => {
        const exit = await save({ payload: { ...target, text: draft }, reactivityKeys: lineKeys })

        if (lock && Exit.isSuccess(exit)) {
          return setLocked({ payload: { ...target, locked: true }, reactivityKeys: lineKeys })
        }

        return exit
      })(),
    )

  const toggleLock = () =>
    report(setLocked({ payload: { ...target, locked: !line.locked }, reactivityKeys: lineKeys }))

  return (
    <div className="flex flex-col rounded-[20px] bg-muted p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PencilSimpleIcon />
        <span className="min-w-0 flex-1 truncate">{placeOf(line)}</span>
        <StatePill line={line} />
      </div>

      {before === undefined ? null : (
        <p className="mt-3 ml-0.5 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
          {before.sourceText}
        </p>
      )}

      {line.writeSkipped === undefined ? null : (
        <p className="mt-3 rounded-xl bg-warning/8 px-3 py-2 text-xs text-warning">
          Not in the game: Wenbu kept the original text because {skipReasons[line.writeSkipped]}.
          Fix the translation, then apply it.
        </p>
      )}

      {line.change === 'changed' && line.previousSource !== undefined ? (
        <p className="mt-3 rounded-xl bg-warning/8 px-3 py-2 text-xs text-warning">
          The game update reworded this line. Before: {oneLine(line.previousSource)}
        </p>
      ) : null}

      <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">{line.sourceText}</p>

      <Textarea
        aria-label="Translation"
        className="mt-3 min-h-20 bg-card"
        value={draft}
        placeholder="Not translated"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault()
            void saveDraft(false)
          }

          if (event.key.toLowerCase() === 'l' && event.ctrlKey) {
            event.preventDefault()
            void (changed ? saveDraft(true) : toggleLock())
          }
        }}
      />

      <p className="mt-1.5 flex text-xs text-muted-foreground">
        <span className="flex-1">
          {draft.split('\n').length} of {line.sourceText.split('\n').length} lines
        </span>
        Ctrl Enter saves · Ctrl L locks
      </p>

      <FitPreview
        engine={game.engine}
        context={line.context}
        text={draft}
        shortening={busy}
        onShorten={
          line.locked || changed
            ? undefined
            : () => void report(shorten({ payload: target, reactivityKeys: lineKeys }))
        }
      />

      {error === undefined ? null : <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          className="h-8 rounded-full px-4"
          disabled={busy || !changed}
          onClick={() => void saveDraft(false)}
        >
          Save
        </Button>
        {line.locked && !changed ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 rounded-full px-3"
            disabled={busy}
            onClick={() => void toggleLock()}
          >
            <LockSimpleOpenIcon />
            Unlock
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 rounded-full px-3"
            disabled={busy || (draft.trim() === '' && !changed)}
            onClick={() => void (changed ? saveDraft(true) : toggleLock())}
          >
            <LockSimpleIcon />
            {changed ? 'Save and lock' : 'Lock'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 font-normal text-muted-foreground"
          disabled={busy || line.locked}
          title={line.locked ? 'Unlock the line to translate it again.' : undefined}
          onClick={() => void report(retranslate({ payload: target, reactivityKeys: lineKeys }))}
        >
          <ArrowsClockwiseIcon className={cn(busy && 'animate-spin')} />
          Translate again
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 font-normal text-muted-foreground"
          disabled={!changed}
          onClick={() => setDraft(saved)}
        >
          <ArrowCounterClockwiseIcon />
          Revert
        </Button>
      </div>

      <SameSource game={game} lines={sameSource} text={draft} />
    </div>
  )
}

function ApplyBar({ game, unapplied }: { readonly game: Game; readonly unapplied: number }) {
  const apply = useAtomSet(applyTranslationEditsAtom, { mode: 'promiseExit' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [outsideChanges, setOutsideChanges] = useState<string | undefined>(undefined)

  if (outsideChanges !== undefined) {
    return (
      <OutsideChangesNotice
        className="sticky bottom-5 mx-auto mt-4 max-w-2xl shadow-card"
        gameId={game.id}
        message={outsideChanges}
        onRestored={() => setOutsideChanges(undefined)}
      />
    )
  }

  if (unapplied === 0 && error === undefined) {
    return null
  }

  const write = async () => {
    setBusy(true)

    const exit = await apply({
      payload: { gameId: game.id },
      reactivityKeys: [...lineKeys, ...translationKeys, ...libraryKeys],
    })

    const failure = formErrorOf(exit)
    const stopped = failure?.field === 'gameFiles'

    setOutsideChanges(stopped ? failure.message : undefined)
    setError(stopped ? undefined : failure?.message)
    setBusy(false)
  }

  return (
    <div className="sticky bottom-5 mx-auto mt-4 flex w-fit items-center gap-3 rounded-full bg-card py-2 pr-2 pl-4.5 text-[13px] shadow-card">
      <PencilSimpleIcon />
      <span className={cn(error !== undefined && 'text-destructive')}>
        {error ??
          `${unapplied.toLocaleString('en-US')} ${unapplied === 1 ? 'edit' : 'edits'} not in the game yet`}
      </span>
      <Button
        size="sm"
        className="h-8 rounded-full px-4"
        disabled={busy || unapplied === 0}
        onClick={() => void write()}
      >
        {busy ? 'Writing…' : 'Apply to game'}
      </Button>
    </div>
  )
}

export function TranslationReviewPage({ game }: { readonly game: Game }) {
  const close = useAtomSet(translationReviewAtom)
  const settings = useAtomValue(translationSettingsAtom)
  const [filter, setFilter] = useState<LineFilter>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const result = useAtomValue(translationLinesAtom(linesKey(game.id, filter, query, limit)))
  const page = AsyncResult.isSuccess(result) ? result.value : undefined
  const lines = page?.lines ?? []
  const selected = lines.find((line) => line.entryId === selectedId) ?? lines[0]
  const counts = page?.counts
  const language = AsyncResult.isSuccess(settings) ? settings.value.targetLanguage : undefined

  const summary = [
    counts === undefined ? undefined : `${counts.all.toLocaleString('en-US')} lines`,
    language === undefined ? undefined : `into ${language}`,
    counts === undefined || counts.edited === 0 ? undefined : `${counts.edited} edited`,
    counts === undefined || counts.locked === 0 ? undefined : `${counts.locked} locked`,
  ].filter((part) => part !== undefined)

  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        className="h-8 w-fit rounded-full px-3"
        onClick={() => close(undefined)}
      >
        <ArrowLeftIcon />
        {game.title}
      </Button>

      <div className="mt-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Translated text</h1>
          <p className="mt-1 text-muted-foreground">
            {summary.join(' · ')}
            {summary.length === 0 ? '' : ' · '}
            locked lines are never translated again
          </p>
        </div>
        <Button
          variant="secondary"
          className="h-9 rounded-full px-4"
          disabled={counts === undefined || counts.all === counts.missing}
          onClick={() => setExporting(true)}
        >
          <ExportIcon />
          Export
        </Button>
      </div>

      {exporting ? (
        <ExportDialog
          game={game}
          targetLanguage={language ?? 'English'}
          unapplied={counts?.unapplied ?? 0}
          open
          onOpenChange={setExporting}
        />
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {filters.map((option) => (
          <Button
            key={option.id}
            variant={filter === option.id ? 'default' : 'secondary'}
            className="h-7 gap-1.5 rounded-full px-3 text-[13px]"
            onClick={() => {
              setFilter(option.id)
              setLimit(pageSize)
            }}
          >
            {option.label}
            {counts === undefined ? null : (
              <span className="opacity-60">{counts[option.count].toLocaleString('en-US')}</span>
            )}
          </Button>
        ))}
        <span className="flex-1" />
        <InputGroup className="h-8 w-60 rounded-full">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search lines"
            placeholder="Search text or file"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setLimit(pageSize)
            }}
          />
        </InputGroup>
      </div>

      <section className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3.5 rounded-3xl bg-card p-3 shadow-card">
        {lines.length === 0 ? (
          <p className="col-span-2 p-6 text-center text-muted-foreground">
            {AsyncResult.isFailure(result) ? 'The lines could not be read.' : 'No lines match.'}
          </p>
        ) : (
          <>
            <ScrollArea className="max-h-[calc(100vh-300px)]">
              <div className="flex flex-col gap-0.5 pr-2">
                {lines.map((line) => (
                  <LineButton
                    key={line.entryId}
                    line={line}
                    engine={game.engine}
                    selected={line.entryId === selected?.entryId}
                    onSelect={() => setSelectedId(line.entryId)}
                  />
                ))}
                {page !== undefined && page.total > lines.length ? (
                  <Button
                    variant="ghost"
                    className="mt-1 h-8 rounded-full text-[13px] text-muted-foreground"
                    onClick={() => setLimit(limit + pageSize)}
                  >
                    Show more · {(page.total - lines.length).toLocaleString('en-US')} left
                  </Button>
                ) : null}
              </div>
            </ScrollArea>
            {selected === undefined ? null : <Detail game={game} entryId={selected.entryId} />}
          </>
        )}
      </section>

      <ApplyBar game={game} unapplied={counts?.unapplied ?? 0} />
    </div>
  )
}
