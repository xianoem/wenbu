import { useAtomValue } from '@effect/atom-react'
import { WarningIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { driveLabel, reserveBytes } from '#contract/Storage'
import { formatBytes } from '#lib/format'
import { Button } from '#ui/button'
import { fullestDrive, storageAtom } from './storage'

export function LowSpaceNotice() {
  const result = useAtomValue(storageAtom)
  const drive = AsyncResult.isSuccess(result) ? fullestDrive(result.value) : undefined

  if (drive?.level !== 'critical') {
    return null
  }

  const label = driveLabel(drive.drive)

  return (
    <div
      role="status"
      className="mb-6 flex items-center gap-2.5 rounded-2xl bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-foreground"
    >
      <WarningIcon className="size-[17px] shrink-0" />
      <span className="min-w-0 flex-1">
        {label} has {formatBytes(drive.freeBytes)} left. Translations, downloads, manga runs and
        plugin installs won't start until more than {formatBytes(reserveBytes)} is free.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full border-tint-amber-foreground/30 bg-transparent px-3 text-tint-amber-foreground hover:bg-tint-amber-foreground/10 hover:text-tint-amber-foreground dark:bg-transparent"
        onClick={() => window.wenbu.revealPath(drive.drive)}
      >
        Show {label}
      </Button>
    </div>
  )
}
