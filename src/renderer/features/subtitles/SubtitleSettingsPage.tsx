import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { WaveformIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Predicate, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  type Sensitivity,
  type SubtitleDevice,
  type SpeechModelId,
  speechModels,
  type SubtitleOverlayMode,
  SubtitleSettings,
} from '#contract/Subtitles'
import { formErrorOf } from '#lib/forms'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Slider } from '#ui/slider'
import { Switch } from '#ui/switch'
import { ToggleGroup, ToggleGroupItem } from '#ui/toggle-group'
import { pluginsAtom } from '../plugins/plugins'
import { NumberField, SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import {
  audioSourcesAtom,
  saveSubtitleSettingsAtom,
  subtitleSettingsAtom,
  subtitleSettingsKeys,
} from './subtitles'
import { SpeechModelMenu } from './SpeechModelMenu'

const sameSettings = Schema.toEquivalence(SubtitleSettings)

const detect = 'detect'

const defaultOutput = 'default'

const spokenLanguages: Record<string, string> = {
  [detect]: 'Detect automatically',
  ja: 'Japanese',
  zh: 'Chinese',
  yue: 'Cantonese',
  ko: 'Korean',
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
}

function Segmented<A extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: A
  readonly options: ReadonlyArray<readonly [A, string]>
  readonly onChange: (value: A) => void
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      className="rounded-full bg-foreground/6 p-[3px]"
      onValueChange={(next) => {
        const chosen = options.find(([option]) => next.includes(option))

        if (chosen !== undefined) {
          onChange(chosen[0])
        }
      }}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem
          key={option}
          value={option}
          className={cn(
            'h-7 rounded-full px-3 text-[13px] font-normal text-muted-foreground hover:bg-transparent',
            'data-pressed:bg-background data-pressed:font-medium data-pressed:text-foreground data-pressed:shadow-card',
          )}
        >
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function ModelRow({
  value,
  onChange,
}: {
  readonly value: SpeechModelId
  readonly onChange: (model: SpeechModelId) => void
}) {
  const plugins = useAtomValue(pluginsAtom)

  const plugin = AsyncResult.isSuccess(plugins)
    ? plugins.value.plugins.find((candidate) => candidate.id === value)
    : undefined

  const ready = plugin?.installed?.test.passed === true

  return (
    <SettingRow
      label="Model"
      description={
        ready
          ? plugin?.installed?.test.message
          : `Install ${speechModels[value].name} to use Live Subtitles.`
      }
    >
      <SpeechModelMenu value={value} onChange={onChange} />
    </SettingRow>
  )
}

function OutputSelect({
  value,
  onChange,
}: {
  readonly value: string | undefined
  readonly onChange: (outputId: string | undefined) => void
}) {
  const sources = useAtomValue(audioSourcesAtom)
  const outputs = AsyncResult.isSuccess(sources) ? sources.value.outputs : []
  const fallback = outputs.find((output) => output.isDefault)

  const items = {
    [defaultOutput]: `Default${fallback === undefined ? '' : ` (${fallback.name})`}`,
    ...Object.fromEntries(outputs.map((output) => [output.id, output.name])),
  }

  return (
    <Select
      items={items}
      value={value ?? defaultOutput}
      onValueChange={(next) => onChange(next === null || next === defaultOutput ? undefined : next)}
    >
      <SelectTrigger aria-label="Computer audio from" className="h-9 w-64 rounded-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SubtitleSettingsForm({ saved }: { readonly saved: SubtitleSettings }) {
  const save = useAtomSet(saveSubtitleSettingsAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dirty = !sameSettings(draft, saved)

  const change = (patch: Partial<SubtitleSettings>) => {
    setError(undefined)
    setDraft((current) => ({ ...current, ...patch }))
  }

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: subtitleSettingsKeys })

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
        title="Speech recognition"
        description="The speech model runs on this PC. Only the finished lines are sent to your preset."
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <ModelRow value={draft.model} onChange={(model) => change({ model })} />
          <SettingRow label="Run on" description="Auto uses the GPU when there is one.">
            <Segmented<SubtitleDevice>
              label="Run on"
              value={draft.device}
              options={[
                ['auto', 'Auto'],
                ['gpu', 'GPU'],
                ['cpu', 'CPU'],
              ]}
              onChange={(device) => change({ device })}
            />
          </SettingRow>
          <SettingRow
            label="Spoken language"
            description="Detected line by line. Fix it when short lines come out in the wrong language."
          >
            <Select
              items={spokenLanguages}
              value={draft.spokenLanguage ?? detect}
              onValueChange={(next) => {
                const { spokenLanguage: _previous, ...rest } = draft

                setError(undefined)

                setDraft(
                  next === null || next === detect ? rest : { ...rest, spokenLanguage: next },
                )
              }}
            >
              <SelectTrigger aria-label="Spoken language" className="h-9 w-64 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(spokenLanguages).map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            label="Computer audio from"
            description="The output Computer audio listens to."
          >
            <OutputSelect
              value={draft.outputId}
              onChange={(outputId) => {
                const { outputId: _previous, ...rest } = draft

                setError(undefined)
                setDraft(outputId === undefined ? rest : { ...rest, outputId })
              }}
            />
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Lines"
        description="When a line ends, and how long it waits for the rest of a sentence."
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <SettingRow
            label="Sensitivity"
            description="High picks up quiet voices, and more background noise."
          >
            <Segmented<Sensitivity>
              label="Sensitivity"
              value={draft.sensitivity}
              options={[
                ['low', 'Low'],
                ['normal', 'Normal'],
                ['high', 'High'],
              ]}
              onChange={(sensitivity) => change({ sensitivity })}
            />
          </SettingRow>
          <SettingRow
            label="End-of-speech pause"
            description="Silence that ends a line. Long speech ends at shorter breaths anyway."
          >
            <span className="inline-flex items-center gap-3">
              <Slider
                aria-label="End-of-speech pause"
                className="w-40"
                min={250}
                max={1000}
                step={50}
                value={draft.pauseMs}
                onValueChange={(value) => {
                  const pauseMs = Predicate.isNumber(value) ? value : value[0]

                  if (pauseMs !== undefined) {
                    change({ pauseMs })
                  }
                }}
              />
              <span className="w-16 text-[12.5px] text-muted-foreground tabular-nums">
                {draft.pauseMs} ms
              </span>
            </span>
          </SettingRow>
          <SettingRow
            label="Wait for full sentences"
            description="Joins a line cut mid-sentence with the next one, waiting up to half a second."
          >
            <Switch
              aria-label="Wait for full sentences"
              checked={draft.waitForSentences}
              onCheckedChange={(waitForSentences) => change({ waitForSentences })}
            />
          </SettingRow>
          <SettingRow
            label="Context"
            description="Earlier lines sent with each new one, for names and who is speaking."
          >
            <NumberField
              label="Context lines"
              value={draft.contextLines}
              suffix="lines"
              onChange={(value) => change({ contextLines: value ?? draft.contextLines })}
            />
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsCard title="Overlay" description="How lines look over the game." className="gap-1">
        <div className="flex flex-col divide-y">
          <SettingRow label="Show">
            <Segmented<SubtitleOverlayMode>
              label="Show"
              value={draft.overlayMode}
              options={[
                ['both', 'Original and translation'],
                ['translation', 'Translation only'],
              ]}
              onChange={(overlayMode) => change({ overlayMode })}
            />
          </SettingRow>
          <SettingRow
            label="Hide from screen captures"
            description="Recordings and streams will not show the subtitles."
          >
            <Switch
              aria-label="Hide from screen captures"
              checked={draft.hideFromCapture}
              onCheckedChange={(hideFromCapture) => change({ hideFromCapture })}
            />
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsFooter
        note={
          <span className="inline-flex items-center gap-2">
            <WaveformIcon />
            Lines are kept in memory only, until Wenbu closes.
          </span>
        }
        error={error}
        dirty={dirty}
        busy={busy}
        onDiscard={() => setDraft(saved)}
        onSave={submit}
      />
    </div>
  )
}

export function SubtitleSettingsPage() {
  const settings = useAtomValue(subtitleSettingsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Live Subtitles</h1>
      <p className="mt-1 text-muted-foreground">
        How speech is heard, cut into lines and shown. Source, language and preset are set in the
        Subtitles popover.
      </p>
      {AsyncResult.isSuccess(settings) ? <SubtitleSettingsForm saved={settings.value} /> : null}
    </div>
  )
}
