import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { DeletionImpact } from '#contract/Llm'
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
import { detectionSettingsKeys } from '../../detections/detections'
import { deleteConnectionAtom, deletePresetAtom, deletionImpactAtom, llmKeys } from '../llm'

export interface DeletionTarget {
  readonly kind: 'connection' | 'preset'
  readonly id: string
  readonly name: string
}

const refreshedKeys = [...llmKeys, 'translation-settings', ...detectionSettingsKeys]

const listOf = (items: ReadonlyArray<string>) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

function ImpactText({
  target,
  impact,
}: {
  readonly target: DeletionTarget
  readonly impact: DeletionImpact
}) {
  const presets = target.kind === 'connection' ? impact.presets : []
  const subject = target.kind === 'preset' || presets.length === 1 ? 'this preset' : 'these presets'

  return (
    <>
      {target.kind === 'connection' ? <p>Its saved API key is removed from this device.</p> : null}
      {presets.length === 0 ? null : (
        <p>
          {presets.length === 1 ? 'Its preset' : `Its ${presets.length} presets`},{' '}
          {listOf(presets.map((name) => `“${name}”`))}, {presets.length === 1 ? 'is' : 'are'}{' '}
          deleted too.
        </p>
      )}
      {impact.areas.length === 0 ? null : (
        <p className="text-foreground">
          {listOf(impact.areas)} {impact.areas.length === 1 ? 'uses' : 'use'} {subject} and will
          stop translating until you choose another.
        </p>
      )}
    </>
  )
}

function DeleteDialogContent({
  target,
  onClose,
  onDeleted,
}: {
  readonly target: DeletionTarget
  readonly onClose: () => void
  readonly onDeleted: (() => void) | undefined
}) {
  const impact = useAtomValue(deletionImpactAtom(`${target.kind}:${target.id}`))
  const deleteConnection = useAtomSet(deleteConnectionAtom, { mode: 'promiseExit' })
  const deletePreset = useAtomSet(deletePresetAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)

    const request = { payload: { id: target.id }, reactivityKeys: refreshedKeys }

    const exit = await (target.kind === 'connection'
      ? deleteConnection(request)
      : deletePreset(request))

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      onClose()
      onDeleted?.()

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{target.name}”?</AlertDialogTitle>
        <AlertDialogDescription render={<div className="flex flex-col gap-2" />}>
          {AsyncResult.isSuccess(impact) ? (
            <ImpactText target={target} impact={impact.value} />
          ) : AsyncResult.isFailure(impact) ? (
            <p className="text-destructive">Wenbu could not check what uses it.</p>
          ) : (
            <p>Checking what uses it…</p>
          )}
          {error === undefined ? null : <p className="text-destructive">{error}</p>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={!AsyncResult.isSuccess(impact) || busy}
          onClick={() => void confirm()}
        >
          Delete {target.kind}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

export function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  readonly target: DeletionTarget | undefined
  readonly onClose: () => void
  readonly onDeleted?: () => void
}) {
  return (
    <AlertDialog
      open={target !== undefined}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {target === undefined ? null : (
        <DeleteDialogContent target={target} onClose={onClose} onDeleted={onDeleted} />
      )}
    </AlertDialog>
  )
}
