import { cn } from 'cn'
import type { ReactNode } from 'react'

export function Kbd({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
