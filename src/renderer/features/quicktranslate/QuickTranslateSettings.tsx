import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { QuickTranslateSettings as Settings } from '#contract/QuickTranslate'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Switch } from '#ui/switch'
import { SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { useLlmSettings } from '../settings/llm'
import {
  quickTranslateKeys,
  quickTranslateSettingsAtom,
  saveQuickTranslateSettingsAtom,
} from './quickTranslate'

const noPreset = 'none'

function Key({ name }: { readonly name: string }) {
  return (
    <kbd className="rounded-md px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground ring-1 ring-border">
      {name}
    </kbd>
  )
}

function QuickTranslateForm({ settings }: { readonly settings: Settings }) {
  const save = useAtomSet(saveQuickTranslateSettingsAtom)
  const llm = useLlmSettings()
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  const change = (next: Partial<Settings>) =>
    save({ payload: { ...settings, ...next }, reactivityKeys: quickTranslateKeys })

  return (
    <SettingsCard
      title="Quick Translate"
      description="Select text in any app and press C twice while holding Ctrl. Wenbu opens a card with the text in English, and you can ask about it."
      className="gap-1"
    >
      <SettingRow label="Translate with Ctrl+C+C" description="Works in any app while Wenbu runs">
        <Switch checked={settings.enabled} onCheckedChange={(enabled) => change({ enabled })} />
      </SettingRow>
      <SettingRow label="Model" description="The preset that translates and answers">
        <Select
          items={{
            [noPreset]: 'Choose a preset',
            ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
          }}
          value={settings.presetId === '' ? noPreset : settings.presetId}
          onValueChange={(value) =>
            change({ presetId: value === null || value === noPreset ? '' : value })
          }
        >
          <SelectTrigger aria-label="Quick Translate preset" className="h-9 w-56 rounded-full">
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
      <SettingRow label="Shortcut" description="Hold Ctrl, then press C twice quickly">
        <span className="inline-flex gap-1">
          <Key name="Ctrl" />
          <Key name="C" />
          <Key name="C" />
        </span>
      </SettingRow>
    </SettingsCard>
  )
}

export function QuickTranslateSettings() {
  const result = useAtomValue(quickTranslateSettingsAtom)

  return AsyncResult.isSuccess(result) ? <QuickTranslateForm settings={result.value} /> : null
}
