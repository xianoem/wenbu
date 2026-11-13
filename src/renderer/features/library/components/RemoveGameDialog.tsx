import { useAtomSet } from '@effect/atom-react'
import { Exit } from 'effect'
import { useState } from 'react'
import type { Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { gameIdAtom } from '#lib/navigation'
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
import { libraryKeys, removeGameAtom } from '../library'

export function RemoveGameDialog({
  game,
  onClose,
}: {
  readonly game: Game
  readonly onClose: () => void
}) {
  const remove = useAtomSet(removeGameAtom, { mode: 'promiseExit' })
  const setGameId = useAtomSet(gameIdAtom)
  const [error, setError] = useState<string | undefined>(undefined)

  const confirm = async () => {
    const exit = await remove({ payload: { id: game.id }, reactivityKeys: libraryKeys })

    if (Exit.isSuccess(exit)) {
      setGameId(undefined)
      onClose()

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {game.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Wenbu forgets the game, its play time and its translation history. The game folder stays
            on disk, translated or not.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
