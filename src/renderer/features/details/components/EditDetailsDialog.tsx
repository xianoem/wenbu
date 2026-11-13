import { useAtomSet } from '@effect/atom-react'
import { LockSimpleIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useState } from 'react'
import type { EditableField, GameDetails } from '#contract/Details'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { Field, FieldGroup, FieldLabel } from '#ui/field'
import { Input } from '#ui/input'
import { Textarea } from '#ui/textarea'
import { detailsKeys, editDetailsAtom, unlockDetailsAtom } from '../details'

const labels: Record<EditableField, string> = {
  title: 'Title',
  circle: 'Circle',
  releasedOn: 'Released (YYYY-MM-DD)',
  description: 'Description',
}

const fields: ReadonlyArray<EditableField> = ['title', 'circle', 'releasedOn', 'description']

export function EditDetailsDialog({
  details,
  onClose,
}: {
  readonly details: GameDetails
  readonly onClose: () => void
}) {
  const edit = useAtomSet(editDetailsAtom, { mode: 'promiseExit' })
  const unlock = useAtomSet(unlockDetailsAtom, { mode: 'promiseExit' })

  const [draft, setDraft] = useState<Record<EditableField, string>>({
    title: details.title,
    circle: details.circle,
    releasedOn: details.releasedOn,
    description: details.description,
  })

  const [error, setError] = useState<string | undefined>(undefined)

  const save = async () => {
    const edits = fields
      .filter((field) => draft[field].trim() !== details[field])
      .map((field) => ({ field, value: draft[field] }))

    if (edits.length > 0) {
      const exit = await edit({
        payload: { gameId: details.gameId, edits },
        reactivityKeys: detailsKeys,
      })

      if (Exit.isFailure(exit)) {
        return setError(formErrorOf(exit)?.message)
      }
    }

    onClose()
  }

  const unlockField = async (field: EditableField) => {
    const exit = await unlock({
      payload: { gameId: details.gameId, field },
      reactivityKeys: detailsKeys,
    })

    if (Exit.isSuccess(exit)) {
      setDraft((current) => ({ ...current, [field]: exit.value[field] }))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Fields you change are locked: refreshing from DLsite keeps them.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {fields.map((field) => (
            <Field key={field}>
              <div className="flex items-center gap-2">
                <FieldLabel htmlFor={`details-${field}`} className="flex-1">
                  {labels[field]}
                </FieldLabel>
                {details.locked.includes(field) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 rounded-full px-2 text-xs text-muted-foreground"
                    onClick={() => void unlockField(field)}
                  >
                    <LockSimpleIcon />
                    Use DLsite’s
                  </Button>
                ) : null}
              </div>
              {field === 'description' ? (
                <Textarea
                  id={`details-${field}`}
                  rows={5}
                  value={draft[field]}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              ) : (
                <Input
                  id={`details-${field}`}
                  value={draft[field]}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              )}
            </Field>
          ))}
        </FieldGroup>
        {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
