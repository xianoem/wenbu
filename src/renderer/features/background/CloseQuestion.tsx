import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AppWindowIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import { type CloseAction, defaultBackgroundSettings } from '#contract/Background'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '#ui/alert-dialog'
import { backgroundKeys, backgroundSettingsAtom, saveBackgroundSettingsAtom } from './background'

export function CloseQuestion() {
  const [open, setOpen] = useState(false)
  const result = useAtomValue(backgroundSettingsAtom)
  const save = useAtomSet(saveBackgroundSettingsAtom, { mode: 'promiseExit' })
  const settings = AsyncResult.isSuccess(result) ? result.value : defaultBackgroundSettings

  useEffect(() => window.wenbu.onCloseAsked(() => setOpen(true)), [])

  const answer = async (closeAction: CloseAction) => {
    setOpen(false)

    await save({
      payload: { ...settings, closeAction, closeAsked: true },
      reactivityKeys: backgroundKeys,
    })

    window.wenbu.closeWith(closeAction)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="gap-4 rounded-3xl p-5.5 data-[size=default]:sm:max-w-[430px]">
        <AlertDialogHeader>
          <AlertDialogMedia className="rounded-[10px] bg-tint-slate text-tint-slate-foreground">
            <AppWindowIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Keep Wenbu running when you close it?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="flex flex-col gap-2.5" />}>
            <p>
              The overlay, Live Subtitles, downloads and translation runs keep going. Open Wenbu
              again from the tray icon next to the clock.
            </p>
            <p className="text-xs">You can change this in Settings › General.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0">
          <AlertDialogAction
            variant="secondary"
            className="rounded-full px-4"
            onClick={() => void answer('quit')}
          >
            Quit Wenbu
          </AlertDialogAction>
          <AlertDialogAction className="rounded-full px-4" onClick={() => void answer('tray')}>
            Keep running
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
