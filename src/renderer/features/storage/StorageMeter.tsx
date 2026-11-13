import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { driveLabel } from '#contract/Storage'
import { formatBytes } from '#lib/format'
import { fullestDrive, storageAtom } from './storage'

export function StorageMeter() {
  const result = useAtomValue(storageAtom)
  const drive = AsyncResult.isSuccess(result) ? fullestDrive(result.value) : undefined

  if (drive === undefined) {
    return null
  }

  const used = drive.totalBytes > 0 ? 1 - drive.freeBytes / drive.totalBytes : 1

  return (
    <div className="mb-2 rounded-xl bg-muted px-2.5 py-2" title="Free space on this drive">
      <div className="flex justify-between text-[11.5px]">
        <span className="font-medium">{driveLabel(drive.drive)}</span>
        <span className="text-warning tabular-nums">{formatBytes(drive.freeBytes)} free</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-warning"
          style={{ width: `${Math.round(used * 100)}%` }}
        />
      </div>
    </div>
  )
}
