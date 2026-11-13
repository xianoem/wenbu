import { cn } from 'cn'
import type { GlossaryTerm, TermSpan } from '#contract/Novels'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'

const kindLabels: Record<GlossaryTerm['kind'], string> = {
  character: 'Character',
  place: 'Place',
  sect: 'Sect',
  technique: 'Technique',
  item: 'Item',
  concept: 'Concept',
  other: 'Term',
}

function TermMark({ term, children }: { readonly term: GlossaryTerm; readonly children: string }) {
  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        render={
          <span className="cursor-pointer rounded-[4px] bg-[oklch(0.78_0.14_150/0.13)] px-0.5 text-[oklch(0.88_0.11_150)] [box-decoration-break:clone]" />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[230px] rounded-[16px] px-3.5 py-3 font-sans">
        <div className="font-serif text-lg leading-tight text-[oklch(0.88_0.11_150)]">
          {term.original}
        </div>
        <div className="text-[15px]">{term.translation}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {kindLabels[term.kind]}
          {term.gender === null ? '' : ` · ${term.gender === 'm' ? 'male' : 'female'}`} ·{' '}
          {term.glossary}
        </div>
        {term.note === null ? null : (
          <p className="mt-1.5 text-xs text-foreground/80">{term.note}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function TermText({
  text,
  spans,
  terms,
  className,
}: {
  readonly text: string
  readonly spans: ReadonlyArray<TermSpan>
  readonly terms: ReadonlyMap<string, GlossaryTerm>
  readonly className?: string
}) {
  const parts: Array<React.ReactNode> = []
  let at = 0

  for (const span of spans) {
    const term = terms.get(span.termId)

    if (term === undefined || span.start < at) {
      continue
    }

    parts.push(text.slice(at, span.start))

    parts.push(
      <TermMark key={span.start} term={term}>
        {text.slice(span.start, span.end)}
      </TermMark>,
    )

    at = span.end
  }

  parts.push(text.slice(at))

  return <div className={cn(className)}>{parts}</div>
}
