import { cn } from 'cn'
import { scoreBarClasses, scoreTone, scoreToneClasses } from '../details'

export function ScoreBar({ score }: { readonly score: number }) {
  const tone = scoreTone(score)

  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-xs">
      <span className="h-[5px] w-16 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', scoreBarClasses[tone])}
          style={{ width: `${score}%` }}
        />
      </span>
      <b className={cn('w-8 text-right font-semibold tabular-nums', scoreToneClasses[tone])}>
        {score}%
      </b>
    </span>
  )
}
