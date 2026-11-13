import { MagnifyingGlassIcon, SparkleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { useEffect, useState } from 'react'
import type { FinderResults, GameFact } from '#contract/GameGuide'
import { useCoreCall } from '#lib/rpc'
import { Dialog, DialogContent, DialogTitle } from '#ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { FactRow } from './FactRow'

const SEARCH_DELAY_MS = 150

interface Section {
  readonly title: string
  readonly facts: ReadonlyArray<GameFact>
}

const sectionsOf = (results: FinderResults | undefined): ReadonlyArray<Section> => {
  if (results === undefined) {
    return []
  }

  return [
    ...results.subjects.map((found) => ({
      title: [
        found.subject.name,
        found.subject.kind,
        found.held === undefined ? '' : `you have ${found.held}`,
      ]
        .filter((part) => part !== '')
        .join(' · '),
      facts: found.facts,
    })),
    { title: 'People', facts: results.people },
    { title: 'Places', facts: results.places },
    { title: 'Said in dialogue', facts: results.dialogue },
  ].filter((section) => section.facts.length > 0)
}

export function FinderPalette({
  open,
  onOpenChange,
  onPick,
  onAsk,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPick: (fact: GameFact) => void
  readonly onAsk: (question: string) => void
}) {
  const call = useCoreCall()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FinderResults>()
  const [problem, setProblem] = useState<string>()
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    const wanted = query.trim()

    if (wanted === '') {
      return
    }

    let stopped = false

    const timer = window.setTimeout(() => {
      void call((client) => client('findInGame', { query: wanted })).then((exit) => {
        if (stopped) {
          return
        }

        if (Exit.isSuccess(exit)) {
          setResults(exit.value)
          setProblem(undefined)
          setSelected(0)
        } else {
          setProblem('The guide is still reading the game, or no game is connected.')
        }
      })
    }, SEARCH_DELAY_MS)

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [call, query])

  const shown = query.trim() === '' ? undefined : results
  const sections = sectionsOf(shown)
  const facts = sections.flatMap((section) => section.facts)

  const starts = sections.map((_, index) =>
    sections.slice(0, index).reduce((sum, section) => sum + section.facts.length, 0),
  )

  const askIndex = facts.length

  const close = () => {
    onOpenChange(false)
    setQuery('')
  }

  const choose = (index: number) => {
    const fact = facts[index]

    if (fact !== undefined) {
      onPick(fact)
    } else if (query.trim() !== '') {
      onAsk(query.trim())
    }

    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        className="top-auto bottom-3 max-h-[540px] translate-y-0 gap-0 overflow-hidden rounded-[22px] bg-card p-1.5 sm:max-w-[536px]"
      >
        <DialogTitle className="sr-only">Find in the game</DialogTitle>
        <InputGroup className="h-11 rounded-none border-0 border-b bg-transparent dark:bg-transparent">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            aria-label="Find an item, person or place"
            placeholder="Find an item, person or place…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((current) => Math.min(current + 1, askIndex))
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((current) => Math.max(current - 1, 0))
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                choose(event.ctrlKey ? askIndex : selected)
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <kbd className="rounded-md border border-input px-1.5 text-[11px] text-muted-foreground">
              Esc
            </kbd>
          </InputGroupAddon>
        </InputGroup>
        <div role="listbox" aria-label="Found in the game" className="min-h-0 overflow-y-auto pt-1">
          {problem === undefined ? null : (
            <p className="px-3 py-3 text-sm text-muted-foreground">{problem}</p>
          )}
          {shown !== undefined && facts.length === 0 && problem === undefined ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Nothing in the game's data matches "{shown.query}".
            </p>
          ) : null}
          {sections.map((section, sectionIndex) => (
            <div key={section.title}>
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {section.title}
              </div>
              {section.facts.map((fact, factIndex) => {
                const index = (starts[sectionIndex] ?? 0) + factIndex

                return (
                  <FactRow
                    key={fact.id}
                    fact={fact}
                    selected={selected === index}
                    onSelect={() => choose(index)}
                  />
                )
              })}
            </div>
          ))}
        </div>
        {query.trim() === '' ? null : (
          <div
            role="option"
            aria-selected={selected === askIndex}
            tabIndex={-1}
            className={cn(
              'mt-1.5 flex cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[13px] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]',
              selected === askIndex ? 'bg-secondary' : 'bg-foreground/[0.035]',
            )}
            onClick={() => choose(askIndex)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                choose(askIndex)
              }
            }}
          >
            <SparkleIcon className="size-4" />
            <span className="min-w-0 flex-1 truncate">
              Ask the guide about <b>{query.trim()}</b>
            </span>
            <kbd className="rounded-md border border-input px-1.5 text-[11px] text-muted-foreground">
              Ctrl ↵
            </kbd>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
