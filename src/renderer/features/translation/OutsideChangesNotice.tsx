import { useAtomSet } from '@effect/atom-react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import { formErrorOf } from '#lib/forms'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#ui/alert-dialog'
import { Button } from '#ui/button'
import { libraryKeys, translationKeys } from '../library/library'
import { lineKeys, restoreTranslatedFilesAtom } from './translationLines'

export function OutsideChangesNotice({
  gameId,
  message,
  className,
  onRestored,
  onUpdateGame,
}: {
  readonly gameId: string
  readonly message: string
  readonly className?: string
  readonly onRestored: () => void
  readonly onUpdateGame?: () => void
}) {
  const restore = useAtomSet(restoreTranslatedFilesAtom, { mode: 'promiseExit' })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const putBack = async () => {
    setConfirming(false)
    setBusy(true)

    const exit = await restore({
      payload: { gameId },
      reactivityKeys: [...lineKeys, ...translationKeys, ...libraryKeys],
    })

    setBusy(false)

    const failure = formErrorOf(exit)

    if (failure === undefined) {
      onRestored()

      return
    }

    setError(failure.message)
  }

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-2xl bg-warning/8 p-3.5 text-[13px]', className)}
    >
      <p className="flex gap-2 text-warning">
        <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      {error === undefined ? null : <p className="text-destructive">{error}</p>}
      <span className="flex flex-wrap gap-1.5">
        {onUpdateGame === undefined ? null : (
          <Button size="sm" className="h-7 w-fit rounded-full px-3" onClick={onUpdateGame}>
            Update the game…
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-7 w-fit rounded-full px-3"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {busy ? 'Putting files back…' : "Put Wenbu's files back"}
        </Button>
      </span>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Put Wenbu's files back?</AlertDialogTitle>
            <AlertDialogDescription>
              The files changed outside Wenbu are replaced with the translated game as Wenbu last
              wrote it. If they came from a game update, install it with Update the game instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void putBack()}>Put files back</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
