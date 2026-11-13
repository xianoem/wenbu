import { cn } from 'cn'
import { type Tint, tintOf } from '../novels'

const backgrounds: Record<Tint, string> = {
  amber: 'from-tint-amber',
  violet: 'from-tint-violet',
  teal: 'from-tint-teal',
  slate: 'from-tint-slate',
}

const letters: Record<Tint, string> = {
  amber: 'text-tint-amber-foreground',
  violet: 'text-tint-violet-foreground',
  teal: 'text-tint-teal-foreground',
  slate: 'text-tint-slate-foreground',
}

export function NovelCover({
  id,
  title,
  className,
  size = 'text-2xl',
}: {
  readonly id: string
  readonly title: string
  readonly className?: string
  readonly size?: string
}) {
  const tint = tintOf(id)

  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden bg-linear-155 to-[oklch(0.17_0.01_285)]',
        backgrounds[tint],
        className,
      )}
    >
      <div
        className={cn(
          'absolute top-3 right-3 max-h-[calc(100%-1.5rem)] overflow-hidden font-serif font-semibold tracking-widest [writing-mode:vertical-rl]',
          size,
          letters[tint],
        )}
      >
        {title.slice(0, 8)}
      </div>
      <div className="absolute bottom-0 left-0 h-1/2 w-full bg-linear-to-t from-black/35 to-transparent" />
    </div>
  )
}

export function NovelInitial({
  id,
  title,
  className,
}: {
  readonly id: string
  readonly title: string
  readonly className?: string
}) {
  const tint = tintOf(id)

  return (
    <div
      aria-hidden
      className={cn(
        'grid place-items-center bg-linear-155 to-[oklch(0.17_0.01_285)] font-serif font-semibold',
        backgrounds[tint],
        letters[tint],
        className,
      )}
    >
      {title.slice(0, 1)}
    </div>
  )
}
