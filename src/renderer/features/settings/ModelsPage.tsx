import {
  CaretRightIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  type KeyProtection,
  type LlmConnection,
  type LlmPreset,
  type LlmSettings,
  providerLabels,
} from '#contract/Llm'
import { Button } from '#ui/button'
import { ConnectionDialog } from './components/ConnectionDialog'
import { DeleteDialog, type DeletionTarget } from './components/DeleteDialog'
import { PresetDialog } from './components/PresetDialog'
import { VerificationPill } from './components/VerificationStatus'
import { reasoningLabel, useLlmSettings, useModelCatalog } from './llm'

type Editing =
  | { readonly kind: 'connection'; readonly id: string | undefined }
  | { readonly kind: 'preset'; readonly id: string | undefined; readonly connectionId?: string }

const keyProtectionNotes: Record<KeyProtection, string> = {
  os: 'API keys are encrypted with Windows-protected storage on this device.',
  reduced: 'API keys are encrypted on this device, without Windows-protected storage.',
}

const reasoningPhrase = (reasoning: string) => {
  if (reasoning === 'off') {
    return 'reasoning off'
  }

  return `${reasoningLabel(reasoning).toLowerCase()} reasoning`
}

const connectionDetail = (connection: LlmConnection) => {
  const host = connection.apiUrl === undefined ? undefined : URL.parse(connection.apiUrl)?.host

  return [providerLabels[connection.provider], host]
    .filter((part) => part !== undefined)
    .join(' · ')
}

const rowClass =
  'h-auto w-full justify-start gap-3 rounded-2xl px-3.5 py-2.5 text-left font-normal hover:bg-muted/50'

function ConnectionCard({
  connection,
  presets,
  modelName,
  onEdit,
  onDelete,
}: {
  readonly connection: LlmConnection
  readonly presets: ReadonlyArray<LlmPreset>
  readonly modelName: (preset: LlmPreset) => string
  readonly onEdit: (editing: Editing) => void
  readonly onDelete: (target: DeletionTarget) => void
}) {
  return (
    <section className="rounded-3xl bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-[15px] font-semibold"
        >
          {providerLabels[connection.provider].charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{connection.name}</h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {connectionDetail(connection)}
          </p>
        </div>
        <VerificationPill verification={connection.verification} />
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={`Edit ${connection.name}`}
          onClick={() => onEdit({ kind: 'connection', id: connection.id })}
        >
          <PencilSimpleIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          aria-label={`Delete ${connection.name}`}
          onClick={() => onDelete({ kind: 'connection', id: connection.id, name: connection.name })}
        >
          <TrashIcon />
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-0.5 pl-[52px]">
        {presets.map((preset) => (
          <div key={preset.id} className="group relative">
            <Button
              variant="ghost"
              className={`${rowClass} pr-20`}
              onClick={() => onEdit({ kind: 'preset', id: preset.id })}
            >
              <SlidersHorizontalIcon className="text-muted-foreground" />
              <span className="font-medium">{preset.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {modelName(preset)} · {reasoningPhrase(preset.reasoning)}
              </span>
            </Button>
            <CaretRightIcon className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground" />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${preset.name}`}
              className="absolute top-1/2 right-9 size-8 -translate-y-1/2 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/15 hover:text-destructive"
              onClick={() => onDelete({ kind: 'preset', id: preset.id, name: preset.name })}
            >
              <TrashIcon />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          className={`${rowClass} text-muted-foreground`}
          onClick={() => onEdit({ kind: 'preset', id: undefined, connectionId: connection.id })}
        >
          <PlusIcon />
          Add preset
        </Button>
      </div>
    </section>
  )
}

function ModelsSettings({ settings }: { readonly settings: LlmSettings }) {
  const catalog = useModelCatalog()
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const [deleting, setDeleting] = useState<DeletionTarget | undefined>(undefined)
  const close = () => setEditing(undefined)

  const modelName = (preset: LlmPreset) => {
    const provider = settings.connections.find(
      (connection) => connection.id === preset.connectionId,
    )?.provider

    return (
      catalog.find((model) => model.provider === provider && model.id === preset.modelId)?.name ??
      preset.modelId
    )
  }

  const editingConnection =
    editing?.kind === 'connection'
      ? settings.connections.find((connection) => connection.id === editing.id)
      : undefined

  const editingPreset =
    editing?.kind === 'preset'
      ? settings.presets.find((preset) => preset.id === editing.id)
      : undefined

  const addConnection = () => setEditing({ kind: 'connection', id: undefined })

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Models</h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockSimpleIcon />
            {keyProtectionNotes[settings.keyProtection]}
          </p>
        </div>
        {settings.connections.length === 0 ? null : (
          <Button
            variant="outline"
            className="h-9 gap-1.5 rounded-full px-4"
            onClick={addConnection}
          >
            <PlusIcon />
            Add connection
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3.5">
        {settings.connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            presets={settings.presets.filter((preset) => preset.connectionId === connection.id)}
            modelName={modelName}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        ))}

        {settings.connections.length === 0 ? (
          <Button
            variant="ghost"
            onClick={addConnection}
            className="h-auto flex-col items-start gap-1 rounded-3xl border-2 border-dashed p-5 text-left font-normal whitespace-normal hover:bg-muted/40"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <PlusIcon />
              Add a connection
            </span>
            <span className="text-[13px] text-muted-foreground">
              Connect a provider such as OpenAI or Anthropic with its API key. Its presets will
              appear here.
            </span>
          </Button>
        ) : null}
      </div>

      <DeleteDialog target={deleting} onClose={() => setDeleting(undefined)} />

      {editing?.kind === 'connection' ? (
        <ConnectionDialog
          key={editing.id ?? 'new'}
          connection={editingConnection}
          presetNames={settings.presets
            .filter((preset) => preset.connectionId === editing.id)
            .map((preset) => preset.name)}
          onClose={close}
        />
      ) : null}

      {editing?.kind === 'preset' ? (
        <PresetDialog
          key={editing.id ?? `new-${editing.connectionId}`}
          preset={editingPreset}
          connections={settings.connections}
          {...(editing.connectionId === undefined
            ? {}
            : { defaultConnectionId: editing.connectionId })}
          catalog={catalog}
          onClose={close}
        />
      ) : null}
    </>
  )
}

export function ModelsPage() {
  const result = useLlmSettings()

  return (
    <div className="flex flex-col">
      {AsyncResult.isSuccess(result) ? <ModelsSettings settings={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <>
          <h1 className="text-[28px] font-semibold tracking-tight">Models</h1>
          <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
        </>
      ) : null}
    </div>
  )
}
