import {
  type Coverage,
  type CoverageKey,
  coverageKeys,
  type ModeValues,
  standardCoverage,
  type TranslationMode,
  type TranslationSettings,
} from '#contract/GameTranslation'

export interface Option<Key extends string> {
  readonly key: Key
  readonly label: string
}

export const modes: ReadonlyArray<Option<TranslationMode> & { readonly tip: string }> = [
  {
    key: 'stable',
    label: 'Stable',
    tip: 'Best for local models and providers with strict limits.',
  },
  { key: 'balanced', label: 'Balanced', tip: 'Good default for most hosted models.' },
  { key: 'fast', label: 'Fast', tip: 'Sends more and larger batches at once. Needs high limits.' },
  { key: 'custom', label: 'Custom', tip: 'Your own values, edited under Advanced options.' },
]

export const modeSummary = (values: ModeValues) =>
  [
    `${values.workers} requests at a time`,
    `${values.chunkTokens}-token batches`,
    `${values.timeoutSeconds}s timeout`,
    `${values.retryRounds} retry rounds`,
  ].join(' · ')

export const textCoverageGroups: ReadonlyArray<{
  readonly label: string
  readonly options: ReadonlyArray<Option<CoverageKey>>
}> = [
  {
    label: 'Story',
    options: [
      { key: 'messages', label: 'Messages' },
      { key: 'scrollingText', label: 'Scrolling text' },
      { key: 'choices', label: 'Choices' },
      { key: 'speakerNames', label: 'Speaker names' },
      { key: 'nameChanges', label: 'Name and profile changes' },
    ],
  },
  {
    label: 'Found in',
    options: [
      { key: 'mapEvents', label: 'Map events' },
      { key: 'commonEvents', label: 'Common events' },
      { key: 'battleEvents', label: 'Battle events' },
    ],
  },
  {
    label: 'Names',
    options: [
      { key: 'mapDisplayNames', label: 'Map display names' },
      { key: 'mapListNames', label: 'Map list names' },
    ],
  },
]

export const databaseOptions: ReadonlyArray<Option<CoverageKey>> = [
  { key: 'actors', label: 'Actors' },
  { key: 'classes', label: 'Classes' },
  { key: 'skills', label: 'Skills' },
  { key: 'items', label: 'Items' },
  { key: 'weapons', label: 'Weapons' },
  { key: 'armors', label: 'Armors' },
  { key: 'enemies', label: 'Enemies' },
  { key: 'states', label: 'States' },
  { key: 'systemTerms', label: 'System terms' },
]

export const textCoverageOptions = textCoverageGroups.flatMap((group) => group.options)

type Filters = TranslationSettings['filters']

export const filterOptions: ReadonlyArray<Option<keyof Filters>> = [
  { key: 'skipEmpty', label: 'Skip empty text' },
  { key: 'skipPluginTags', label: 'Skip plugin tags like <tag>' },
  { key: 'skipFilenames', label: 'Skip file names' },
  { key: 'skipNumbers', label: 'Skip numbers' },
  { key: 'skipPunctuationOnly', label: 'Skip punctuation only' },
  { key: 'skipCodeLike', label: 'Skip values like true, null, auto' },
  { key: 'includeLatinText', label: 'Translate text already in Latin script' },
]

type Formatting = Omit<TranslationSettings['formatting'], 'maxLineLength'>

export const formattingOptions: ReadonlyArray<Option<keyof Formatting>> = [
  { key: 'preserveControlCodes', label: 'Keep control codes like \\C[2]' },
  { key: 'preservePlaceholders', label: 'Keep placeholders like %1' },
  { key: 'preserveLineBreaks', label: 'Keep line breaks' },
  { key: 'rejectBrokenFormatting', label: 'Skip lines that lose any of these' },
]

const only = (keys: ReadonlyArray<CoverageKey>): Coverage =>
  // SAFETY: the entries cover every coverage key, which is all a Coverage holds.
  Object.fromEntries(coverageKeys.map((key) => [key, keys.includes(key)])) as Coverage

export type CoveragePreset = 'story' | 'standard' | 'everything'

export const coveragePresets: Record<
  CoveragePreset,
  { readonly label: string; readonly blurb: string; readonly includes: string; coverage: Coverage }
> = {
  story: {
    label: 'Story only',
    blurb: 'Dialogue, choices and scrolling text.',
    includes:
      'Messages, scrolling text, choices, speaker names and name changes in map and common events. Menus, items and the database stay as they are.',
    coverage: only([
      'messages',
      'scrollingText',
      'choices',
      'speakerNames',
      'nameChanges',
      'mapEvents',
      'commonEvents',
    ]),
  },
  standard: {
    label: 'Standard',
    blurb: 'The story plus menus, items, skills and map names.',
    includes:
      'Messages, scrolling text, choices and speaker names in map and common events; database names and descriptions; system terms; map display names.',
    coverage: standardCoverage,
  },
  everything: {
    label: 'Everything',
    blurb: 'Adds battle scenes and map list names.',
    includes:
      'Everything in Standard, plus text in battle events and the map names shown in menus and save files.',
    coverage: only(coverageKeys),
  },
}

export const coveragePresetOf = (coverage: Coverage): CoveragePreset | 'custom' =>
  (['story', 'standard', 'everything'] as const).find((preset) =>
    coverageKeys.every((key) => coveragePresets[preset].coverage[key] === coverage[key]),
  ) ?? 'custom'
