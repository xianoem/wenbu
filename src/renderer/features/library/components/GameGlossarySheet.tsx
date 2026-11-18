import { useAtomSet } from '@effect/atom-react'
import { ArrowsClockwiseIcon, PlusIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useState } from 'react'
import type {
  GameGlossary,
  GameGlossaryEntry,
  GlossaryEntryKind,
  GlossaryEstimate,
} from '#contract/GameGlossary'
import { formErrorOf } from '#lib/forms'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#ui/alert-dialog'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { ScrollArea } from '#ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#ui/sheet'
import { Textarea } from '#ui/textarea'
import { extraText, speakerLabel } from '../glossaryText'
import {
  formatUsd,
  glossaryKeys,
  removeGameGlossaryEntryAtom,
  saveGameGlossaryEntryAtom,
  translationKeys,
} from '../library'

interface Tab {
  readonly key: string
  readonly label: string
  readonly kinds: ReadonlyArray<GlossaryEntryKind>
  readonly adds: GlossaryEntryKind
}

const characters: Tab = {
  key: 'characters',
  label: 'Characters',
  kinds: ['character'],
  adds: 'character',
}

const tabs: ReadonlyArray<Tab> = [
  characters,
  { key: 'places', label: 'Places', kinds: ['place'], adds: 'place' },
  { key: 'items', label: 'Items & skills', kinds: ['item', 'skill'], adds: 'item' },
  { key: 'other', label: 'Other', kinds: ['other'], adds: 'other' },
]

const refreshKeys = [...glossaryKeys, ...translationKeys]

const inTab = (tab: Tab, entry: GameGlossaryEntry) => tab.kinds.includes(entry.kind)

const recognisedBy = (entry: GameGlossaryEntry) =>
  entry.speakers.length === 0
    ? 'Recognised by the name in the text'
    : `Recognised by ${entry.speakers.map((key) => speakerLabel(key)).join(', ')}`

