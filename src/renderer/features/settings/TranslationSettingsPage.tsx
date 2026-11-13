import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { GaugeIcon, InfoIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { modeValues, type TranslationMode, TranslationSettings } from '#contract/GameTranslation'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Switch } from '#ui/switch'
import { SpendLimitField } from '../library/components/SpendLimitField'
import { saveTranslationSettingsAtom, translationSettingsAtom } from '../library/library'
import {
  AdvancedTranslationOptions,
  type ChangeSettings,
} from './components/AdvancedTranslationOptions'
import { Note, SettingRow, SettingsCard } from './components/SettingsCard'
import { SettingsFooter } from './components/SettingsFooter'
import {
  type CoveragePreset,
  coveragePresetOf,
  coveragePresets,
  modes,
  modeSummary,
} from './utils/translationOptions'

const sameSettings = Schema.toEquivalence(TranslationSettings)

const commonAdjustments = [
  {
    key: 'speakerNames',
    label: 'Speaker names',
    description: 'The name shown above a message box in RPG Maker MZ games.',
  },
  {
    key: 'mapListNames',
    label: 'Map list names',
    description: 'Names in menus, save files and location popups.',
  },
  {
    key: 'battleEvents',
    label: 'Battle event text',
    description: 'Dialogue and choices inside troop battle events.',
  },
] as const

