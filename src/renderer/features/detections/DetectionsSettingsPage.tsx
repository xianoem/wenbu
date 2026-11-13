import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { CloudIcon, CpuIcon, InfoIcon, ScanIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  type DetectionEngine,
  detectionHistoryLimit,
  DetectionSettings,
} from '#contract/Detections'
import { formErrorOf } from '#lib/forms'
import { screenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Switch } from '#ui/switch'
import { Note, NumberField, SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import { useLlmSettings } from '../settings/llm'
import {
  detectionSettingsAtom,
  detectionSettingsKeys,
  detectionsAtom,
  saveDetectionSettingsAtom,
} from './detections'

const sameSettings = Schema.toEquivalence(DetectionSettings)

const engineBlurbs: Record<DetectionEngine['id'], string> = {
  'screen-ai': 'Runs on your computer. Fast, accurate and private. Installed from Plugins.',
  'google-lens':
    'Runs in the cloud through Google. Very accurate, but slower, not private, and unofficial.',
}

const noPreset = 'none'

function EngineCard({
  engine,
  selected,
  onSelect,
}: {
  readonly engine: DetectionEngine
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const setScreen = useAtomSet(screenAtom)
  const Icon = engine.locality === 'local' ? CpuIcon : CloudIcon

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border-[1.5px] border-border px-4 py-3.5',
        selected && 'border-primary bg-primary/8 ring-3 ring-primary/12',
      )}
    >
      <Button
        variant="ghost"
        aria-pressed={selected}
        className="h-auto flex-col items-stretch gap-2 p-0 text-left font-normal whitespace-normal hover:bg-transparent"
        onClick={onSelect}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-muted">
              <Icon className="size-4" />
            </span>
            <span>
              <span className="block font-medium">{engine.label}</span>
              <span
                className={cn(
                  'block text-xs',
                  engine.ready ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {engine.ready ? 'Ready' : 'Not ready'} ·{' '}
                {engine.locality === 'local' ? 'Local' : 'Cloud'}
              </span>
            </span>
          </span>
          <span
            aria-hidden
            className={cn(
              'size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground bg-background',
              selected && 'border-5 border-primary',
            )}
          />
        </span>
        <span className="text-[12.5px] text-muted-foreground">{engineBlurbs[engine.id]}</span>
      </Button>
      {engine.ready || engine.detail === undefined ? null : (
        <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
          <span>{engine.detail}</span>
          {engine.id === 'screen-ai' ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-full"
              onClick={() => setScreen('plugins')}
            >
              Open Plugins
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function DetectionSettingsForm({
  saved,
  engines,
}: {
  readonly saved: DetectionSettings
  readonly engines: ReadonlyArray<DetectionEngine>
}) {
  const save = useAtomSet(saveDetectionSettingsAtom, { mode: 'promiseExit' })
  const llm = useLlmSettings()
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []
  const dirty = !sameSettings(draft, saved)

  const change = (update: (settings: DetectionSettings) => DetectionSettings) => {
    setError(undefined)
    setDraft(update)
  }

  const changeTranslation = (patch: Partial<DetectionSettings['translation']>) =>
    change((current) => ({ ...current, translation: { ...current.translation, ...patch } }))

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: detectionSettingsKeys })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setDraft(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="mt-6 flex flex-1 flex-col gap-5">
      <SettingsCard
        title="Detection engine"
        description="The OCR engine used for clipboard snips and dropped images."
      >
        <div className="grid grid-cols-2 gap-2.5">
          {engines.map((engine) => (
            <EngineCard
              key={engine.id}
              engine={engine}
              selected={draft.engineId === engine.id}
              onSelect={() => change((current) => ({ ...current, engineId: engine.id }))}
            />
          ))}
        </div>
        {draft.engineId === undefined ? (
          <Note Icon={InfoIcon}>
            The Detections popover asks for an engine until one is chosen here.
          </Note>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Clipboard"
        description="Detect images copied by a snipping tool."
        className="gap-1"
      >
        <SettingRow
          label="Listen for clipboard images"
          description="Detects copied images even while the Detections popover is closed."
        >
          <Switch
            aria-label="Listen for clipboard images"
            checked={draft.listenToClipboard}
            onCheckedChange={(listenToClipboard) =>
              change((current) => ({ ...current, listenToClipboard }))
            }
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="Limits"
        description={
          draft.engineId === 'google-lens'
            ? 'Keep detections in order and protect Google Lens from bursts.'
            : 'Keep detections in order.'
        }
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <SettingRow
            label="Detections at a time"
            description="Extra detections wait for their turn."
          >
            <NumberField
              label="Detections at a time"
              value={draft.concurrentJobs}
              suffix="at once"
              onChange={(value) =>
                change((current) => ({
                  ...current,
                  concurrentJobs: value ?? current.concurrentJobs,
                }))
              }
            />
          </SettingRow>
          {draft.engineId === 'google-lens' ? (
            <SettingRow
              label="Google Lens requests per minute"
              description="Requests beyond this wait for the next minute."
            >
              <NumberField
                label="Google Lens requests per minute"
                value={draft.cloudRequestsPerMinute}
                suffix="a minute"
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    cloudRequestsPerMinute: value ?? current.cloudRequestsPerMinute,
                  }))
                }
              />
            </SettingRow>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Automatic translation"
        description="With a preset chosen, every detected text is translated. Without one, detections keep the OCR text."
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <SettingRow label="Preset">
            <Select
              items={{
                [noPreset]: 'Do not translate',
                ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
              }}
              value={draft.translation.presetId === '' ? noPreset : draft.translation.presetId}
              onValueChange={(value) =>
                changeTranslation({ presetId: value === null || value === noPreset ? '' : value })
              }
            >
              <SelectTrigger aria-label="Detection preset" className="h-9 w-56 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noPreset}>Do not translate</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            label="Target language"
            description="Any language, like “Brazilian Portuguese”."
          >
            <Input
              aria-label="Target language"
              value={draft.translation.targetLanguage}
              className="h-9 w-56 rounded-full"
              onChange={(event) => changeTranslation({ targetLanguage: event.target.value })}
            />
          </SettingRow>
          <SettingRow label="Timeout" description="How long to wait for the preset.">
            <NumberField
              label="Translation timeout"
              value={draft.translation.timeoutSeconds}
              suffix="seconds"
              onChange={(value) =>
                changeTranslation({ timeoutSeconds: value ?? draft.translation.timeoutSeconds })
              }
            />
          </SettingRow>
          <SettingRow
            label="Attempts"
            description="The text is kept even when every attempt fails."
          >
            <NumberField
              label="Translation attempts"
              value={draft.translation.retryRounds}
              suffix="attempts"
              onChange={(value) =>
                changeTranslation({ retryRounds: value ?? draft.translation.retryRounds })
              }
            />
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsFooter
        note={
          <span className="inline-flex items-center gap-2">
            <ScanIcon />
            The newest {detectionHistoryLimit} detections are kept. Images are never stored.
          </span>
        }
        error={error}
        dirty={dirty}
        busy={busy}
        onDiscard={() => change(() => saved)}
        onSave={submit}
      />
    </div>
  )
}

export function DetectionsSettingsPage() {
  const settings = useAtomValue(detectionSettingsAtom)
  const state = useAtomValue(detectionsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Detections</h1>
      <p className="mt-1 text-muted-foreground">
        Read text from snips and images, and translate it automatically.
      </p>
      {AsyncResult.isSuccess(settings) && AsyncResult.isSuccess(state) ? (
        <DetectionSettingsForm saved={settings.value} engines={state.value.engines} />
      ) : null}
    </div>
  )
}
