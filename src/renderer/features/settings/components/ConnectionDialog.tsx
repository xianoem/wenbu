import { useAtomSet } from '@effect/atom-react'
import { Exit } from 'effect'
import { useState } from 'react'
import { type LlmConnection, LlmProvider, providerLabels } from '#contract/Llm'
import { fieldError, type FormError, formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Dialog, DialogContent } from '#ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '#ui/field'
import { Input } from '#ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { createConnectionAtom, llmKeys, updateConnectionAtom, verifyConnectionAtom } from '../llm'
import { DeleteDialog } from './DeleteDialog'
import { DetailHeader, detailDialogClass, EditFooter, Tile } from './DetailDialog'
import { VerificationStatus } from './VerificationStatus'

const isProvider = (value: string): value is LlmProvider =>
  LlmProvider.literals.some((provider) => provider === value)

function ConnectionView({
  connection,
  presetNames,
}: {
  readonly connection: LlmConnection
  readonly presetNames: ReadonlyArray<string>
}) {
  return (
    <div className="flex flex-col gap-2">
      {connection.apiUrl === undefined ? null : <Tile label="API URL">{connection.apiUrl}</Tile>}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Provider">{providerLabels[connection.provider]}</Tile>
        <Tile label="API key">Saved</Tile>
        <Tile label="Presets">{presetNames.length}</Tile>
      </div>
      {presetNames.length === 0 ? null : (
        <p className="mt-2 px-1">
          <span className="text-muted-foreground">Used by&nbsp;&nbsp;</span>
          {presetNames.join(', ')}
        </p>
      )}
    </div>
  )
}

export function ConnectionDialog({
  connection,
  presetNames,
  onClose,
}: {
  readonly connection: LlmConnection | undefined
  readonly presetNames: ReadonlyArray<string>
  readonly onClose: () => void
}) {
  const [editing, setEditing] = useState(connection === undefined)
  const [name, setName] = useState(connection?.name ?? '')
  const [provider, setProvider] = useState<LlmProvider>(connection?.provider ?? 'openai')
  const [apiUrl, setApiUrl] = useState(connection?.apiUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<FormError | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const create = useAtomSet(createConnectionAtom, { mode: 'promiseExit' })
  const update = useAtomSet(updateConnectionAtom, { mode: 'promiseExit' })
  const verify = useAtomSet(verifyConnectionAtom, { mode: 'promiseExit' })

  const isCustom = provider === 'custom-openai-compatible'

  const run = async (
    action: () => Promise<Exit.Exit<unknown, unknown>>,
    after: 'close' | 'view' | 'stay',
  ) => {
    setBusy(true)
    setError(undefined)

    const exit = await action()

    setBusy(false)
    setError(formErrorOf(exit))

    if (Exit.isFailure(exit)) {
      return
    }

    if (after === 'close') {
      onClose()
    }

    if (after === 'view') {
      setApiKey('')
      setEditing(false)
    }
  }

  const cancel = () => {
    if (connection === undefined) {
      return onClose()
    }

    setName(connection.name)
    setProvider(connection.provider)
    setApiUrl(connection.apiUrl ?? '')
    setApiKey('')
    setError(undefined)
    setEditing(false)
  }

  const draft = { name, provider, ...(isCustom ? { apiUrl } : {}) }

  const save = () =>
    connection === undefined
      ? run(() => create({ payload: { ...draft, apiKey }, reactivityKeys: llmKeys }), 'close')
      : run(
          () =>
            update({
              payload: { ...draft, id: connection.id, ...(apiKey === '' ? {} : { apiKey }) },
              reactivityKeys: llmKeys,
            }),
          'view',
        )

  const recheck = (id: string) =>
    run(() => verify({ payload: { id }, reactivityKeys: llmKeys }), 'stay')

  const generalError = error !== undefined && error.field === undefined ? error.message : undefined

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} className={detailDialogClass}>
        <DetailHeader
          mark={providerLabels[connection?.provider ?? provider].charAt(0)}
          title={connection === undefined ? 'New connection' : connection.name}
          subtitle={
            connection === undefined ? (
              'Wenbu checks the key with the provider before saving it.'
            ) : (
              <VerificationStatus connection={connection} />
            )
          }
          onEdit={editing ? undefined : () => setEditing(true)}
        />

        {!editing && connection !== undefined ? (
          <>
            <ConnectionView connection={connection} presetNames={presetNames} />
            {generalError === undefined ? null : (
              <p className="text-sm text-destructive">{generalError}</p>
            )}
            <div>
              <Button
                variant="outline"
                className="rounded-full px-4"
                disabled={busy}
                onClick={() => void recheck(connection.id)}
              >
                {busy ? 'Checking…' : 'Verify again'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <FieldGroup className="gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={fieldError(error, 'name') !== undefined}>
                  <FieldLabel htmlFor="connection-name">Name</FieldLabel>
                  <Input
                    id="connection-name"
                    value={name}
                    placeholder="OpenRouter"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <FieldError>{fieldError(error, 'name')}</FieldError>
                </Field>

                <Field data-invalid={fieldError(error, 'provider') !== undefined}>
                  <FieldLabel>Provider</FieldLabel>
                  <Select
                    items={providerLabels}
                    value={provider}
                    onValueChange={(value) => {
                      if (value !== null && isProvider(value)) {
                        setProvider(value)
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LlmProvider.literals.map((option) => (
                        <SelectItem key={option} value={option}>
                          {providerLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{fieldError(error, 'provider')}</FieldError>
                </Field>
              </div>

              {isCustom ? (
                <Field data-invalid={fieldError(error, 'apiUrl') !== undefined}>
                  <FieldLabel htmlFor="connection-url">API URL</FieldLabel>
                  <Input
                    id="connection-url"
                    value={apiUrl}
                    placeholder="http://localhost:1234/v1"
                    onChange={(event) => setApiUrl(event.target.value)}
                  />
                  <FieldError>{fieldError(error, 'apiUrl')}</FieldError>
                </Field>
              ) : null}

              <Field data-invalid={fieldError(error, 'apiKey') !== undefined}>
                <FieldLabel htmlFor="connection-key">API key</FieldLabel>
                <Input
                  id="connection-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={
                    connection === undefined ? 'Paste the API key' : 'Saved. Type to replace it.'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <FieldError>
                  {fieldError(error, 'apiKey') ??
                    (isCustom ? undefined : fieldError(error, 'apiUrl'))}
                </FieldError>
              </Field>

              {generalError === undefined ? null : (
                <p className="text-sm text-destructive">{generalError}</p>
              )}
            </FieldGroup>

            <EditFooter
              onDelete={connection === undefined ? undefined : () => setConfirmingDelete(true)}
              onCancel={cancel}
              saveLabel={busy ? 'Checking…' : connection === undefined ? 'Add connection' : 'Save'}
              onSave={() => void save()}
              busy={busy}
            />
          </>
        )}
      </DialogContent>

      <DeleteDialog
        target={
          connection !== undefined && confirmingDelete
            ? { kind: 'connection', id: connection.id, name: connection.name }
            : undefined
        }
        onClose={() => setConfirmingDelete(false)}
        onDeleted={onClose}
      />
    </Dialog>
  )
}
