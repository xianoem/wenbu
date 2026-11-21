import { CaretDownIcon, CaretUpIcon, QuotesIcon } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '#ui/button'

function Label() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <QuotesIcon className="size-3.5" />
      <span className="font-medium text-foreground/75">Original</span>
    </span>
  )
}

function OneLine({ text, onOpen }: { readonly text: string; readonly onOpen: () => void }) {
  const [cut, setCut] = useState(false)
  const line = useRef<HTMLSpanElement | null>(null)

  useLayoutEffect(() => {
    const element = line.current

    if (element === null) {
      return
    }

    const measure = () => setCut(element.scrollWidth > element.clientWidth)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div className="mt-3.5 flex h-[30px] items-center gap-2 rounded-full bg-foreground/[0.035] pr-1.5 pl-2.5 text-[12.5px] text-muted-foreground">
      <Label />
      <span ref={line} className="min-w-0 flex-1 truncate select-text">
        {text.replaceAll(/\s*\n\s*/g, ' ')}
      </span>
      {cut || text.includes('\n') ? (
        <Button
          variant="ghost"
          size="xs"
          className="rounded-full px-2 text-foreground"
          onClick={onOpen}
        >
          Show
          <CaretDownIcon data-icon="inline-end" />
        </Button>
      ) : null}
    </div>
  )
}

export function OriginalText({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  const original = text.trim()

  if (!open) {
    return <OneLine key={original} text={original} onOpen={() => setOpen(true)} />
  }

  return (
    <div className="mt-3.5 flex flex-col gap-1.5 rounded-2xl bg-foreground/[0.035] py-2 pr-1.5 pl-2.5 text-[12.5px] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <Label />
        <Button
          variant="ghost"
          size="xs"
          className="rounded-full px-2 text-foreground"
          onClick={() => setOpen(false)}
        >
          Hide
          <CaretUpIcon data-icon="inline-end" />
        </Button>
      </div>
      <p className="pr-1.5 pb-1 text-[13px] leading-[1.75] whitespace-pre-wrap select-text">
        {original}
      </p>
    </div>
  )
}
