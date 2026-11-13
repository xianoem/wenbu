import { useAtomSet } from '@effect/atom-react'
import { CaretRightIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useMemo, useState } from 'react'
import {
  defaultReasoning,
  type LlmConnection,
  type LlmModel,
  type LlmPreset,
  providerLabels,
  reasoningChoices,
} from '#contract/Llm'
import { fieldError, type FormError, formErrorOf } from '#lib/forms'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '#ui/combobox'
import { Dialog, DialogContent } from '#ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '#ui/field'
import { Input } from '#ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Textarea } from '#ui/textarea'
import { createPresetAtom, llmKeys, modelSummary, reasoningLabel, updatePresetAtom } from '../llm'
import { DeleteDialog } from './DeleteDialog'
import { DetailHeader, detailDialogClass, EditFooter, Tile } from './DetailDialog'

interface ModelOption {
  readonly id: string
  readonly label: string
  readonly detail: string
}

const defaultOutputTokens = 8192

const samplingFields = new Set(['temperature', 'topP', 'maxOutputTokens'])

const toOption = (model: LlmModel): ModelOption => ({
  id: model.id,
  label: model.name,
  detail: model.id,
})

const parseNumber = (value: string) => {
  const parsed = Number(value)

  return value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed
}

const modelOf = (
  catalog: ReadonlyArray<LlmModel>,
  connection: LlmConnection | undefined,
  modelId: string,
) => catalog.find((model) => model.provider === connection?.provider && model.id === modelId)

function PresetView({
  preset,
  model,
}: {
  readonly preset: LlmPreset
  readonly model: LlmModel | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl bg-muted/50 px-4 py-3.5">
        <div className="text-xs text-muted-foreground">Model</div>
        <div className="truncate text-lg font-semibold">{model?.name ?? preset.modelId}</div>
        <div className="text-[13px] text-muted-foreground">
          {model === undefined ? 'Custom model, without a price or limits.' : modelSummary(model)}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Reasoning">{reasoningLabel(preset.reasoning)}</Tile>
        <Tile label="Temperature">{preset.temperature}</Tile>
        <Tile label="Top P">{preset.topP}</Tile>
        <Tile label="Max output">{preset.maxOutputTokens.toLocaleString('en-US')}</Tile>
      </div>
      {preset.description === undefined ? null : (
        <p className="mt-2 px-1">
          <span className="text-muted-foreground">Notes&nbsp;&nbsp;</span>
          {preset.description}
        </p>
      )}
    </div>
  )
}

