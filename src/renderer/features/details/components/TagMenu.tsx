import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { CheckIcon, MagnifyingGlassIcon, TagIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { Genre } from '#contract/Details'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Spinner } from '#ui/spinner'
import { detailsErrorOf, dlsiteGenresAtom, dlsiteListKeys, setFilterAtom } from '../details'

const shownRows = 60

export function PickRow({
  label,
  chosen,
  onToggle,
}: {
  readonly label: string
  readonly chosen: boolean
  readonly onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-pressed={chosen}
      className={cn(
        'h-8 w-full justify-start gap-2 rounded-lg px-2 text-[13px] font-normal',
        chosen && 'font-medium',
      )}
      onClick={onToggle}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[5px] ring-1 ring-foreground/20',
          chosen && 'bg-primary text-primary-foreground ring-primary',
        )}
      >
        {chosen ? <CheckIcon weight="bold" className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </Button>
  )
}

export function TagMenu({ chosen }: { readonly chosen: ReadonlyArray<Genre> }) {
  const tags = useAtomValue(dlsiteGenresAtom)
  const setFilter = useAtomSet(setFilterAtom, { mode: 'promiseExit' })
  const [query, setQuery] = useState('')
  const [atTop, setAtTop] = useState<ReadonlySet<number>>(new Set())
  const chosenIds = new Set(chosen.map((tag) => tag.id))
  const all = AsyncResult.isSuccess(tags) ? tags.value : chosen
  const wanted = query.trim().toLowerCase()

  const listed = all
    .filter((tag) => tag.name.toLowerCase().includes(wanted))
    .toSorted((a, b) => Number(atTop.has(b.id)) - Number(atTop.has(a.id)))
    .slice(0, shownRows)

  const toggle = (tag: Genre) =>
    setFilter({
      payload: { target: { tag }, chosen: !chosenIds.has(tag.id) },
      reactivityKeys: dlsiteListKeys,
    })

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setAtTop(chosenIds)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" className="h-8 rounded-full px-3">
            <TagIcon />
            {chosen.length === 0 ? 'Tags' : `Tags · ${chosen.length}`}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[320px] rounded-[20px] p-4">
        <div className="font-semibold">Tags</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only games that have every tag you pick are shown.
        </p>
        <InputGroup className="mt-3 h-8 rounded-full">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find a tag"
            placeholder="Find a tag"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <div className="mt-2 max-h-[320px] overflow-y-auto pr-1">
          {AsyncResult.isInitial(tags) ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Spinner /> Loading DLsite’s tags…
            </div>
          ) : null}
          {AsyncResult.isFailure(tags) ? (
            <p className="px-2 py-2 text-xs text-destructive">
              {detailsErrorOf(tags.cause)?.message ?? 'DLsite could not be reached.'}
            </p>
          ) : null}
          {listed.map((tag) => (
            <PickRow
              key={tag.id}
              label={tag.name}
              chosen={chosenIds.has(tag.id)}
              onToggle={() => void toggle(tag)}
            />
          ))}
          {listed.length === 0 && AsyncResult.isSuccess(tags) ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No tag is named that.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
