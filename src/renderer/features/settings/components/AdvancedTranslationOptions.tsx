import { LockSimpleIcon } from '@phosphor-icons/react'
import type { CoverageKey, TranslationSettings } from '#contract/GameTranslation'
import {
  databaseOptions,
  filterOptions,
  formattingOptions,
  type Option,
  textCoverageGroups,
  textCoverageOptions,
} from '../utils/translationOptions'
import { Note, NumberField, Section, SettingRow, SwitchRow } from './SettingsCard'

export type ChangeSettings = (
  change: (settings: TranslationSettings) => TranslationSettings,
) => void

const countOn = <Key extends string>(
  options: ReadonlyArray<Option<Key>>,
  isOn: (key: Key) => boolean,
) => `${options.filter((option) => isOn(option.key)).length} of ${options.length} on`

function SwitchGrid<Key extends string>({
  options,
  isOn,
  onChange,
}: {
  readonly options: ReadonlyArray<Option<Key>>
  readonly isOn: (key: Key) => boolean
  readonly onChange: (key: Key, on: boolean) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
      {options.map((option) => (
        <SwitchRow
          key={option.key}
          label={option.label}
          checked={isOn(option.key)}
          onChange={(on) => onChange(option.key, on)}
        />
      ))}
    </div>
  )
}

const speedFields = [
  { key: 'workers', label: 'Requests at a time', suffix: 'requests' },
  { key: 'chunkTokens', label: 'Batch size', suffix: 'tokens' },
  { key: 'timeoutSeconds', label: 'Timeout', suffix: 'seconds' },
  { key: 'retryRounds', label: 'Retry rounds', suffix: 'rounds' },
] as const

export function AdvancedTranslationOptions({
  settings,
  modeLabel,
  open,
  onOpenChange,
  speedOpen,
  onSpeedOpenChange,
  onChange,
}: {
  readonly settings: TranslationSettings
  readonly modeLabel: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly speedOpen: boolean
  readonly onSpeedOpenChange: (open: boolean) => void
  readonly onChange: ChangeSettings
}) {
  const custom = settings.mode === 'custom'
  const isCovered = (key: CoverageKey) => settings.coverage[key]

  const setCoverage = (key: CoverageKey, on: boolean) =>
    onChange((current) => ({ ...current, coverage: { ...current.coverage, [key]: on } }))

  const setLongestLine = (maxLineLength: number | undefined) =>
    onChange((current) => {
      const { maxLineLength: _previous, ...formatting } = current.formatting

      return {
        ...current,
        formatting: maxLineLength === undefined ? formatting : { ...formatting, maxLineLength },
      }
    })

  return (
    <Section
      plain
      title="Advanced options"
      description="The exact text, database fields and safety rules. Most games need no changes here."
      summary={countOn([...textCoverageOptions, ...databaseOptions], isCovered)}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-2.5">
        <Section
          title="Speed values"
          description="Batching, retries and request limits."
          open={speedOpen}
          onOpenChange={onSpeedOpenChange}
        >
          {custom ? null : (
            <Note Icon={LockSimpleIcon}>
              These values come from {modeLabel}. Set the speed to Custom to edit them.
            </Note>
          )}
          {speedFields.map((field) => (
            <SettingRow key={field.key} label={field.label}>
              <NumberField
                label={field.label}
                value={settings[field.key]}
                suffix={field.suffix}
                disabled={!custom}
                onChange={(value) =>
                  onChange((current) => ({ ...current, [field.key]: value ?? current[field.key] }))
                }
              />
            </SettingRow>
          ))}
        </Section>

        <Section
          title="Text"
          description="Event text is translated when both its kind and the place it is in are on."
          summary={countOn(textCoverageOptions, isCovered)}
        >
          <div className="flex flex-col gap-2.5">
            {textCoverageGroups.map((group) => (
              <div key={group.label}>
                <div className="px-0.5 pb-0.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                  {group.label}
                </div>
                <SwitchGrid options={group.options} isOn={isCovered} onChange={setCoverage} />
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Database"
          description="Names and descriptions from the game database."
          summary={countOn(databaseOptions, isCovered)}
        >
          <SwitchGrid options={databaseOptions} isOn={isCovered} onChange={setCoverage} />
        </Section>

        <Section
          title="Skip rules"
          description="Values that are not text a player reads."
          summary={countOn(filterOptions, (key) => settings.filters[key])}
        >
          <SwitchGrid
            options={filterOptions}
            isOn={(key) => settings.filters[key]}
            onChange={(key, on) =>
              onChange((current) => ({ ...current, filters: { ...current.filters, [key]: on } }))
            }
          />
        </Section>

        <Section title="Formatting" description="Control codes, placeholders and line structure.">
          <SwitchGrid
            options={formattingOptions}
            isOn={(key) => settings.formatting[key]}
            onChange={(key, on) =>
              onChange((current) => ({
                ...current,
                formatting: { ...current.formatting, [key]: on },
              }))
            }
          />
          <div className="my-3 h-px bg-border" />
          <SettingRow
            label="Longest line"
            description="Wraps translated lines that would overflow the message window."
          >
            <NumberField
              label="Longest line"
              value={settings.formatting.maxLineLength}
              placeholder="Off"
              suffix="characters"
              onChange={setLongestLine}
            />
          </SettingRow>
        </Section>
      </div>
    </Section>
  )
}
