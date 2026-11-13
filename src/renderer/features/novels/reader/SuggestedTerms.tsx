import { useAtomValue } from '@effect/atom-react'
import { CheckIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { AcceptTerms, DismissTerm, type GlossaryTerm, UpdateNovelTerm } from '#contract/Novels'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { novelTermsAtom, useGlossaryEdit } from '../novels'

const kindLabel = (term: GlossaryTerm) =>
  `${term.kind.charAt(0).toUpperCase()}${term.kind.slice(1)}${term.gender === null ? '' : ` · ${term.gender}`}`

function Suggestion({ novelId, term }: { readonly novelId: string; readonly term: GlossaryTerm }) {
  const edit = useGlossaryEdit()
  const [translation, setTranslation] = useState(term.translation)

  const keep = async () => {
    if (translation.trim() !== '' && translation.trim() !== term.translation) {
      await edit(
        UpdateNovelTerm.make({
          novelId,
          termId: term.id,
          original: term.original,
          translation: translation.trim(),
          kind: term.kind,
          gender: term.gender,
          note: term.note,
        }),
      )
    }

    await edit(AcceptTerms.make({ novelId, termIds: [term.id] }))
  }

  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-background/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-serif">{term.original}</span>
          <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">
            {kindLabel(term)}
          </span>
        </div>
        <Input
          aria-label={`Translation of ${term.original}`}
          value={translation}
          className="mt-1 h-7 rounded-[8px] text-[13px]"
          onChange={(event) => setTranslation(event.target.value)}
        />
        {term.chapters.length === 0 ? null : (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Ch. {term.chapters.slice(0, 8).join(', ')}
            {term.chapters.length > 8 ? '…' : ''}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Accept ${term.original}`}
          className="rounded-full bg-success/15 text-success hover:bg-success/25 hover:text-success"
          onClick={() => void keep()}
        >
          <CheckIcon />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Dismiss ${term.original}`}
          className="rounded-full text-muted-foreground"
          onClick={() => void edit(DismissTerm.make({ novelId, termId: term.id }))}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  )
}

export function SuggestedTerms({
  novelId,
  chapter,
}: {
  readonly novelId: string
  readonly chapter: number
}) {
  const result = useAtomValue(novelTermsAtom(novelId))
  const edit = useGlossaryEdit()

  const suggested = AsyncResult.isSuccess(result)
    ? result.value.filter(
        (term) => term.suggested && (term.origin !== 'scan' || term.chapters.includes(chapter)),
      )
    : []

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Suggested terms, ${suggested.length}`}
            className="relative size-8 text-muted-foreground data-popup-open:bg-secondary data-popup-open:text-foreground"
          />
        }
      >
        <SparkleIcon />
        {suggested.length === 0 ? null : (
          <span className="absolute top-0.5 right-0 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-success px-1 text-[9px] leading-none font-semibold text-black tabular-nums">
            {suggested.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[350px] flex-col gap-2 rounded-[20px] bg-card p-3 shadow-card"
      >
        <div className="flex items-center px-1">
          <span className="flex-1 font-medium">Suggested terms</span>
          {suggested.length === 0 ? null : (
            <Button
              variant="secondary"
              className="h-7 rounded-full px-2.5 text-xs"
              onClick={() =>
                void edit(AcceptTerms.make({ novelId, termIds: suggested.map((term) => term.id) }))
              }
            >
              Accept all
            </Button>
          )}
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          {suggested.length === 0
            ? 'Names and terms found in this chapter show up here.'
            : 'Found in this chapter. Used for consistency until you decide.'}
        </p>
        <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(420px,calc(var(--available-height)-110px))]">
          <div className="flex flex-col gap-2">
            {suggested.map((term) => (
              <Suggestion key={term.id} novelId={novelId} term={term} />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
