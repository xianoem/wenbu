import { cn } from 'cn'
import { type ReactNode, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

function OverflowText({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  const text = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)

  const isCut = () => text.current !== null && text.current.scrollWidth > text.current.clientWidth

  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && isCut())}>
      <TooltipTrigger
        render={<span ref={text} className={cn('block min-w-0 truncate', className)} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <span className="min-w-0 wrap-anywhere">{children}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export { OverflowText }
