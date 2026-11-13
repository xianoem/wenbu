import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'

export function DLsiteProblem({
  message,
  retrying,
  onRetry,
  className,
}: {
  readonly message: string
  readonly retrying: boolean
  readonly onRetry: () => void
  readonly className?: string
}) {
  return (
    <div role="alert" className={cn('flex items-center gap-3 text-sm', className)}>
      <span className="min-w-0 text-destructive">{message}</span>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0 rounded-full"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? <Spinner data-icon="inline-start" /> : <ArrowClockwiseIcon />}
        Try again
      </Button>
    </div>
  )
}
