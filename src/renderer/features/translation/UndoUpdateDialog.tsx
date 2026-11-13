import { useAtomSet } from '@effect/atom-react'
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
import { libraryKeys, translationKeys } from '../library/library'
import { lineKeys, undoGameUpdateAtom } from './translationLines'

export function UndoUpdateDialog({
  gameId,
  open,
  onOpenChange,
  onBusy,
  onError,
}: {
  readonly gameId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onBusy: (busy: boolean) => void
  readonly onError: (message: string | undefined) => void
}) {
  const undo = useAtomSet(undoGameUpdateAtom, { mode: 'promiseExit' })

  const confirm = async () => {
    onOpenChange(false)
    onBusy(true)

    const exit = await undo({
      payload: { gameId },
      reactivityKeys: [...lineKeys, ...translationKeys, ...libraryKeys],
    })

    onBusy(false)
    onError(formErrorOf(exit)?.message)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo the update?</AlertDialogTitle>
          <AlertDialogDescription>
            Wenbu puts back the files the update replaced, removes the ones it added, and writes
            your translation of the earlier version again. Lines translated since the update are
            kept only where their text is the same.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>Undo the update</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