function EntryEditor({
  gameId,
  entry,
  kind,
  onClose,
}: {
  readonly gameId: string
  readonly entry: GameGlossaryEntry | undefined
  readonly kind: GlossaryEntryKind
  readonly onClose: () => void
}) {
  const save = useAtomSet(saveGameGlossaryEntryAtom, { mode: 'promiseExit' })
  const remove = useAtomSet(removeGameGlossaryEntryAtom, { mode: 'promiseExit' })
  const [original, setOriginal] = useState(entry?.original ?? '')
  const [translation, setTranslation] = useState(entry?.translation ?? '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const character = (entry?.kind ?? kind) === 'character'

  const finish = (exit: Exit.Exit<unknown, unknown>) => {
    setSaving(false)

    if (Exit.isSuccess(exit)) {
      onClose()

      return
    }

    setError(formErrorOf(exit)?.message ?? 'The entry could not be saved. Try again.')
  }

  const submit = async () => {
    setSaving(true)

    finish(
      await save({
        payload: {
          gameId,
          ...(entry === undefined ? {} : { id: entry.id }),
          entry: { kind: entry?.kind ?? kind, original, translation, note },
        },
        reactivityKeys: refreshKeys,
      }),
    )
  }

  const discard = async () => {
    if (entry === undefined) {
      return
    }

    setSaving(true)
    finish(await remove({ payload: { gameId, id: entry.id }, reactivityKeys: refreshKeys }))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-2.5">
      <div className="flex items-center gap-2">
        {entry === undefined ? (
          <Input
            aria-label="Original"
            placeholder="Original"
            className="h-8 w-32 rounded-[10px]"
            value={original}
            onChange={(event) => setOriginal(event.target.value)}
          />
        ) : (
          <span className="w-32 truncate text-[15px]" lang="ja">
            {entry.original}
          </span>
        )}
        <Input
          aria-label="English"
          placeholder="English"
          className="h-8 flex-1 rounded-[10px]"
          value={translation}
          onChange={(event) => setTranslation(event.target.value)}
        />
      </div>
      <Textarea
        aria-label={character ? 'How they talk' : 'Note'}
        placeholder={character ? 'How they talk' : 'Note, if the use is not obvious'}
        className="min-h-16 rounded-[10px]"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error === undefined ? null : <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          {[
            ...(entry === undefined ? [] : [`${entry.lines.toLocaleString('en-US')} lines`]),
            ...(entry !== undefined && character ? [recognisedBy(entry)] : []),
          ].join(' · ')}
        </span>
        {entry === undefined ? null : (
          <Button
            variant="ghost"
            className="h-7 rounded-full px-3 text-[13px] font-normal text-destructive hover:text-destructive"
            disabled={saving}
            onClick={() => void discard()}
          >
            Remove
          </Button>
        )}
        <Button
          variant="ghost"
          className="h-7 rounded-full px-3 text-[13px] font-normal"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="h-7 rounded-full px-3 text-[13px]"
          disabled={saving}
          onClick={() => void submit()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  onEdit,
}: {
  readonly entry: GameGlossaryEntry
  readonly onEdit: () => void
}) {
  return (
    <Button
      variant="ghost"
      className="h-auto w-full flex-col items-stretch gap-0.5 rounded-xl px-2.5 py-2 text-left font-normal whitespace-normal"
      onClick={onEdit}
    >
      <span className="flex items-baseline gap-2">
        <span className="font-medium">{entry.translation}</span>
        <span className="truncate text-[13px] text-muted-foreground" lang="ja">
          {entry.original}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {entry.lines.toLocaleString('en-US')} lines
        </span>
      </span>
      {entry.note === '' ? null : (
        <span className="text-[13px] text-muted-foreground">{entry.note}</span>
      )}
    </Button>
  )
}

const descriptionOf = (title: string, glossary: GameGlossary) =>
  glossary.costUsd === undefined
    ? `${title}. Edits reach lines translated after them.`
    : `${title} · prepared for ${formatUsd(glossary.costUsd)}. Edits reach lines translated after them.`

export function GameGlossarySheet({
  title,
  glossary,
  estimate,
  open,
  busy,
  onOpenChange,
  onPrepareAgain,
}: {
  readonly title: string
  readonly glossary: GameGlossary
  readonly estimate: GlossaryEstimate | undefined
  readonly open: boolean
  readonly busy: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPrepareAgain: () => void
}) {
  const [tab, setTab] = useState<Tab>(characters)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const entries = glossary.entries.filter((entry) => inTab(tab, entry))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[520px] gap-0 data-[side=right]:sm:max-w-[520px]">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle>Game glossary</SheetTitle>
          <SheetDescription>{descriptionOf(title, glossary)}</SheetDescription>
          {estimate === undefined || !glossary.enabled ? null : (
            <SheetDescription>Adds about {extraText(estimate)} to a run.</SheetDescription>
          )}
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {tabs.map((option) => (
            <Button
              key={option.key}
              variant={option.key === tab.key ? 'default' : 'secondary'}
              aria-pressed={option.key === tab.key}
              className="h-7 rounded-full px-3 text-[13px] font-normal"
              onClick={() => {
                setTab(option)
                setEditing(undefined)
              }}
            >
              {option.label} {glossary.entries.filter((entry) => inTab(option, entry)).length}
            </Button>
          ))}
        </div>

        <ScrollArea className="min-h-0 flex-1 px-3">
          <div className="flex flex-col gap-0.5 pb-3">
            {editing === 'new' ? (
              <EntryEditor
                gameId={glossary.gameId}
                entry={undefined}
                kind={tab.adds}
                onClose={() => setEditing(undefined)}
              />
            ) : null}
            {entries.map((entry) =>
              editing === entry.id ? (
                <EntryEditor
                  key={entry.id}
                  gameId={glossary.gameId}
                  entry={entry}
                  kind={entry.kind}
                  onClose={() => setEditing(undefined)}
                />
              ) : (
                <EntryRow key={entry.id} entry={entry} onEdit={() => setEditing(entry.id)} />
              ),
            )}
            {entries.length === 0 && editing !== 'new' ? (
              <p className="px-2.5 py-4 text-[13px] text-muted-foreground">Nothing here yet.</p>
            ) : null}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 border-t px-5 py-3.5">
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 font-normal text-muted-foreground"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <ArrowsClockwiseIcon />
            Prepare again
          </Button>
          <span className="flex-1" />
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3 font-normal"
            onClick={() => setEditing('new')}
          >
            <PlusIcon />
            Add
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prepare the glossary again?</AlertDialogTitle>
            <AlertDialogDescription>
              Wenbu reads the game again and replaces this glossary, with your edits.
              {glossary.costUsd === undefined
                ? ''
                : ` Last time it cost ${formatUsd(glossary.costUsd)}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                onOpenChange(false)
                onPrepareAgain()
              }}
            >
              Prepare again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