function SpeedCard({
  settings,
  onMode,
}: {
  readonly settings: TranslationSettings
  readonly onMode: (mode: TranslationMode) => void
}) {
  const mode = modes.find((candidate) => candidate.key === settings.mode)

  return (
    <SettingsCard
      title="Translation speed"
      description="How hard Wenbu pushes the model. Slower settings suit local models and strict rate limits."
    >
      <div className="grid grid-cols-4 gap-1 rounded-full border bg-muted/40 p-1">
        {modes.map((option) => (
          <Button
            key={option.key}
            variant="ghost"
            aria-pressed={settings.mode === option.key}
            className={cn(
              'h-[30px] rounded-full text-[13px] text-muted-foreground',
              settings.mode === option.key && 'bg-background text-foreground shadow-card',
            )}
            onClick={() => onMode(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <Note Icon={settings.mode === 'custom' ? SlidersHorizontalIcon : GaugeIcon}>
        <span>{mode?.tip}</span>
        <span className="font-mono text-xs opacity-80">{modeSummary(settings)}</span>
      </Note>
    </SettingsCard>
  )
}

function CoverageCard({
  settings,
  onPreset,
}: {
  readonly settings: TranslationSettings
  readonly onPreset: (preset: CoveragePreset) => void
}) {
  const active = coveragePresetOf(settings.coverage)

  return (
    <SettingsCard title="Translation coverage" description="How much of the game Wenbu translates.">
      <div className="grid grid-cols-3 gap-2.5">
        {(['story', 'standard', 'everything'] as const).map((preset) => (
          <Button
            key={preset}
            variant="ghost"
            aria-pressed={active === preset}
            className={cn(
              'h-auto flex-col items-stretch justify-start gap-1 rounded-2xl border-[1.5px] border-border px-4 py-3.5 text-left font-normal whitespace-normal hover:bg-muted/40',
              active === preset &&
                'border-primary bg-primary/8 ring-3 ring-primary/12 hover:bg-primary/8',
            )}
            onClick={() => onPreset(preset)}
          >
            <span className="flex items-center justify-between gap-2 font-medium">
              {coveragePresets[preset].label}
              <span
                aria-hidden
                className={cn(
                  'size-4 rounded-full border-[1.5px] border-muted-foreground bg-background',
                  active === preset && 'border-5 border-primary',
                )}
              />
            </span>
            <span className="text-[12.5px] text-muted-foreground">
              {coveragePresets[preset].blurb}
            </span>
          </Button>
        ))}
      </div>
      <Note
        Icon={InfoIcon}
        title={
          active === 'custom'
            ? 'Your own selection'
            : `What ${coveragePresets[active].label} includes`
        }
      >
        {active === 'custom'
          ? 'Change single kinds of text under Advanced options.'
          : coveragePresets[active].includes}{' '}
        Comments, plugin commands, scripts and notes are never translated: games read them as code.
      </Note>
    </SettingsCard>
  )
}

function CommonAdjustments({
  settings,
  onChange,
}: {
  readonly settings: TranslationSettings
  readonly onChange: ChangeSettings
}) {
  return (
    <SettingsCard
      title="Common adjustments"
      description="The options most games need. Each one updates your coverage above."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        {commonAdjustments.map((adjustment) => (
          <SettingRow
            key={adjustment.key}
            label={adjustment.label}
            description={adjustment.description}
          >
            <Switch
              aria-label={adjustment.label}
              checked={settings.coverage[adjustment.key]}
              onCheckedChange={(on) =>
                onChange((current) => ({
                  ...current,
                  coverage: { ...current.coverage, [adjustment.key]: on },
                }))
              }
            />
          </SettingRow>
        ))}
        <SettingRow
          label="Translate repeated text once"
          description="The same line gets the same translation everywhere. Saves tokens."
        >
          <Switch
            aria-label="Translate repeated text once"
            checked={settings.reuseDuplicates}
            onCheckedChange={(reuseDuplicates) =>
              onChange((current) => ({ ...current, reuseDuplicates }))
            }
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

const withConfirmAbove = (
  settings: TranslationSettings,
  amount: number | undefined,
): TranslationSettings => {
  const { confirmAboveUsd: _old, ...rest } = settings

  return amount === undefined ? rest : { ...rest, confirmAboveUsd: amount }
}

const withSpendLimit = (
  settings: TranslationSettings,
  spendLimit: TranslationSettings['spendLimit'],
): TranslationSettings => {
  const { spendLimit: _old, ...rest } = settings

  return spendLimit === undefined || Object.keys(spendLimit).length === 0
    ? rest
    : { ...rest, spendLimit }
}

function SpendingCard({
  settings,
  onChange,
}: {
  readonly settings: TranslationSettings
  readonly onChange: ChangeSettings
}) {
  return (
    <SettingsCard
      title="Spending"
      description="Estimates use each model's price from models.dev. A run that reaches its limit stops sending text and writes what it translated."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        <SettingRow
          label="Spending limit per run"
          description="Each game page shows it, and a run can raise it while it runs."
        >
          <SpendLimitField
            key={String(settings.spendLimit?.usd)}
            label="Spending limit per run"
            limit={settings.spendLimit}
            priced
            onCommit={(spendLimit) => onChange((current) => withSpendLimit(current, spendLimit))}
          />
        </SettingRow>
        <SettingRow
          label="Ask before runs over"
          description="Shows the estimate and asks before a run likely to cost more than this."
        >
          <SpendLimitField
            key={String(settings.confirmAboveUsd)}
            label="Ask before runs over"
            limit={settings.confirmAboveUsd === undefined ? {} : { usd: settings.confirmAboveUsd }}
            priced
            onCommit={(limit) => onChange((current) => withConfirmAbove(current, limit.usd))}
          />
        </SettingRow>
        <SettingRow
          label="Models without a price"
          description="Local and unlisted models are limited by tokens instead."
        >
          <SpendLimitField
            key={String(settings.spendLimit?.tokens)}
            className="w-40"
            label="Token limit per run"
            limit={settings.spendLimit}
            priced={false}
            onCommit={(spendLimit) => onChange((current) => withSpendLimit(current, spendLimit))}
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function TranslationSettingsForm({ saved }: { readonly saved: TranslationSettings }) {
  const save = useAtomSet(saveTranslationSettingsAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(saved)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dirty = !sameSettings(draft, saved)

  const change: ChangeSettings = (update) => {
    setError(undefined)
    setDraft(update)
  }

  const setMode = (mode: TranslationMode) => {
    change((current) => ({ ...current, mode, ...(mode === 'custom' ? {} : modeValues[mode]) }))

    if (mode === 'custom') {
      setAdvancedOpen(true)
      setSpeedOpen(true)
    }
  }

  const submit = async () => {
    setBusy(true)

    const exit = await save({
      payload: { ...draft, presetId: saved.presetId, targetLanguage: saved.targetLanguage },
      reactivityKeys: ['translation-settings'],
    })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setDraft(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="mt-6 flex flex-1 flex-col gap-5">
      <SpeedCard settings={draft} onMode={setMode} />
      <CoverageCard
        settings={draft}
        onPreset={(preset) =>
          change((current) => ({ ...current, coverage: coveragePresets[preset].coverage }))
        }
      />
      <CommonAdjustments settings={draft} onChange={change} />
      <SpendingCard settings={draft} onChange={change} />
      <AdvancedTranslationOptions
        settings={draft}
        modeLabel={modes.find((mode) => mode.key === draft.mode)?.label ?? ''}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        speedOpen={speedOpen}
        onSpeedOpenChange={setSpeedOpen}
        onChange={change}
      />

      <SettingsFooter
        error={error}
        dirty={dirty}
        busy={busy}
        onDiscard={() => change(() => saved)}
        onSave={submit}
      />
    </div>
  )
}

export function TranslationSettingsPage() {
  const result = useAtomValue(translationSettingsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Game translation</h1>
      <p className="mt-1 text-muted-foreground">
        Defaults for every RPG Maker game. The model preset and target language are chosen on each
        game's page.
      </p>
      {AsyncResult.isSuccess(result) ? <TranslationSettingsForm saved={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
      ) : null}
    </div>
  )
}
