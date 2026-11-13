import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { CgPack, Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Checkbox } from '#ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { Label } from '#ui/label'
import { createCgPackAtom, imageFoldersAtom } from '../library'

export function CgPackDialog({
  game,
  onClose,
}: {
  readonly game: Game
  readonly onClose: () => void
}) {
  const folders = useAtomValue(imageFoldersAtom(game.id))
  const create = useAtomSet(createCgPackAtom, { mode: 'promiseExit' })
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(['pictures']))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pack, setPack] = useState<CgPack | undefined>(undefined)

  const toggle = (folder: string) =>
    setChosen((current) => {
      const next = new Set(current)

      if (!next.delete(folder)) {
        next.add(folder)
      }

      return next
    })

  const confirm = async () => {
    setBusy(true)
    setError(undefined)

    const exit = await create({ payload: { id: game.id, folders: [...chosen] } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setPack(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const loadError = AsyncResult.isFailure(folders)
    ? formErrorOf(Exit.failCause(folders.cause))?.message
    : undefined

  const available = AsyncResult.isSuccess(folders) ? folders.value : []

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create CG pack</DialogTitle>
          <DialogDescription>
            Copies the chosen image folders into a CGPack folder in the game, decrypting the images
            on the way.
          </DialogDescription>
        </DialogHeader>

        {pack === undefined ? (
          <div className="max-h-72 divide-y overflow-y-auto rounded-xl border">
            {available.map((folder) => (
              <Label key={folder} className="gap-2.5 px-3.5 py-2.5 font-normal">
                <Checkbox checked={chosen.has(folder)} onCheckedChange={() => toggle(folder)} />
                {folder}
              </Label>
            ))}
            {loadError === undefined && available.length === 0 ? (
              <p className="px-3.5 py-2.5 text-muted-foreground">Looking for image folders…</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm">
            {`Copied ${pack.imageCount.toLocaleString('en-US')} images`}
            {pack.skippedCount > 0
              ? `, skipped ${pack.skippedCount.toLocaleString('en-US')} other files`
              : ''}
            .
          </p>
        )}

        {(error ?? loadError) === undefined ? null : (
          <p className="text-sm text-destructive">{error ?? loadError}</p>
        )}

        <DialogFooter>
          {pack === undefined ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy || chosen.size === 0 || available.length === 0}
                onClick={() => void confirm()}
              >
                {busy ? 'Copying…' : 'Create'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => window.wenbu.revealPath(pack.path)}>
                Show in Explorer
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
