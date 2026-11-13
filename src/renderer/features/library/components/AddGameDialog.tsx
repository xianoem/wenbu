import { useAtomSet } from '@effect/atom-react'
import { CheckCircleIcon, FolderOpenIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { type DragEvent, useState } from 'react'
import { engineLabels, type GameCandidate } from '#contract/Library'
import { type FormError, formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { addGameAtom, formatBytes, inspectFolderAtom, lengthOf, libraryKeys } from '../library'
import { GameCover } from './GameCover'

function Candidate({ candidate }: { readonly candidate: GameCandidate }) {
  const length = lengthOf(candidate.text)

  return (
    <div className="flex min-w-0 items-center gap-3.5 rounded-xl bg-muted p-2.5">
      <GameCover
        game={{ id: candidate.folderPath, title: candidate.title }}
        className="w-20 text-lg"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{candidate.title}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          {[
            engineLabels[candidate.engine],
            formatBytes(candidate.sizeBytes),
            length === undefined ? undefined : `${length.size} · ${length.reading} of dialogue`,
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </p>
        <p className="truncate text-xs text-muted-foreground">{candidate.folderPath}</p>
      </div>
      <CheckCircleIcon
        weight="fill"
        className="size-5 shrink-0 text-success"
        aria-label="Game found"
      />
    </div>
  )
}

export function AddGameDialog({
  onClose,
  onAdded,
}: {
  readonly onClose: () => void
  readonly onAdded: (id: string) => void
}) {
  const inspect = useAtomSet(inspectFolderAtom, { mode: 'promiseExit' })
  const add = useAtomSet(addGameAtom, { mode: 'promiseExit' })
  const [candidate, setCandidate] = useState<GameCandidate | undefined>(undefined)
  const [error, setError] = useState<FormError | undefined>(undefined)
  const [busy, setBusy] = useState<'inspecting' | 'adding' | undefined>(undefined)
  const [dragging, setDragging] = useState(false)

  const inspectPath = async (path: string) => {
    setBusy('inspecting')
    setError(undefined)
    setCandidate(undefined)

    const exit = await inspect({ payload: { path } })

    setBusy(undefined)
    setError(formErrorOf(exit))

    if (Exit.isSuccess(exit)) {
      setCandidate(exit.value)
    }
  }

  const choose = async () => {
    const folder = await window.wenbu.chooseFolder()

    if (folder !== undefined) {
      await inspectPath(folder)
    }
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)

    const file = event.dataTransfer.files[0]

    if (file !== undefined) {
      void inspectPath(window.wenbu.pathForFile(file))
    }
  }

  const confirm = async () => {
    if (candidate === undefined) {
      return
    }

    setBusy('adding')

    const exit = await add({ payload: { path: candidate.folderPath }, reactivityKeys: libraryKeys })

    setBusy(undefined)
    setError(formErrorOf(exit))

    if (Exit.isSuccess(exit)) {
      onAdded(exit.value.id)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add game</DialogTitle>
          <DialogDescription>Choose the folder the game runs from.</DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors',
            dragging && 'border-ring bg-muted',
          )}
        >
          <FolderOpenIcon className="size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {busy === 'inspecting' ? 'Looking at the folder…' : 'Drop the game folder here, or'}
          </p>
          <Button variant="outline" disabled={busy !== undefined} onClick={() => void choose()}>
            Choose folder…
          </Button>
        </div>

        {candidate === undefined ? null : <Candidate candidate={candidate} />}

        {error === undefined ? null : (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <WarningCircleIcon className="mt-0.5 shrink-0" />
            {error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={candidate === undefined || busy !== undefined}
            onClick={() => void confirm()}
          >
            {busy === 'adding' ? 'Adding…' : 'Add to library'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
