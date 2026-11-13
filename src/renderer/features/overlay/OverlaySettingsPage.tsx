import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { InfoIcon, MonitorPlayIcon } from '@phosphor-icons/react'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { LlmModel, LlmSettings } from '#contract/Llm'
import {
  type ContextMode,
  contextBudget,
  defaultContextLines,
  type OnNewLine,
  OverlaySettings,
} from '#contract/TranslationOverlay'
import { formErrorOf } from '#lib/forms'
import { Input } from '#ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { formatUsd } from '../library/library'
import { Note, NumberField, SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import { compactTokens, useLlmSettings, useModelCatalog } from '../settings/llm'
import { overlaySettingsAtom, overlaySettingsKeys, saveOverlaySettingsAtom } from './overlay'

const sameSettings = Schema.toEquivalence(OverlaySettings)

const noPreset = 'none'

const newLineLabels: Record<OnNewLine, string> = {
  cancel: 'Translate the new line at once',
  finish: 'Finish the request first',
}

const contextLabels: Record<ContextMode, string> = {
  off: 'Off',
  recent: 'Recent lines',
  summary: 'Story summary',
}

const contextDescriptions: Record<ContextMode, string> = {
  off: 'Each line is translated on its own. Cheapest.',
  recent:
    'The last lines and their translations go with each new line, so speakers, names and tone carry over.',
  summary:
    'A short story summary plus the last few lines go with each new line. The summary is refreshed in the background and kept for the next session.',
}

const modelOf = (settings: LlmSettings, catalog: ReadonlyArray<LlmModel>, presetId: string) => {
  const preset = settings.presets.find((candidate) => candidate.id === presetId)
  const connection = settings.connections.find((candidate) => candidate.id === preset?.connectionId)

  const model = catalog.find(
    (candidate) => candidate.provider === connection?.provider && candidate.id === preset?.modelId,
  )

  return { preset, model }
}

function BudgetNote({
  draft,
  llm,
  catalog,
}: {
  readonly draft: OverlaySettings
  readonly llm: LlmSettings | undefined
  readonly catalog: ReadonlyArray<LlmModel>
}) {
  if (draft.context.mode === 'off' || llm === undefined || draft.presetId === '') {
    return null
  }

  const { preset, model } = modelOf(llm, catalog, draft.presetId)

  const budget = contextBudget(
    {
      contextWindow: model?.contextWindow,
      maxOutputTokens: preset?.maxOutputTokens,
    },
    draft.context,
    0,
  )

  const allowed =
    model === undefined
      ? 'this model is not in the catalog, so Wenbu assumes 8K tokens of context'
      : `${model.name} allows ${compactTokens(model.contextWindow)}`

  const rate = model?.price?.cacheRead ?? model?.price?.input

  return (
    <Note Icon={InfoIcon} title={`Up to ${compactTokens(budget)} tokens of context per line`}>
      <span>
        {allowed}.
        {rate === undefined
          ? ''
          : ` At most about ${formatUsd((budget * rate) / 1_000_000)} extra per line, less when the provider caches the repeated context.`}
      </span>
    </Note>
  )
}

function OverlaySettingsForm({ saved }: { readonly saved: OverlaySettings }) {
  const save = useAtomSet(saveOverlaySettingsAtom, { mode: 'promiseExit' })
  const llmResult = useLlmSettings()
  const catalog = useModelCatalog()
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const llm = AsyncResult.isSuccess(llmResult) ? llmResult.value : undefined
  const presets = llm?.presets ?? []
  const dirty = !sameSettings(draft, saved)

  const change = (patch: Partial<OverlaySettings>) => {
    setError(undefined)
    setDraft((current) => ({ ...current, ...patch }))
  }

  const changeContext = (patch: Partial<OverlaySettings['context']>) =>
    change({ context: { ...draft.context, ...patch } })

  const changeMode = (mode: ContextMode) =>
    changeContext({ mode, lines: mode === 'off' ? draft.context.lines : defaultContextLines[mode] })

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: overlaySettingsKeys })

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
        title="Live overlay translation"
        description="The preset, languages and request behaviour used to translate captured hook text."
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <SettingRow label="Preset">
            <Select
              items={{
                [noPreset]: 'Choose a preset',
                ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
              }}
              value={draft.presetId === '' ? noPreset : draft.presetId}
              onValueChange={(value) =>
                change({ presetId: value === null || value === noPreset ? '' : value })
              }
            >
              <SelectTrigger aria-label="Overlay preset" className="h-9 w-56 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noPreset}>Choose a preset</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Game language" description="The language the game is in.">
            <Input
              aria-label="Game language"
              value={draft.sourceLanguage}
              className="h-9 w-56 rounded-full"
              onChange={(event) => change({ sourceLanguage: event.target.value })}
            />
          </SettingRow>
          <SettingRow
            label="Target language"
            description="Any language, like “Brazilian Portuguese”."
          >
            <Input
              aria-label="Target language"
              value={draft.targetLanguage}
              className="h-9 w-56 rounded-full"
              onChange={(event) => change({ targetLanguage: event.target.value })}
            />
          </SettingRow>
          <SettingRow label="Timeout" description="How long to wait for the preset.">
            <NumberField
              label="Overlay timeout"
              value={draft.timeoutSeconds}
              suffix="seconds"
              onChange={(value) => change({ timeoutSeconds: value ?? draft.timeoutSeconds })}
            />
          </SettingRow>
          <SettingRow label="Attempts" description="Tries before a line is shown as failed.">
            <NumberField
              label="Overlay attempts"
              value={draft.retryRounds}
              suffix="attempts"
              onChange={(value) => change({ retryRounds: value ?? draft.retryRounds })}
            />
          </SettingRow>
          <SettingRow
            label="When a new line arrives"
            description={
              draft.onNewLine === 'cancel'
                ? 'The request in flight is stopped. Fastest, though the provider may still bill what it read.'
                : 'The request in flight finishes and is cached; only the newest waiting line is translated next.'
            }
          >
            <Select
              items={newLineLabels}
              value={draft.onNewLine}
              onValueChange={(value) => change({ onNewLine: value ?? draft.onNewLine })}
            >
              <SelectTrigger aria-label="When a new line arrives" className="h-9 w-56 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cancel">{newLineLabels.cancel}</SelectItem>
                <SelectItem value="finish">{newLineLabels.finish}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Context"
        description="Context helps with speakers, pronouns and names, but it is sent again with every line, so it costs tokens."
        className="gap-1"
      >
        <div className="flex flex-col divide-y">
          <SettingRow label="Mode" description={contextDescriptions[draft.context.mode]}>
            <Select
              items={contextLabels}
              value={draft.context.mode}
              onValueChange={(value) => changeMode(value ?? draft.context.mode)}
            >
              <SelectTrigger aria-label="Context mode" className="h-9 w-56 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{contextLabels.off}</SelectItem>
                <SelectItem value="recent">{contextLabels.recent}</SelectItem>
                <SelectItem value="summary">{contextLabels.summary}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          {draft.context.mode === 'off' ? null : (
            <>
              <SettingRow label="Recent lines" description="Earlier lines sent with each new one.">
                <NumberField
                  label="Recent lines"
                  value={draft.context.lines}
                  suffix="lines"
                  onChange={(value) => changeContext({ lines: value ?? draft.context.lines })}
                />
              </SettingRow>
              <SettingRow
                label="Context limit"
                description="The most context sent with a line. The model's window can lower it."
              >
                <NumberField
                  label="Context limit"
                  value={draft.context.maxTokens}
                  suffix="tokens"
                  onChange={(value) =>
                    changeContext({ maxTokens: value ?? draft.context.maxTokens })
                  }
                />
              </SettingRow>
            </>
          )}
          {draft.context.mode === 'summary' ? (
            <SettingRow
              label="Refresh the summary"
              description="After this many translated lines, in the background."
            >
              <NumberField
                label="Summary refresh"
                value={draft.context.summaryEvery}
                suffix="lines"
                onChange={(value) =>
                  changeContext({ summaryEvery: value ?? draft.context.summaryEvery })
                }
              />
            </SettingRow>
          ) : null}
        </div>
        <BudgetNote draft={draft} llm={llm} catalog={catalog} />
      </SettingsCard>

      <SettingsFooter
        note={
          <span className="inline-flex items-center gap-2">
            <MonitorPlayIcon />
            Translations are cached per game and target language.
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

export function OverlaySettingsPage() {
  const settings = useAtomValue(overlaySettingsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Translation overlay</h1>
      <p className="mt-1 text-muted-foreground">
        Translate text from running games live, in a window over the game.
      </p>
      {AsyncResult.isSuccess(settings) ? <OverlaySettingsForm saved={settings.value} /> : null}
    </div>
  )
}
