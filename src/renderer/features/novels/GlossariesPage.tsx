import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BookOpenTextIcon,
  BooksIcon,
  DotsThreeIcon,
  ExportIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { CreateGlossary, type GlossaryRef, RemoveGlossary, RenameGlossary } from '#contract/Novels'
import { formatDay } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { openGlossaryAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { Input } from '#ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import {
  downloadText,
  exportGlossaryAtom,
  findTermsAtom,
  glossaryShelfAtom,
  kindMeta,
  useGlossaryEdit,
} from './novels'

const columns = 'grid grid-cols-[minmax(0,1fr)_90px_120px_110px_72px] items-center gap-3'

function useExport() {
  const exportGlossary = useAtomSet(exportGlossaryAtom, { mode: 'promiseExit' })

  return async (ref: GlossaryRef, name: string) => {
    const exit = await exportGlossary({ payload: { ref } })

    if (Exit.isSuccess(exit)) {
      downloadText(`${name}.csv`, exit.value)
    }
  }
}

function NameDialog({
  open,
  title,
  initial,
  onOpenChange,
  onSave,
}: {
  readonly open: boolean
  readonly title: string
  readonly initial: string
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (name: string) => Promise<string | undefined>
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | undefined>(undefined)

  const save = async () => {
    const problem = await onSave(name)

    setError(problem)

    if (problem === undefined) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-[22px] p-5 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            A General Glossary holds terms many novels share, such as titles or cultivation realms.
            Pick it for a novel from that novel’s glossary.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Glossary name"
          autoFocus
          placeholder="Xianxia titles"
          value={name}
          className="h-9 rounded-full px-3.5"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void save()
            }
          }}
        />
        {error === undefined ? null : <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="-mx-5 -mb-5 rounded-b-[22px] px-5">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={name.trim() === ''}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Results({ query }: { readonly query: string }) {
  const result = useAtomValue(findTermsAtom(query))
  const open = useAtomSet(openGlossaryAtom)
  const hits = AsyncResult.isSuccess(result) ? result.value : []

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-medium">
        Terms <span className="text-muted-foreground">{hits.length}</span>
      </h2>
      <div className="mt-2 overflow-hidden rounded-[20px] bg-card shadow-card">
        {hits.length === 0 ? (
          <p className="px-[18px] py-4 text-[13px] text-muted-foreground">
            No glossary has that term.
          </p>
        ) : null}
        {hits.map((hit, index) => (
          <Button
            // oxlint-disable-next-line react/no-array-index-key -- a term can appear in several glossaries; the list position tells the rows apart.
            key={`${hit.term.id}:${index}`}
            variant="ghost"
            className="grid h-auto w-full grid-cols-[150px_minmax(0,1fr)_120px_minmax(0,200px)] items-center gap-3 rounded-none border-t px-[18px] py-2.5 text-left font-normal first:border-t-0"
            onClick={() => open(`${hit.ref.kind}:${hit.ref.id}`)}
          >
            <span className="truncate font-serif">{hit.term.original}</span>
            <span className="truncate">{hit.term.translation}</span>
            <span className="flex items-center gap-1.5 text-xs">
              <span
                className="size-2 rounded-full"
                style={{ background: kindMeta[hit.term.kind].color }}
              />
              {kindMeta[hit.term.kind].label}
            </span>
            <span className="truncate text-xs text-muted-foreground">{hit.glossaryName}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

export function GlossariesPage() {
  const shelf = useAtomValue(glossaryShelfAtom)
  const open = useAtomSet(openGlossaryAtom)
  const edit = useGlossaryEdit()
  const exportGlossary = useExport()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const [renaming, setRenaming] = useState<
    { readonly id: string; readonly name: string } | undefined
  >(undefined)

  const general = AsyncResult.isSuccess(shelf) ? shelf.value.general : []
  const novels = AsyncResult.isSuccess(shelf) ? shelf.value.novels : []

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-[28px] font-semibold tracking-tight">Glossaries</h1>
        <InputGroup className="h-9 w-64 rounded-full">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find a term in any glossary"
            placeholder="Find a term in any glossary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <Button className="h-9 rounded-full px-4" onClick={() => setCreating(true)}>
          <PlusIcon />
          New glossary
        </Button>
      </div>
      {query.trim() === '' ? null : <Results query={query.trim()} />}
      <section className="mt-6">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-medium">General</h2>
          <span className="text-xs text-muted-foreground">Shared terms you pick per novel</span>
        </div>
        <div className="mt-2 overflow-hidden rounded-[20px] bg-card shadow-card">
          <div className={`${columns} px-[18px] py-2 text-xs text-muted-foreground`}>
            <span>Name</span>
            <span className="text-right">Terms</span>
            <span>Used by</span>
            <span>Updated</span>
            <span />
          </div>
          {general.length === 0 ? (
            <p className="border-t px-[18px] py-3.5 text-[13px] text-muted-foreground">
              No General Glossaries yet. Make one for terms many novels share.
            </p>
          ) : null}
          {general.map((glossary) => (
            <div key={glossary.id} className={`${columns} border-t px-[18px] py-2 text-[13px]`}>
              <Button
                variant="ghost"
                className="-mx-2 h-auto justify-start gap-2.5 px-2 py-1 font-medium"
                onClick={() => open(`general:${glossary.id}`)}
              >
                <span className="grid size-7 place-items-center rounded-[8px] bg-secondary text-muted-foreground">
                  <BooksIcon />
                </span>
                <span className="truncate">{glossary.name}</span>
              </Button>
              <span className="text-right tabular-nums">{glossary.terms}</span>
              <span className="text-xs text-muted-foreground">
                {glossary.novels === 1 ? '1 novel' : `${glossary.novels} novels`}
              </span>
              <span className="text-xs text-muted-foreground">{formatDay(glossary.updatedAt)}</span>
              <span className="flex justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Export ${glossary.name}`}
                  onClick={() =>
                    void exportGlossary({ kind: 'general', id: glossary.id }, glossary.name)
                  }
                >
                  <ExportIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`More for ${glossary.name}`}
                      />
                    }
                  >
                    <DotsThreeIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem
                      onClick={() => setRenaming({ id: glossary.id, name: glossary.name })}
                    >
                      <PencilSimpleIcon />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void edit(RemoveGlossary.make({ glossaryId: glossary.id }))}
                    >
                      <TrashIcon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-6">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-medium">Novels</h2>
          <span className="text-xs text-muted-foreground">
            One glossary per novel, made as you read
          </span>
        </div>
        <div className="mt-2 overflow-hidden rounded-[20px] bg-card shadow-card">
          <div className={`${columns} px-[18px] py-2 text-xs text-muted-foreground`}>
            <span>Name</span>
            <span className="text-right">Terms</span>
            <span>To review</span>
            <span>Updated</span>
            <span />
          </div>
          {novels.length === 0 ? (
            <p className="border-t px-[18px] py-3.5 text-[13px] text-muted-foreground">
              Each novel you add gets its own glossary.
            </p>
          ) : null}
          {novels.map((novel) => (
            <div key={novel.novelId} className={`${columns} border-t px-[18px] py-2 text-[13px]`}>
              <Button
                variant="ghost"
                className="-mx-2 h-auto min-w-0 justify-start gap-2.5 px-2 py-1 font-medium"
                onClick={() => open(`novel:${novel.novelId}`)}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-secondary text-muted-foreground">
                  <BookOpenTextIcon />
                </span>
                <span className="truncate">{novel.title}</span>
                {novel.originalTitle === novel.title ? null : (
                  <span className="truncate font-serif text-xs font-normal text-muted-foreground">
                    {novel.originalTitle}
                  </span>
                )}
              </Button>
              <span className="text-right tabular-nums">{novel.terms}</span>
              <span
                className={
                  novel.toReview > 0 ? 'text-xs text-info' : 'text-xs text-muted-foreground'
                }
              >
                {novel.toReview > 0 ? `${novel.toReview} new` : '—'}
              </span>
              <span className="text-xs text-muted-foreground">{formatDay(novel.updatedAt)}</span>
              <span className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Export ${novel.title}`}
                  onClick={() =>
                    void exportGlossary({ kind: 'novel', id: novel.novelId }, novel.title)
                  }
                >
                  <ExportIcon />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </section>
      {creating ? (
        <NameDialog
          open
          title="New glossary"
          initial=""
          onOpenChange={setCreating}
          onSave={async (name) => {
            const exit = await edit(CreateGlossary.make({ name }))

            if (Exit.isSuccess(exit) && exit.value !== null) {
              open(`general:${exit.value}`)

              return undefined
            }

            return formErrorOf(exit)?.message ?? 'The glossary could not be made.'
          }}
        />
      ) : null}
      {renaming === undefined ? null : (
        <NameDialog
          open
          title="Rename glossary"
          initial={renaming.name}
          onOpenChange={(next) => {
            if (!next) {
              setRenaming(undefined)
            }
          }}
          onSave={async (name) => {
            const exit = await edit(RenameGlossary.make({ glossaryId: renaming.id, name }))

            return Exit.isSuccess(exit) ? undefined : formErrorOf(exit)?.message
          }}
        />
      )}
    </div>
  )
}
