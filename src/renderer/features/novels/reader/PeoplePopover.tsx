import { UsersThreeIcon } from '@phosphor-icons/react'
import type { GlossaryTerm } from '#contract/Novels'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'

const genderSign = (gender: GlossaryTerm['gender']) => {
  if (gender === 'm') {
    return '♂'
  }

  if (gender === 'f') {
    return '♀'
  }

  return ''
}

export function PeoplePopover({ terms }: { readonly terms: ReadonlyArray<GlossaryTerm> }) {
  const people = terms.filter((term) => term.kind === 'character')

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="People in this chapter"
            className="size-8 text-muted-foreground data-popup-open:bg-secondary data-popup-open:text-foreground"
          />
        }
      >
        <UsersThreeIcon />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[340px] flex-col gap-1.5 rounded-[20px] bg-card p-3 shadow-card"
      >
        <div className="px-1 font-medium">People in this chapter</div>
        {people.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            No characters from the glossary appear in this chapter.
          </p>
        ) : null}
        <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(420px,calc(var(--available-height)-110px))]">
          <div className="flex flex-col gap-1.5">
            {people.map((person) => (
              <div
                key={person.id}
                className="flex items-center gap-3 rounded-[14px] bg-background/60 px-2.5 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary font-serif text-[13px]">
                  {person.original.slice(-1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium">
                    {person.translation}
                    <span className="text-xs text-muted-foreground">
                      {genderSign(person.gender)}
                    </span>
                    <span className="font-serif text-xs font-normal text-muted-foreground">
                      {person.original}
                    </span>
                  </div>
                  {person.note === null ? null : (
                    <div className="truncate text-xs text-muted-foreground">{person.note}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