export function PresetDialog({
  preset,
  connections,
  defaultConnectionId,
  catalog,
  onClose,
}: {
  readonly preset: LlmPreset | undefined
  readonly connections: ReadonlyArray<LlmConnection>
  readonly defaultConnectionId?: string
  readonly catalog: ReadonlyArray<LlmModel>
  readonly onClose: () => void
}) {
  const [editing, setEditing] = useState(preset === undefined)
  const [name, setName] = useState(preset?.name ?? '')
  const [description, setDescription] = useState(preset?.description ?? '')

  const [connectionId, setConnectionId] = useState(
    preset?.connectionId ?? defaultConnectionId ?? connections[0]?.id ?? '',
  )

  const savedModelLabel =
    preset === undefined
      ? ''
      : (modelOf(
          catalog,
          connections.find((candidate) => candidate.id === preset.connectionId),
          preset.modelId,
        )?.name ?? preset.modelId)

  const [modelId, setModelId] = useState(preset?.modelId ?? '')
  const [modelQuery, setModelQuery] = useState(savedModelLabel)
  const [temperature, setTemperature] = useState(String(preset?.temperature ?? 0.7))
  const [topP, setTopP] = useState(String(preset?.topP ?? 1))
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(preset?.maxOutputTokens ?? 4096))
  const [reasoning, setReasoning] = useState(preset?.reasoning ?? defaultReasoning)
  const [samplingOpen, setSamplingOpen] = useState(false)
  const [error, setError] = useState<FormError | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const create = useAtomSet(createPresetAtom, { mode: 'promiseExit' })
  const update = useAtomSet(updatePresetAtom, { mode: 'promiseExit' })

  const connection = connections.find((candidate) => candidate.id === connectionId)

  const models = useMemo(
    () => catalog.filter((model) => model.provider === connection?.provider),
    [catalog, connection?.provider],
  )

  const model = models.find((candidate) => candidate.id === modelId)
  const choices = reasoningChoices(model)

  const modelOptions = useMemo(() => {
    const query = modelQuery.trim()
    const lowered = query.toLowerCase()

    const matches = models
      .filter(
        (candidate) =>
          candidate.id.toLowerCase().includes(lowered) ||
          candidate.name.toLowerCase().includes(lowered),
      )
      .map(toOption)

    const isKnown = query === '' || models.some((candidate) => candidate.id === query)

    return isKnown
      ? matches
      : [...matches, { id: query, label: `Use “${query}”`, detail: 'Not in the catalog' }]
  }, [models, modelQuery])

  const selectedOption =
    modelId === ''
      ? null
      : model === undefined
        ? { id: modelId, label: modelId, detail: '' }
        : toOption(model)

  const chooseModel = (option: ModelOption | null) => {
    if (option === null) {
      return
    }

    const next = models.find((candidate) => candidate.id === option.id)

    setModelId(option.id)

    if (!reasoningChoices(next).includes(reasoning)) {
      setReasoning(defaultReasoning)
    }

    if (preset === undefined && next !== undefined) {
      setMaxOutputTokens(String(Math.min(next.maxOutputTokens, defaultOutputTokens)))
    }
  }

  const cancel = () => {
    if (preset === undefined) {
      return onClose()
    }

    setName(preset.name)
    setDescription(preset.description ?? '')
    setConnectionId(preset.connectionId)
    setModelId(preset.modelId)
    setModelQuery(savedModelLabel)
    setTemperature(String(preset.temperature))
    setTopP(String(preset.topP))
    setMaxOutputTokens(String(preset.maxOutputTokens))
    setReasoning(preset.reasoning)
    setError(undefined)
    setEditing(false)
  }

  const run = async (action: () => Promise<Exit.Exit<unknown, unknown>>, close: boolean) => {
    setBusy(true)
    setError(undefined)

    const exit = await action()
    const failure = formErrorOf(exit)

    setBusy(false)
    setError(failure)

    if (failure !== undefined && samplingFields.has(failure.field ?? '')) {
      setSamplingOpen(true)
    }

    if (Exit.isSuccess(exit)) {
      if (close) {
        onClose()
      } else {
        setEditing(false)
      }
    }
  }

  const typedModelId = () => {
    const query = modelQuery.trim()

    if (query === '' || query === selectedOption?.label) {
      return modelId
    }

    const match = models.find((candidate) => candidate.id === query || candidate.name === query)

    return match?.id ?? query
  }

  const invalid = (field: string, message: string) => {
    setSamplingOpen(true)
    setError({ field, message })
  }

  const save = () => {
    const numbers = {
      temperature: parseNumber(temperature),
      topP: parseNumber(topP),
      maxOutputTokens: parseNumber(maxOutputTokens),
    }

    if (numbers.temperature === undefined) {
      return invalid('temperature', 'Enter a number.')
    }

    if (numbers.topP === undefined) {
      return invalid('topP', 'Enter a number.')
    }

    if (numbers.maxOutputTokens === undefined || !Number.isInteger(numbers.maxOutputTokens)) {
      return invalid('maxOutputTokens', 'Enter a whole number.')
    }

    const draft = {
      name,
      description,
      connectionId,
      modelId: typedModelId(),
      temperature: numbers.temperature,
      topP: numbers.topP,
      maxOutputTokens: numbers.maxOutputTokens,
      reasoning,
    }

    return void run(
      () =>
        preset === undefined
          ? create({ payload: draft, reactivityKeys: llmKeys })
          : update({ payload: { ...draft, id: preset.id }, reactivityKeys: llmKeys }),
      preset === undefined,
    )
  }

  const connectionItems = Object.fromEntries(
    connections.map((candidate) => [
      candidate.id,
      `${candidate.name} · ${providerLabels[candidate.provider]}`,
    ]),
  )

  const reasoningItems = Object.fromEntries(
    choices.map((choice) => [choice, reasoningLabel(choice)]),
  )

  const savedConnection = connections.find((candidate) => candidate.id === preset?.connectionId)
  const generalError = error !== undefined && error.field === undefined ? error.message : undefined

  const samplingSummary = `${temperature} · ${topP} · ${(parseNumber(maxOutputTokens) ?? 0).toLocaleString('en-US')} tokens`

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} className={detailDialogClass}>
        <DetailHeader
          mark={<SlidersHorizontalIcon />}
          title={preset === undefined ? 'New preset' : preset.name}
          subtitle={
            preset === undefined
              ? 'A preset picks a model and how it answers.'
              : `Preset on ${savedConnection?.name ?? 'a deleted connection'}`
          }
          onEdit={editing ? undefined : () => setEditing(true)}
        />

        {!editing && preset !== undefined ? (
          <PresetView preset={preset} model={modelOf(catalog, savedConnection, preset.modelId)} />
        ) : (
          <>
            <FieldGroup className="gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={fieldError(error, 'name') !== undefined}>
                  <FieldLabel htmlFor="preset-name">Name</FieldLabel>
                  <Input
                    id="preset-name"
                    value={name}
                    placeholder="Game dialogue"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <FieldError>{fieldError(error, 'name')}</FieldError>
                </Field>

                <Field data-invalid={fieldError(error, 'connectionId') !== undefined}>
                  <FieldLabel>Connection</FieldLabel>
                  <Select
                    items={connectionItems}
                    value={connectionId}
                    onValueChange={(value) => {
                      if (value !== null) {
                        setConnectionId(value)
                        setModelId('')
                        setReasoning(defaultReasoning)
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {connectionItems[candidate.id]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{fieldError(error, 'connectionId')}</FieldError>
                </Field>
              </div>

              <Field data-invalid={fieldError(error, 'modelId') !== undefined}>
                <FieldLabel htmlFor="preset-model">Model</FieldLabel>
                <Combobox
                  items={modelOptions}
                  value={selectedOption}
                  onValueChange={chooseModel}
                  inputValue={modelQuery}
                  onInputValueChange={setModelQuery}
                  itemToStringLabel={(option: ModelOption) => option.label}
                  isItemEqualToValue={(option: ModelOption, value: ModelOption) =>
                    option.id === value.id
                  }
                  filter={null}
                >
                  <ComboboxInput id="preset-model" placeholder="Search models or type a model ID" />
                  <ComboboxContent>
                    <ComboboxEmpty>No models match.</ComboboxEmpty>
                    <ComboboxList>
                      {(option: ModelOption) => (
                        <ComboboxItem key={option.id} value={option}>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{option.label}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {option.detail}
                            </span>
                          </span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <FieldDescription>
                  {model === undefined
                    ? modelId === ''
                      ? 'Pick from the catalog, or type an ID the provider accepts.'
                      : 'Custom model. Wenbu has no price or limits for it.'
                    : modelSummary(model)}
                </FieldDescription>
                <FieldError>{fieldError(error, 'modelId')}</FieldError>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={fieldError(error, 'reasoning') !== undefined}>
                  <FieldLabel>Reasoning</FieldLabel>
                  <Select
                    items={reasoningItems}
                    value={reasoning}
                    onValueChange={(value) => {
                      if (value !== null) {
                        setReasoning(value)
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((choice) => (
                        <SelectItem key={choice} value={choice}>
                          {reasoningLabel(choice)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{fieldError(error, 'reasoning')}</FieldError>
                </Field>

                <Field>
                  <FieldLabel htmlFor="preset-description">Notes</FieldLabel>
                  <Textarea
                    id="preset-description"
                    rows={1}
                    className="min-h-8"
                    value={description}
                    placeholder="What this preset is for"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
              </div>

              <Collapsible open={samplingOpen} onOpenChange={setSamplingOpen}>
                <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md px-1 text-[13px] text-muted-foreground hover:text-foreground">
                  <CaretRightIcon className="transition-transform group-data-panel-open:rotate-90" />
                  Sampling
                  {samplingOpen ? null : <span className="opacity-70">{samplingSummary}</span>}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field data-invalid={fieldError(error, 'temperature') !== undefined}>
                      <FieldLabel htmlFor="preset-temperature">Temperature</FieldLabel>
                      <Input
                        id="preset-temperature"
                        inputMode="decimal"
                        value={temperature}
                        onChange={(event) => setTemperature(event.target.value)}
                      />
                      <FieldError>{fieldError(error, 'temperature')}</FieldError>
                    </Field>

                    <Field data-invalid={fieldError(error, 'topP') !== undefined}>
                      <FieldLabel htmlFor="preset-top-p">Top P</FieldLabel>
                      <Input
                        id="preset-top-p"
                        inputMode="decimal"
                        value={topP}
                        onChange={(event) => setTopP(event.target.value)}
                      />
                      <FieldError>{fieldError(error, 'topP')}</FieldError>
                    </Field>

                    <Field data-invalid={fieldError(error, 'maxOutputTokens') !== undefined}>
                      <FieldLabel htmlFor="preset-max-output">Max output</FieldLabel>
                      <Input
                        id="preset-max-output"
                        inputMode="numeric"
                        value={maxOutputTokens}
                        onChange={(event) => setMaxOutputTokens(event.target.value)}
                      />
                      <FieldError>{fieldError(error, 'maxOutputTokens')}</FieldError>
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {generalError === undefined ? null : (
                <p className="text-sm text-destructive">{generalError}</p>
              )}
            </FieldGroup>

            <EditFooter
              onDelete={preset === undefined ? undefined : () => setConfirmingDelete(true)}
              onCancel={cancel}
              saveLabel={preset === undefined ? 'Add preset' : 'Save'}
              onSave={save}
              busy={busy}
            />
          </>
        )}
      </DialogContent>

      <DeleteDialog
        target={
          preset !== undefined && confirmingDelete
            ? { kind: 'preset', id: preset.id, name: preset.name }
            : undefined
        }
        onClose={() => setConfirmingDelete(false)}
        onDeleted={onClose}
      />
    </Dialog>
  )
}
