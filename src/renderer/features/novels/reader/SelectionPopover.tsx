import { useAtomSet } from '@effect/atom-react'
import { CopyIcon, LightbulbIcon, PlusIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { useEffect, useRef, useState } from 'react'
import type { Explanation, TermKind } from '#contract/Novels'
import { formatUsd } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Spinner } from '#ui/spinner'
import { AddNovelTerm } from '#contract/Novels'
import { explainTextAtom, useGlossaryEdit } from '../novels'

export interface SelectedText {
  readonly text: string
  readonly top: number
  readonly left: number
}

type Mode = 'menu' | 'explain' | 'term'

const kinds: ReadonlyArray<{ readonly kind: TermKind; readonly label: string }> = [
  { kind: 'character', label: 'Character' },
  { kind: 'place', label: 'Place' },
  { kind: 'sect', label: 'Sect' },
  { kind: 'technique', label: 'Technique' },
  { kind: 'item', label: 'Item' },
  { kind: 'concept', label: 'Concept' },
  { kind: 'other', label: 'Other' },
]

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <>
      <span className="self-center text-[13px] text-muted-foreground">{label}</span>
      {children}
    </>
  )
}

export function SelectionPopover({
  novelId,
  chapter,
  selected,
  onClose,
  onTermAdded,
}: {
  readonly novelId: string
  readonly chapter: number
  readonly selected: SelectedText
  readonly onClose: () => void
  readonly onTermAdded: () => void
}) {
  const explain = useAtomSet(explainTextAtom, { mode: 'promiseExit' })
  const addTerm = useGlossaryEdit()
  const panel = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [explanation, setExplanation] = useState<Explanation | undefined>(undefined)
  const [original, setOriginal] = useState(selected.text)
  const [translation, setTranslation] = useState('')
  const [kind, setKind] = useState<TermKind>('character')
  const [gender, setGender] = useState<'m' | 'f' | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        panel.current !== null &&
        event.target instanceof Node &&
        !panel.current.contains(event.target)
      ) {
        onClose()
      }
    }

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)

    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const openExplain = async () => {
    setMode('explain')

    if (explanation !== undefined) {
      return
    }

    setBusy(true)
    setError(undefined)

    const exit = await explain({ payload: { novelId, number: chapter, text: selected.text } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setExplanation(exit.value)
      setTranslation((current) => (current === '' ? (exit.value.translation ?? '') : current))
      setKind((current) => exit.value.kind ?? current)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const save = async () => {
    setBusy(true)
    setError(undefined)

    const exit = await addTerm(
      AddNovelTerm.make({
        novelId,
        original: original.trim(),
        translation: translation.trim(),
        kind,
        gender: kind === 'character' ? gender : null,
        note: note.trim() === '' ? null : note.trim(),
        reading: explanation?.reading ?? null,
      }),
    )

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      onTermAdded()
      onClose()

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const actions = [
    { id: 'explain', label: 'Explain', Icon: LightbulbIcon, run: () => void openExplain() },
    { id: 'term', label: 'Create term', Icon: PlusIcon, run: () => setMode('term') },
    {
      id: 'copy',
      label: 'Copy',
      Icon: CopyIcon,
      run: () => {
        void navigator.clipboard.writeText(selected.text)
        onClose()
      },
    },
  ] as const

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Selected text"
      className={cn(
        'absolute z-20 rounded-[20px] bg-card p-1 font-sans text-sm text-foreground shadow-card',
        mode === 'menu' ? 'w-auto rounded-full' : 'w-[340px] p-2',
      )}
      style={{ top: selected.top, left: selected.left }}
    >
      <div className="flex gap-1">
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={mode === action.id ? 'default' : 'ghost'}
            className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
            onClick={action.run}
          >
            <action.Icon />
            {action.label}
          </Button>
        ))}
      </div>
      {mode === 'explain' ? (
        <div className="px-2 pt-3 pb-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-lg">{selected.text}</span>
            {explanation?.reading === null || explanation === undefined ? null : (
              <span className="text-xs text-muted-foreground">{explanation.reading}</span>
            )}
          </div>
          {busy ? <Spinner className="mt-2 size-4" /> : null}
          {explanation === undefined ? null : (
            <>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">
                {explanation.text}
              </p>
              {explanation.chapters.length === 0 ? null : (
                <div className="mt-2 text-xs text-muted-foreground">
                  Also in chapters {explanation.chapters.join(', ')}.
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <span className="flex-1 text-[11px] text-muted-foreground">
                  {explanation.costUsd === null ? '' : formatUsd(explanation.costUsd)}
                </span>
                <Button
                  variant="secondary"
                  className="h-7 gap-1.5 rounded-full px-3 text-xs"
                  onClick={() => setMode('term')}
                >
                  <PlusIcon />
                  Create term
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {mode === 'term' ? (
        <div className="px-2 pt-3 pb-1.5">
          <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-2.5">
            <Field label="Original">
              <Input
                aria-label="Original"
                value={original}
                className="h-8 rounded-[10px] font-serif"
                onChange={(event) => setOriginal(event.target.value)}
              />
            </Field>
            <Field label="Translation">
              <Input
                aria-label="Translation"
                autoFocus
                value={translation}
                className="h-8 rounded-[10px]"
                onChange={(event) => setTranslation(event.target.value)}
              />
            </Field>
            <span className="pt-1 text-[13px] text-muted-foreground">Kind</span>
            <span className="flex flex-wrap gap-1">
              {kinds.map((choice) => (
                <Button
                  key={choice.kind}
                  variant={kind === choice.kind ? 'default' : 'secondary'}
                  className="h-6 rounded-full px-2 text-xs font-normal"
                  onClick={() => setKind(choice.kind)}
                >
                  {choice.label}
                </Button>
              ))}
            </span>
            {kind === 'character' ? (
              <>
                <span className="self-center text-[13px] text-muted-foreground">Gender</span>
                <span className="flex gap-1">
                  {(['m', 'f'] as const).map((value) => (
                    <Button
                      key={value}
                      variant={gender === value ? 'default' : 'secondary'}
                      className="h-6 rounded-full px-2.5 text-xs font-normal"
                      onClick={() => setGender(gender === value ? null : value)}
                    >
                      {value === 'm' ? 'Male' : 'Female'}
                    </Button>
                  ))}
                </span>
              </>
            ) : null}
            <Field label="Note">
              <Input
                aria-label="Note"
                placeholder="Optional"
                value={note}
                className="h-8 rounded-[10px]"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              Used from the next translation on
            </span>
            <Button variant="ghost" className="h-7 rounded-full px-3 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="h-7 rounded-full px-3 text-xs"
              disabled={busy || original.trim() === '' || translation.trim() === ''}
              onClick={() => void save()}
            >
              Add to glossary
            </Button>
          </div>
        </div>
      ) : null}
      {error === undefined ? null : <p className="px-2 pb-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
