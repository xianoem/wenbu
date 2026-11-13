import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BooksIcon,
  CaretDownIcon,
  CaretLeftIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  AcceptTerms,
  AddNovelTerm,
  AddTerm,
  DismissTerm,
  type GlossaryEdit,
  type GlossaryPage as Page,
  type GlossaryRef,
  type GlossaryTerm,
  PickGlossaries,
  RemoveTerm,
  type ScanProgress,
  type TermKind,
  UpdateNovelTerm,
  UpdateTerm,
} from '#contract/Novels'
import { formErrorOf } from '#lib/forms'
import { openGlossaryAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Checkbox } from '#ui/checkbox'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Spinner } from '#ui/spinner'
import { NovelCover } from './components/NovelCover'
import {
  glossaryPageAtom,
  kindMeta,
  scanTermsAtom,
  termKinds,
  tintOf,
  useGlossaryEdit,
} from './novels'

const bannerTints = {
  amber: 'from-tint-amber',
  violet: 'from-tint-violet',
  teal: 'from-tint-teal',
  slate: 'from-tint-slate',
}

type Filter = 'all' | 'review' | TermKind

type Draft = {
  readonly original: string
  readonly translation: string
  readonly note: string
  readonly kind: TermKind
  readonly gender: 'm' | 'f' | null
}

const blankDraft: Draft = {
  original: '',
  translation: '',
  note: '',
  kind: 'character',
  gender: null,
}

const draftOf = (term: GlossaryTerm): Draft => ({
  original: term.original,
  translation: term.translation,
  note: term.note ?? '',
  kind: term.kind,
  gender: term.gender,
})

const fieldsOf = (draft: Draft) => ({
  original: draft.original.trim(),
  translation: draft.translation.trim(),
  kind: draft.kind,
  gender: draft.kind === 'character' ? draft.gender : null,
  note: draft.note.trim() === '' ? null : draft.note.trim(),
})

const editsFor = (ref: GlossaryRef) => {
  if (ref.kind === 'novel') {
    return {
      add: (draft: Draft): GlossaryEdit =>
        AddNovelTerm.make({ novelId: ref.id, ...fieldsOf(draft) }),
      update: (term: GlossaryTerm, draft: Draft): GlossaryEdit =>
        UpdateNovelTerm.make({ novelId: ref.id, termId: term.id, ...fieldsOf(draft) }),
      remove: (term: GlossaryTerm): GlossaryEdit =>
        DismissTerm.make({ novelId: ref.id, termId: term.id }),
      accept: (terms: ReadonlyArray<GlossaryTerm>): GlossaryEdit =>
        AcceptTerms.make({ novelId: ref.id, termIds: terms.map((term) => term.id) }),
    }
  }

  return {
    add: (draft: Draft): GlossaryEdit => AddTerm.make({ glossaryId: ref.id, ...fieldsOf(draft) }),
    update: (term: GlossaryTerm, draft: Draft): GlossaryEdit =>
      UpdateTerm.make({ glossaryId: ref.id, termId: term.id, ...fieldsOf(draft) }),
    remove: (term: GlossaryTerm): GlossaryEdit =>
      RemoveTerm.make({ glossaryId: ref.id, termId: term.id }),
    accept: undefined,
  }
}

const genderSign = (gender: GlossaryTerm['gender']) => {
  if (gender === 'm') {
    return '♂'
  }

  if (gender === 'f') {
    return '♀'
  }

  return null
}

const scanLines: Record<ScanProgress['stage'], (progress: ScanProgress) => string> = {
  reading: (progress) => `Reading chapters ${progress.done} of ${progress.total}`,
  finding: () => 'Finding names and terms',
  checking: (progress) => `Checking candidates ${progress.done} of ${progress.total}`,
  done: (progress) => `Scan done: ${progress.found} new terms to review`,
  failed: (progress) => progress.message ?? 'The scan failed.',
}

