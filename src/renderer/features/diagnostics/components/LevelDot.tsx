import { cn } from 'cn'
import type { LogLevel } from '#contract/Diagnostics'

export const levelText: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-destructive',
  fatal: 'text-destructive',
}

const levelDot: Record<LogLevel, string> = {
  debug: 'bg-muted-foreground/60',
  info: 'bg-info',
  warn: 'bg-warning',
  error: 'bg-destructive',
  fatal: 'bg-destructive',
}

export function LevelDot({
  level,
  className,
}: {
  readonly level: LogLevel
  readonly className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('size-[7px] shrink-0 rounded-full', levelDot[level], className)}
    />
  )
}
