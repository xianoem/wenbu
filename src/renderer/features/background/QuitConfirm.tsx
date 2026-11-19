import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import {
  ChatTextIcon,
  DownloadSimpleIcon,
  type Icon,
  ImagesIcon,
  SubtitlesIcon,
  TranslateIcon,
} from '@phosphor-icons/react'
import { type ActivityKind, activityLabel } from '#contract/Background'
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
import { activityAtom } from './background'

const activityIcons: Record<ActivityKind, Icon> = {
  download: DownloadSimpleIcon,
  translation: TranslateIcon,
  manga: ImagesIcon,
  overlay: ChatTextIcon,
  subtitles: SubtitlesIcon,
}

const afterQuit: Record<ActivityKind, string> = {
  download: 'Resumes next time',
  translation: 'Can continue later',
  manga: 'Stops',
  overlay: 'Stops',
  subtitles: 'Stops',
}

/** Main asks only when something runs, so the list is never empty when this opens. */
export function QuitConfirm() {
  const [open, setOpen] = useState(false)
  const result = useAtomValue(activityAtom)
  const activity = AsyncResult.isSuccess(result) ? result.value : []

  useEffect(() => window.wenbu.onQuitAsked(() => setOpen(true)), [])

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="gap-4 rounded-3xl p-5.5 data-[size=default]:sm:max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Quit Wenbu?</AlertDialogTitle>
          <AlertDialogDescription>These stop when Wenbu quits:</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col rounded-2xl bg-foreground/4 px-3 py-1 ring-1 ring-foreground/5">
          {activity.map((item) => {
            const Icon = activityIcons[item.kind]

            return (
              <li key={item.id} className="flex h-9 items-center gap-2.5 text-[13px]">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{activityLabel(item)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {afterQuit[item.kind]}
                </span>
              </li>
            )
          })}
        </ul>
        <AlertDialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0">
          <AlertDialogCancel className="rounded-full px-4">Keep running</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="rounded-full px-4"
            onClick={() => window.wenbu.quit(true)}
          >
            Quit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