function Pills<A extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string
  readonly options: ReadonlyArray<{
    readonly value: A
    readonly label: string
    readonly color?: string
  }>
  readonly value: A | null
  readonly onChange: (value: A) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          variant={option.value === value ? 'default' : 'secondary'}
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
          onClick={() => onChange(option.value)}
        >
          {option.color === undefined ? null : (
            <span className="size-2 rounded-full" style={{ background: option.color }} />
          )}
          {option.label}
        </Button>
      ))}
    </div>
  )
}

function TermEditor({
  term,
  edits,
  onClose,
}: {
  readonly term: GlossaryTerm | undefined
  readonly edits: ReturnType<typeof editsFor>
  readonly onClose: () => void
}) {
  const edit = useGlossaryEdit()
  const [draft, setDraft] = useState(term === undefined ? blankDraft : draftOf(term))
  const [error, setError] = useState<string | undefined>(undefined)
  const set = (change: Partial<Draft>) => setDraft((before) => ({ ...before, ...change }))
  const renames = term !== undefined && term.translation !== draft.translation.trim()

  const send = async (change: GlossaryEdit, then?: GlossaryEdit) => {
    const exit = await edit(change)

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message ?? 'The term could not be saved.')

      return
    }

    if (then === undefined) {
      onClose()

      return
    }

    await send(then)
  }

  const save = () => {
    if (term === undefined) {
      return send(edits.add(draft))
    }

    const accept = term.suggested ? edits.accept?.([term]) : undefined

    return send(edits.update(term, draft), accept)
  }

  return (
    <div className="flex flex-col gap-3 bg-secondary/40 px-[18px] py-3.5">
      <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
        {term === undefined ? (
          <Input
            aria-label="Original"
            autoFocus
            placeholder="Original"
            value={draft.original}
            className="h-8 rounded-[10px] font-serif"
            onChange={(event) => set({ original: event.target.value })}
          />
        ) : (
          <div className="flex flex-col justify-center">
            <span className="font-serif text-[15px]">{term.original}</span>
            {term.reading === null ? null : (
              <span className="text-xs text-muted-foreground italic">{term.reading}</span>
            )}
          </div>
        )}
        <Input
          aria-label="Translation"
          autoFocus={term !== undefined}
          placeholder="Translation"
          value={draft.translation}
          className="h-8 rounded-[10px]"
          onChange={(event) => set({ translation: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void save()
            }

            if (event.key === 'Escape') {
              onClose()
            }
          }}
        />
      </div>
      <Input
        aria-label="Note"
        placeholder="Note for the translator, such as who this is"
        value={draft.note}
        className="h-8 rounded-[10px]"
        onChange={(event) => set({ note: event.target.value })}
      />
      <Pills
        label="Kind"
        options={termKinds.map((kind) => ({
          value: kind,
          label: kindMeta[kind].label,
          color: kindMeta[kind].color,
        }))}
        value={draft.kind}
        onChange={(kind) => set({ kind })}
      />
      {draft.kind === 'character' ? (
        <Pills
          label="Gender"
          options={[
            { value: 'm', label: '♂ Male' },
            { value: 'f', label: '♀ Female' },
          ]}
          value={draft.gender}
          onChange={(gender) => set({ gender: gender === draft.gender ? null : gender })}
        />
      ) : null}
      {error === undefined ? null : <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          {renames ? `Saving renames “${term.translation}” in translated chapters.` : ''}
        </span>
        {term === undefined ? null : (
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 text-destructive hover:text-destructive"
            onClick={() => void send(edits.remove(term))}
          >
            {term.suggested ? 'Dismiss' : 'Remove'}
          </Button>
        )}
        <Button variant="ghost" className="h-8 rounded-full px-3" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="h-8 rounded-full px-4"
          disabled={draft.original.trim() === '' || draft.translation.trim() === ''}
          onClick={() => void save()}
        >
          {term?.suggested === true ? 'Keep' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function TermRow({ term, onOpen }: { readonly term: GlossaryTerm; readonly onOpen: () => void }) {
  const first = term.chapters.length === 0 ? null : Math.min(...term.chapters)

  return (
    <Button
      variant="ghost"
      className="grid h-auto w-full grid-cols-[150px_minmax(0,1fr)_70px_56px] items-center gap-3 rounded-none px-[18px] py-2.5 text-left font-normal"
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-serif text-[15px]">{term.original}</span>
        {term.reading === null ? null : (
          <span className="truncate text-xs text-muted-foreground italic">{term.reading}</span>
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate">
          {term.translation}
          {genderSign(term.gender) === null ? null : (
            <span className="text-xs text-muted-foreground">{genderSign(term.gender)}</span>
          )}
          {term.suggested ? (
            <span className="rounded-full bg-info/15 px-1.5 text-[11px] text-info">new</span>
          ) : null}
        </span>
        {term.note === null ? null : (
          <span className="truncate text-xs text-muted-foreground">{term.note}</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{first === null ? '' : `ch. ${first}`}</span>
      <span className="text-right text-xs text-muted-foreground tabular-nums">
        {term.count > 0 ? `${term.count}×` : ''}
      </span>
    </Button>
  )
}

function ScanStatus({ scanKey }: { readonly scanKey: `${string}|${number}|${number}` }) {
  const result = useAtomValue(scanTermsAtom(scanKey))

  if (!AsyncResult.isSuccess(result)) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Starting the scan
      </span>
    )
  }

  const progress = result.value
  const running = progress.stage !== 'done' && progress.stage !== 'failed'

  return (
    <span
      className={cn(
        'flex items-center gap-2 text-xs',
        progress.stage === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {running ? <Spinner className="size-3" /> : null}
      {scanLines[progress.stage](progress)}
    </span>
  )
}

function ScanButton({ onScan }: { readonly onScan: (chapters: number) => void }) {
  const [open, setOpen] = useState(false)
  const [chapters, setChapters] = useState('50')
  const count = Number.parseInt(chapters, 10)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="secondary" className="h-9 rounded-full px-4" />}>
        <MagnifyingGlassIcon />
        Scan
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[300px] flex-col gap-3 rounded-[20px] p-4">
        <div>
          <div className="font-medium">Scan for terms</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Reads the first chapters for names and terms, and asks the model to translate them. They
            wait here for review.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          First
          <Input
            aria-label="Chapters to scan"
            inputMode="numeric"
            value={chapters}
            className="h-8 w-16 rounded-[10px] text-center tabular-nums"
            onChange={(event) => setChapters(event.target.value)}
          />
          chapters
        </div>
        <Button
          className="h-8 rounded-full"
          disabled={!Number.isInteger(count) || count < 1}
          onClick={() => {
            onScan(count)
            setOpen(false)
          }}
        >
          Start scan
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function PicksPopover({ page }: { readonly page: Page }) {
  const edit = useGlossaryEdit()
  const picked = page.picks.filter((pick) => pick.picked)

  const toggle = (id: string, on: boolean) =>
    void edit(
      PickGlossaries.make({
        novelId: page.ref.id,
        glossaryIds: on
          ? [...picked.map((pick) => pick.id), id]
          : picked.filter((pick) => pick.id !== id).map((pick) => pick.id),
      }),
    )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto gap-1 rounded-full px-1.5 py-0 font-normal text-muted-foreground"
          />
        }
      >
        {picked.length === 0
          ? 'no General Glossary'
          : `also uses ${picked.map((pick) => pick.name).join(', ')}`}
        <CaretDownIcon className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[280px] flex-col gap-2 rounded-[20px] p-3">
        <div className="px-1 font-medium">General Glossaries</div>
        {page.picks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            Make one on the Glossaries page for terms many novels share.
          </p>
        ) : null}
        {page.picks.map((pick) => (
          <label
            key={pick.id}
            className="flex items-center gap-2.5 rounded-[10px] px-1 py-1 text-[13px]"
          >
            <Checkbox checked={pick.picked} onCheckedChange={(on) => toggle(pick.id, on)} />
            <span className="flex-1 truncate">{pick.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{pick.terms}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({
  active,
  label,
  count,
  color,
  onClick,
}: {
  readonly active: boolean
  readonly label: string
  readonly count: number
  readonly color?: string
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-8 justify-start gap-2 rounded-full px-3 font-normal',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground',
      )}
      onClick={onClick}
    >
      {color === undefined ? null : (
        <span className="size-2 rounded-full" style={{ background: color }} />
      )}
      <span className="flex-1 text-left">{label}</span>
      <span className="text-xs tabular-nums">{count}</span>
    </Button>
  )
}

function GlossaryView({ page }: { readonly page: Page }) {
  const openGlossary = useAtomSet(openGlossaryAtom)
  const edit = useGlossaryEdit()
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const [scan, setScan] = useState<{ readonly chapters: number; readonly n: number } | undefined>(
    undefined,
  )

  const edits = editsFor(page.ref)
  const isNovel = page.ref.kind === 'novel'
  const toReview = page.terms.filter((term) => term.suggested)

  const shown = page.terms.filter((term) => {
    if (filter === 'all') {
      return true
    }

    if (filter === 'review') {
      return term.suggested
    }

    return term.kind === filter
  })

  const sections = termKinds
    .map((kind) => ({ kind, terms: shown.filter((term) => term.kind === kind) }))
    .filter((section) => section.terms.length > 0)

  const originalName =
    page.originalName === null || page.originalName === page.name ? null : page.originalName

  const facts = [
    page.terms.length === 1 ? '1 term' : `${page.terms.length} terms`,
    isNovel ? null : `used by ${page.novels === 1 ? '1 novel' : `${page.novels} novels`}`,
  ].filter((part) => part !== null)

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'relative -mx-10 -mt-7 h-[190px] overflow-hidden bg-linear-160 to-background to-85%',
          bannerTints[isNovel ? tintOf(page.ref.id) : 'slate'],
        )}
      >
        <Button
          variant="ghost"
          className="absolute top-4 left-6 h-7 gap-1.5 rounded-full px-2 text-[13px] font-normal text-foreground/80"
          onClick={() => openGlossary(undefined)}
        >
          <CaretLeftIcon />
          Glossaries
        </Button>
      </div>
      <div className="relative -mt-[100px] flex items-end gap-5">
        {isNovel ? (
          <NovelCover
            id={page.ref.id}
            title={page.originalName ?? page.name}
            className="h-[128px] w-[92px] shrink-0 rounded-[14px] shadow-card"
            size="text-base"
          />
        ) : (
          <div className="grid h-[92px] w-[92px] shrink-0 place-items-center rounded-[20px] bg-card text-muted-foreground shadow-card">
            <BooksIcon className="size-9" />
          </div>
        )}
        <div className="min-w-0 flex-1 pb-1">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {isNovel ? 'Novel glossary' : 'General glossary'}
          </div>
          <h1 className="mt-0.5 truncate text-[28px] leading-tight font-semibold tracking-tight">
            {page.name}
          </h1>
          <div className="mt-1 flex items-center gap-1.5 truncate text-muted-foreground">
            {originalName === null ? null : (
              <>
                <span className="font-serif">{originalName}</span>
                <span>·</span>
              </>
            )}
            <span>{facts.join(' · ')}</span>
            {isNovel ? (
              <>
                <span>·</span>
                <PicksPopover page={page} />
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {isNovel ? (
            <ScanButton
              onScan={(chapters) => setScan((before) => ({ chapters, n: (before?.n ?? 0) + 1 }))}
            />
          ) : null}
          <Button
            className="h-9 rounded-full px-4"
            onClick={() => {
              setFilter('all')
              setEditing('new')
            }}
          >
            <PlusIcon />
            Add term
          </Button>
        </div>
      </div>
      {scan === undefined ? null : (
        <div className="mt-4 rounded-full bg-card px-4 py-2 shadow-card">
          <ScanStatus scanKey={`${page.ref.id}|${scan.chapters}|${scan.n}`} />
        </div>
      )}
      {toReview.length === 0 ? null : (
        <div className="mt-4 flex items-center gap-3 rounded-[18px] bg-info/10 px-4 py-2.5">
          <SparkleIcon className="shrink-0 text-info" />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            <span className="font-medium">
              {toReview.length === 1 ? '1 new term' : `${toReview.length} new terms`}
            </span>
            <span className="text-muted-foreground"> found by the scan and while reading: </span>
            <span className="font-serif">
              {toReview
                .slice(0, 6)
                .map((term) => term.original)
                .join(' · ')}
              {toReview.length > 6 ? ' …' : ''}
            </span>
          </span>
          {edits.accept === undefined ? null : (
            <Button
              variant="ghost"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => void edit(edits.accept(toReview))}
            >
              Keep all
            </Button>
          )}
          <Button
            variant="secondary"
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setFilter('review')}
          >
            Review
          </Button>
        </div>
      )}
      <div className="mt-6 grid grid-cols-[180px_minmax(0,1fr)] items-start gap-6">
        <nav aria-label="Kinds" className="flex flex-col gap-0.5">
          <MenuItem
            active={filter === 'all'}
            label="All"
            count={page.terms.length}
            onClick={() => setFilter('all')}
          />
          {toReview.length === 0 ? null : (
            <MenuItem
              active={filter === 'review'}
              label="To review"
              count={toReview.length}
              color="var(--info)"
              onClick={() => setFilter('review')}
            />
          )}
          {termKinds.map((kind) => (
            <MenuItem
              key={kind}
              active={filter === kind}
              label={kindMeta[kind].plural}
              count={page.terms.filter((term) => term.kind === kind).length}
              color={kindMeta[kind].color}
              onClick={() => setFilter(kind)}
            />
          ))}
        </nav>
        <div className="flex flex-col gap-5">
          {editing === 'new' ? (
            <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
              <TermEditor term={undefined} edits={edits} onClose={() => setEditing(undefined)} />
            </div>
          ) : null}
          {sections.length === 0 && editing !== 'new' ? (
            <p className="rounded-[20px] bg-card px-[18px] py-4 text-[13px] text-muted-foreground shadow-card">
              {isNovel
                ? 'No terms yet. Scan the first chapters, or add terms as you read.'
                : 'No terms yet. Add the ones many novels share.'}
            </p>
          ) : null}
          {sections.map((section) => (
            <section key={section.kind}>
              <h2 className="flex items-center gap-2 px-1 text-[13px] font-medium">
                <span
                  className="size-2 rounded-full"
                  style={{ background: kindMeta[section.kind].color }}
                />
                {kindMeta[section.kind].plural}
                <span className="text-muted-foreground">{section.terms.length}</span>
              </h2>
              <div className="mt-2 divide-y overflow-hidden rounded-[20px] bg-card shadow-card">
                {section.terms.map((term) =>
                  editing === term.id ? (
                    <TermEditor
                      key={term.id}
                      term={term}
                      edits={edits}
                      onClose={() => setEditing(undefined)}
                    />
                  ) : (
                    <TermRow key={term.id} term={term} onOpen={() => setEditing(term.id)} />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export function GlossaryPage({
  glossaryKey,
}: {
  readonly glossaryKey: `${'novel' | 'general'}:${string}`
}) {
  const result = useAtomValue(glossaryPageAtom(glossaryKey))
  const openGlossary = useAtomSet(openGlossaryAtom)

  if (AsyncResult.isSuccess(result)) {
    return <GlossaryView page={result.value} />
  }

  if (AsyncResult.isFailure(result)) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">This glossary is gone.</p>
        <Button
          variant="secondary"
          className="rounded-full"
          onClick={() => openGlossary(undefined)}
        >
          Back to Glossaries
        </Button>
      </div>
    )
  }

  return null
}
