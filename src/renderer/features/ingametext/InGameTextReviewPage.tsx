import { useAtomRefresh, useAtomSet, useAtomSubscribe, useAtomValue } from '@effect/atom-react'
import {
  ArrowLeftIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import type { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  defaultInGameTextSettings,
  type InGameTextEntry,
  type InGameTextFilter,
  type InGameTextSettings,
  OriginalKey,
  type TextFit,
  WhenTooLong,
} from '#contract/InGameText'
import type { Game } from '#contract/Library'
import { formatMoment } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { inGameTextReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { Input } from '#ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { ScrollArea } from '#ui/scroll-area'
import {
  inGameTextKeys,
  inGameTextSettingsAtom,
  inGameTextsAtom,
  inGameTextSummaryAtom,
  listKey,
  saveInGameTextAtom,
  saveInGameTextSettingsAtom,
  setInGameTextLockedAtom,
  settingsKeys,
  shortenInGameTextAtom,
} from './inGameText'

const filters: ReadonlyArray<{ readonly id: InGameTextFilter; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'too-long', label: 'Too long' },
  { id: 'edited', label: 'Edited' },
]

const fitLabels: Record<TextFit, string> = {
  'as-is': 'Fits as is',
  smaller: 'Drawn with a smaller font',
  squeezed: 'Drawn squeezed',
  wrapped: 'Drawn on two lines',
  'too-long': 'Cut off: too long for its space',
}

const whenTooLongLabels: Record<WhenTooLong, string> = {
  shorten: 'Ask for a shorter translation',
  'shrink-only': 'Only shrink the text',
}

const originalKeyLabels: Record<OriginalKey, string> = {
  backquote: '` (backquote)',
  tab: 'Tab',
  alt: 'Alt',
}

const entryId = (entry: InGameTextEntry) => `${entry.origin}:${entry.key}`

const canvas: { current?: HTMLCanvasElement } = {}

const measure = (text: string, fontSize: number) => {
  canvas.current ??= document.createElement('canvas')

  const context = canvas.current.getContext('2d')

  if (context === null) {
    return (text.length * fontSize) / 2
  }

  context.font = `${fontSize}px sans-serif`

  return context.measureText(text).width
}

const fitEstimate = (text: string, allowed: number, fontSize: number) => {
  const ratio = allowed / Math.max(1, measure(text, fontSize))

  if (ratio >= 1) {
    return 'Fits at full size'
  }

  if (ratio >= 0.75) {
    return `Fits at ${Math.floor(ratio * 100)}% font size`
  }

  if (ratio >= 0.6) {
    return 'Fits only squeezed or on two lines'
  }

  return `Too long by about ${Math.round(measure(text, fontSize * 0.75) - allowed / 0.8)} px`
}

function TooLongBadge() {
  return (
    <span className="ml-1.5 inline-flex h-5 items-center rounded-full bg-tint-amber px-2 align-[1px] text-[11px] font-medium text-tint-amber-foreground">
      Too long
    </span>
  )
}

function FitPreview({ entry, text }: { readonly entry: InGameTextEntry; readonly text: string }) {
  if (entry.allowedWidth === undefined || entry.fontSize === undefined) {
    return null
  }

  const scale = Math.min(1, 260 / entry.allowedWidth)

  return (
    <div className="mt-2.5 rounded-xl bg-card p-2.5">
      <div
        className="overflow-hidden rounded border border-dashed border-warning px-1 whitespace-nowrap"
        style={{ width: entry.allowedWidth * scale, fontSize: entry.fontSize * scale }}
      >
        {text}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {fitEstimate(text, entry.allowedWidth, entry.fontSize)} · {fitLabels[entry.fit]} in the game
      </p>
    </div>
  )
}

function Detail({ game, entry }: { readonly game: Game; readonly entry: InGameTextEntry }) {
  const saveText = useAtomSet(saveInGameTextAtom, { mode: 'promiseExit' })
  const setLocked = useAtomSet(setInGameTextLockedAtom, { mode: 'promiseExit' })
  const shorten = useAtomSet(shortenInGameTextAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(entry.translatedText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const target = { gameId: game.id, origin: entry.origin, key: entry.key }

  const report = async (pending: Promise<Exit.Exit<unknown, unknown>>) => {
    setBusy(true)
    setError(formErrorOf(await pending)?.message)
    setBusy(false)
  }

  const commit = () => {
    if (draft.trim() !== '' && draft.trim() !== entry.translatedText) {
      void report(
        saveText({
          payload: { ...target, translatedText: draft },
          reactivityKeys: inGameTextKeys,
        }),
      )
    }
  }

  const seen = entry.scene === undefined ? 'Seen' : entry.scene

  return (
    <div className="rounded-[18px] bg-muted p-3.5">
      <p className="text-xs text-muted-foreground">
        {seen} · first seen {formatMoment(entry.firstSeenAt).toLowerCase()}
      </p>
      <p className="mt-1.5 mb-2.5 text-[15px]">{entry.key}</p>
      <Input
        aria-label="Translation"
        className="bg-card"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          }
        }}
      />
      <FitPreview entry={entry} text={draft} />
      {error === undefined ? null : <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-1">
        <Button
          variant="outline"
          className="h-8 rounded-full px-4 text-[13px]"
          disabled={busy}
          onClick={() => report(shorten({ payload: target, reactivityKeys: inGameTextKeys }))}
        >
          Shorten
        </Button>
        <Button
          variant="ghost"
          className="h-8 rounded-full px-3 text-[13px]"
          disabled={busy}
          aria-pressed={entry.locked}
          onClick={() =>
            report(
              setLocked({
                payload: { ...target, locked: !entry.locked },
                reactivityKeys: inGameTextKeys,
              }),
            )
          }
        >
          {entry.locked ? <LockSimpleIcon /> : <LockSimpleOpenIcon />}
          {entry.locked ? 'Locked' : 'Lock'}
        </Button>
      </div>
    </div>
  )
}

function OptionsMenu({ game }: { readonly game: Game }) {
  const result = useAtomValue(inGameTextSettingsAtom(game.id))
  const save = useAtomSet(saveInGameTextSettingsAtom)
  const settings = AsyncResult.isSuccess(result) ? result.value : defaultInGameTextSettings

  const change = (next: Partial<InGameTextSettings>) =>
    save({
      payload: { gameId: game.id, settings: { ...settings, ...next } },
      reactivityKeys: settingsKeys(game.id),
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-8 rounded-full px-3">
            <SlidersHorizontalIcon />
            Options
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>When text doesn’t fit</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.whenTooLong}
            onValueChange={(value) => change({ whenTooLong: WhenTooLong.make(value) })}
          >
            {WhenTooLong.literals.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {whenTooLongLabels[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Hold in the game to see the original</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.originalKey}
            onValueChange={(value) => change({ originalKey: OriginalKey.make(value) })}
          >
            {OriginalKey.literals.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {originalKeyLabels[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EntryButton({
  entry,
  selected,
  onSelect,
}: {
  readonly entry: InGameTextEntry
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full flex-col items-start gap-0 rounded-[14px] px-3 py-2 text-left font-normal whitespace-normal',
        selected && 'bg-muted',
      )}
      onClick={onSelect}
    >
      <span className="text-sm">
        {entry.translatedText}
        {entry.fit === 'too-long' ? <TooLongBadge /> : null}
        {entry.locked ? (
          <LockSimpleIcon className="ml-1 inline size-3.5 text-muted-foreground" />
        ) : null}
      </span>
      <span className="text-[13px] text-muted-foreground">{entry.key}</span>
    </Button>
  )
}

export function InGameTextReviewPage({ game }: { readonly game: Game }) {
  const close = useAtomSet(inGameTextReviewAtom)
  const [filter, setFilter] = useState<InGameTextFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const key = listKey(game.id, filter, search)
  const result = useAtomValue(inGameTextsAtom(key))
  const refresh = useAtomRefresh(inGameTextsAtom(key))

  const entries = AsyncResult.isSuccess(result)
    ? result.value.filter((entry) => entry.origin !== 'image')
    : []

  const selected = entries.find((entry) => entryId(entry) === selectedId) ?? entries[0]

  useAtomSubscribe(inGameTextSummaryAtom(game.id), () => refresh())

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="h-8 rounded-full px-3" onClick={() => close(undefined)}>
          <ArrowLeftIcon />
          {game.title}
        </Button>
        <span className="flex-1" />
        <OptionsMenu game={game} />
      </div>

      <h1 className="mt-3 text-[28px] font-semibold tracking-tight">In-game text</h1>
      <p className="mt-1 text-muted-foreground">
        Edits reach the game the next time it draws the text. Locked strings are never translated
        again.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {filters.map((option) => (
          <Button
            key={option.id}
            variant={filter === option.id ? 'default' : 'secondary'}
            className="h-7 rounded-full px-3 text-[13px]"
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </Button>
        ))}
        <span className="flex-1" />
        <InputGroup className="h-8 w-56 rounded-full">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search strings"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </InputGroup>
      </div>

      <section className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3.5 rounded-3xl bg-card p-3 shadow-card">
        {entries.length === 0 ? (
          <p className="col-span-2 p-6 text-center text-muted-foreground">
            {filter === 'all' && search === ''
              ? 'Strings appear here as the game shows them.'
              : 'No strings match.'}
          </p>
        ) : (
          <>
            <ScrollArea className="max-h-[calc(100vh-320px)]">
              <div className="flex flex-col gap-0.5 pr-2">
                {entries.map((entry) => (
                  <EntryButton
                    key={entryId(entry)}
                    entry={entry}
                    selected={selected !== undefined && entryId(entry) === entryId(selected)}
                    onSelect={() => setSelectedId(entryId(entry))}
                  />
                ))}
              </div>
            </ScrollArea>
            {selected === undefined ? null : (
              <Detail
                key={`${entryId(selected)}:${selected.translatedText}`}
                game={game}
                entry={selected}
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}
