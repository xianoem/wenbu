import { HardDrivesIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { driveLabel, reserveBytes, type SpaceShortfall } from '#contract/Storage'
import { formatBytes } from '#lib/format'
import { Button } from '#ui/button'

const explanation = (space: SpaceShortfall) => {
  const drive = driveLabel(space.drive)

  if (space.neededBytes === 0) {
    return `${drive} filled up while Wenbu was writing to it. It has ${formatBytes(space.freeBytes)} free.`
  }

  return `This needs ${formatBytes(space.neededBytes)}, and ${drive} has ${formatBytes(space.freeBytes)} free. Wenbu also leaves ${formatBytes(reserveBytes)} free for Windows.`
}

export function NotEnoughSpaceNotice({
  space,
  onRetry,
  className,
}: {
  readonly space: SpaceShortfall
  readonly onRetry?: () => void
  readonly className?: string
}) {
  const drive = driveLabel(space.drive)
  const wanted = space.neededBytes + reserveBytes
  const filled = Math.min(100, Math.round((space.freeBytes / wanted) * 100))

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-2xl bg-tint-amber px-4 py-3.5 text-tint-amber-foreground',
        className,
      )}
    >
      <HardDrivesIcon className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[13.5px] font-semibold">Not enough space on {drive}</p>
        <p className="mt-0.5 text-[13px]">{explanation(space)}</p>
        {space.neededBytes === 0 ? null : (
          <>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-tint-amber-foreground/20">
              <div
                className="h-full rounded-full bg-tint-amber-foreground"
                style={{ width: `${filled}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11.5px] tabular-nums">
              <span>{formatBytes(space.freeBytes)} free</span>
              <span>{formatBytes(wanted)} needed</span>
            </div>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {onRetry === undefined ? null : (
            <Button className="h-8 rounded-full px-4" onClick={onRetry}>
              Check again
            </Button>
          )}
          <Button
            variant="outline"
            className="h-8 rounded-full border-tint-amber-foreground/30 bg-transparent px-4 text-tint-amber-foreground hover:bg-tint-amber-foreground/10 hover:text-tint-amber-foreground dark:bg-transparent"
            onClick={() => window.wenbu.revealPath(space.drive)}
          >
            Show {drive}
          </Button>
        </div>
      </div>
    </div>
  )
}
