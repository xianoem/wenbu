import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { InfoIcon } from '@phosphor-icons/react'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { bundledFonts, MangaSettings, mangaLanguages } from '#contract/Manga'
import { formErrorOf } from '#lib/forms'
import { screenAtom } from '#lib/navigation'
import { useLocalFonts } from '#lib/useLocalFonts'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#ui/select'
import { Switch } from '#ui/switch'
import { isPluginReady, pluginsAtom } from '../plugins/plugins'
import { type Choice, ChoiceSelect } from '../settings/components/ChoiceSelect'
import { Note, NumberField, SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import { useLlmSettings } from '../settings/llm'
import { mangaSettingsAtom, mangaSettingsKeys, saveMangaSettingsAtom } from './manga'

const sameSettings = Schema.toEquivalence(MangaSettings)

type Change = (update: (settings: MangaSettings) => MangaSettings) => void

const noPreset = 'none'

const detectionSizes: ReadonlyArray<Choice<MangaSettings['detectionSize']>> = [
  { value: 1536, label: '1536 px · faster, may miss small text' },
  { value: 2048, label: '2048 px · recommended' },
  { value: 2560, label: '2560 px · finds smaller text, slower' },
]

const inpaintingModes: ReadonlyArray<Choice<MangaSettings['inpainting']>> = [
  { value: 'regions', label: 'Around each text · sharp on large pages' },
  { value: 'page', label: 'Whole page · like manga-image-translator' },
]

const inpaintingSizes: ReadonlyArray<Choice<MangaSettings['inpaintingSize']>> = [
  { value: 1024, label: '1024 px · faster' },
  { value: 1536, label: '1536 px' },
  { value: 2048, label: '2048 px · recommended' },
  { value: 2560, label: '2560 px · sharper, more memory' },
]

const supersamplings: ReadonlyArray<Choice<MangaSettings['supersampling']>> = [
  { value: 1, label: 'Off · fastest' },
  { value: 2, label: '2× · nearly as smooth' },
  { value: 4, label: '4× · smoothest' },
]

const outputFormats: ReadonlyArray<Choice<MangaSettings['outputFormat']>> = [
  { value: 'source', label: 'Same as each page' },
  { value: 'png', label: 'PNG · lossless' },
  { value: 'webp', label: 'WebP' },
  { value: 'jpeg', label: 'JPEG' },
]

const existingChoices: ReadonlyArray<Choice<MangaSettings['existingPages']>> = [
  { value: 'skip', label: 'Skip them · continue an earlier run' },
  { value: 'overwrite', label: 'Translate them again' },
]

const textColorModes: ReadonlyArray<Choice<'auto' | 'custom'>> = [
  { value: 'auto', label: 'Automatic' },
  { value: 'custom', label: 'Custom' },
]

const languageChoices: ReadonlyArray<Choice<MangaSettings['targetLanguage']>> = mangaLanguages.map(
  (language) => ({ value: language.code, label: language.name }),
)

function TranslationCard({
  settings,
  onChange,
}: {
  readonly settings: MangaSettings
  readonly onChange: Change
}) {
  const llm = useLlmSettings()
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  return (
    <SettingsCard
      title="Translation"
      description="Wenbu sends each page's text to this preset, numbered line by line."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        <SettingRow label="Preset">
          <Select
            items={{
              [noPreset]: 'Choose a preset',
              ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
            }}
            value={settings.presetId === '' ? noPreset : settings.presetId}
            onValueChange={(value) =>
              onChange((current) => ({
                ...current,
                presetId: value === null || value === noPreset ? '' : value,
              }))
            }
          >
            <SelectTrigger aria-label="Manga preset" className="h-9 w-56 rounded-full">
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
        <SettingRow label="Translate into">
          <ChoiceSelect
            label="Target language"
            choices={languageChoices}
            value={settings.targetLanguage}
            width="w-56"
            onChange={(targetLanguage) => onChange((current) => ({ ...current, targetLanguage }))}
          />
        </SettingRow>
        <SettingRow
          label="Pages at once"
          description="Pages whose text is with the preset at the same time."
        >
          <NumberField
            label="Pages translated at once"
            value={settings.parallelRequests}
            suffix="pages"
            onChange={(value) =>
              onChange((current) => ({
                ...current,
                parallelRequests: value ?? current.parallelRequests,
              }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Timeout"
          description="How long to wait for the preset to answer one page."
        >
          <NumberField
            label="Translation timeout"
            value={settings.timeoutSeconds}
            suffix="seconds"
            onChange={(value) =>
              onChange((current) => ({
                ...current,
                timeoutSeconds: value ?? current.timeoutSeconds,
              }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Attempts"
          description="Tries per page when a reply misses lines. After that the lines are sent in halves."
        >
          <NumberField
            label="Translation attempts"
            value={settings.retryAttempts}
            suffix="tries"
            onChange={(value) =>
              onChange((current) => ({ ...current, retryAttempts: value ?? current.retryAttempts }))
            }
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function LetteringCard({
  settings,
  onChange,
}: {
  readonly settings: MangaSettings
  readonly onChange: Change
}) {
  const { fonts, state, load } = useLocalFonts()
  const installed = fonts.filter((family) => !bundledFonts.some((font) => font === family))

  const items = {
    ...Object.fromEntries(bundledFonts.map((font) => [font, font])),
    ...Object.fromEntries(installed.map((family) => [family, family])),
    [settings.font]: settings.font,
  }

  return (
    <SettingsCard
      title="Lettering"
      description="How the translation is written into the bubbles."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        <SettingRow
          label="Font"
          description="Fonts that come with Wenbu, or any font installed on this computer."
        >
          <Select
            items={items}
            value={settings.font}
            onOpenChange={load}
            onValueChange={(font) =>
              onChange((current) => ({ ...current, font: font ?? current.font }))
            }
          >
            <SelectTrigger aria-label="Font" className="h-9 w-56 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Comes with Wenbu</SelectLabel>
                {bundledFonts.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Installed</SelectLabel>
                {state === 'loading' ? <SelectLabel>Loading installed fonts…</SelectLabel> : null}
                {state === 'error' ? (
                  <SelectLabel>Installed fonts are unavailable.</SelectLabel>
                ) : null}
                {installed.map((family) => (
                  <SelectItem key={family} value={family}>
                    {family}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label="Smallest size"
          description="Text shrinks to fit its bubble, down to this size."
        >
          <NumberField
            label="Smallest font size"
            value={settings.minFontSize}
            suffix="px"
            onChange={(value) =>
              onChange((current) => ({ ...current, minFontSize: value ?? current.minFontSize }))
            }
          />
        </SettingRow>
        <SettingRow label="Largest size">
          <NumberField
            label="Largest font size"
            value={settings.maxFontSize}
            suffix="px"
            onChange={(value) =>
              onChange((current) => ({ ...current, maxFontSize: value ?? current.maxFontSize }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Text color"
          description="Automatic writes black or white, whichever reads best on each bubble."
        >
          <span className="inline-flex items-center gap-2">
            {settings.textColor === 'auto' ? null : (
              <Input
                type="color"
                aria-label="Text color"
                value={settings.textColor}
                className="h-9 w-12 cursor-pointer rounded-full p-1"
                onChange={(event) =>
                  onChange((current) => ({ ...current, textColor: event.target.value }))
                }
              />
            )}
            <ChoiceSelect
              label="Text color mode"
              choices={textColorModes}
              value={settings.textColor === 'auto' ? 'auto' : 'custom'}
              width="w-40"
              onChange={(mode) =>
                onChange((current) => ({
                  ...current,
                  textColor: mode === 'auto' ? 'auto' : '#000000',
                }))
              }
            />
          </span>
        </SettingRow>
        <SettingRow label="Outline" description="A thin outline keeps text readable over artwork.">
          <span className="inline-flex items-center gap-3">
            <Input
              type="color"
              aria-label="Outline color"
              value={settings.borderColor}
              disabled={!settings.textBorder}
              className="h-9 w-12 cursor-pointer rounded-full p-1"
              onChange={(event) =>
                onChange((current) => ({ ...current, borderColor: event.target.value }))
              }
            />
            <Switch
              aria-label="Text outline"
              checked={settings.textBorder}
              onCheckedChange={(textBorder) => onChange((current) => ({ ...current, textBorder }))}
            />
          </span>
        </SettingRow>
        <SettingRow
          label="Capital letters"
          description="Write every translation in capitals, like most manga."
        >
          <Switch
            aria-label="Capital letters"
            checked={settings.uppercase}
            onCheckedChange={(uppercase) => onChange((current) => ({ ...current, uppercase }))}
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function SpeedCard({
  settings,
  onChange,
}: {
  readonly settings: MangaSettings
  readonly onChange: Change
}) {
  return (
    <SettingsCard
      title="Speed and quality"
      description="The defaults favour quality. Lower sizes trade detail for speed on big pages."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        <SettingRow
          label="Use the GPU"
          description="Needs an NVIDIA GPU. Without one, pages run on the CPU, many times slower."
        >
          <Switch
            aria-label="Use the GPU"
            checked={settings.useGpu}
            onCheckedChange={(useGpu) => onChange((current) => ({ ...current, useGpu }))}
          />
        </SettingRow>
        <SettingRow
          label="Text detection"
          description="The size pages are scaled to while looking for text."
        >
          <ChoiceSelect
            label="Text detection size"
            choices={detectionSizes}
            value={settings.detectionSize}
            onChange={(detectionSize) => onChange((current) => ({ ...current, detectionSize }))}
          />
        </SettingRow>
        <SettingRow label="Cleaning" description="Where the original text is painted over.">
          <ChoiceSelect
            label="Cleaning"
            choices={inpaintingModes}
            value={settings.inpainting}
            onChange={(inpainting) => onChange((current) => ({ ...current, inpainting }))}
          />
        </SettingRow>
        <SettingRow
          label="Cleaning size"
          description="Larger areas are scaled down to this size first."
        >
          <ChoiceSelect
            label="Cleaning size"
            choices={inpaintingSizes}
            value={settings.inpaintingSize}
            onChange={(inpaintingSize) => onChange((current) => ({ ...current, inpaintingSize }))}
          />
        </SettingRow>
        <SettingRow
          label="Text smoothing"
          description="Letters are drawn larger, then scaled down for smooth edges."
        >
          <ChoiceSelect
            label="Text smoothing"
            choices={supersamplings}
            value={settings.supersampling}
            onChange={(supersampling) => onChange((current) => ({ ...current, supersampling }))}
          />
        </SettingRow>
        <SettingRow
          label="Pages ahead"
          description="Pages prepared while others are translated. More uses more memory."
        >
          <NumberField
            label="Pages ahead"
            value={settings.pagesAhead}
            suffix="pages"
            onChange={(value) =>
              onChange((current) => ({ ...current, pagesAhead: value ?? current.pagesAhead }))
            }
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function OutputCard({
  settings,
  onChange,
}: {
  readonly settings: MangaSettings
  readonly onChange: Change
}) {
  return (
    <SettingsCard
      title="Output"
      description="Translated pages go into a folder inside the one you translate, keeping its subfolders."
      className="gap-1"
    >
      <div className="flex flex-col divide-y">
        <SettingRow label="Folder name">
          <Input
            aria-label="Output folder name"
            value={settings.outputFolderName}
            className="h-9 w-56 rounded-full"
            onChange={(event) =>
              onChange((current) => ({ ...current, outputFolderName: event.target.value }))
            }
          />
        </SettingRow>
        <SettingRow label="Format">
          <ChoiceSelect
            label="Output format"
            choices={outputFormats}
            value={settings.outputFormat}
            width="w-56"
            onChange={(outputFormat) => onChange((current) => ({ ...current, outputFormat }))}
          />
        </SettingRow>
        <SettingRow label="Quality" description="For JPEG and WebP pages. 100 keeps WebP lossless.">
          <NumberField
            label="Output quality"
            value={settings.outputQuality}
            suffix="of 100"
            disabled={settings.outputFormat === 'png'}
            onChange={(value) =>
              onChange((current) => ({ ...current, outputQuality: value ?? current.outputQuality }))
            }
          />
        </SettingRow>
        <SettingRow label="Pages already translated">
          <ChoiceSelect
            label="Pages already translated"
            choices={existingChoices}
            value={settings.existingPages}
            onChange={(existingPages) => onChange((current) => ({ ...current, existingPages }))}
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function MangaSettingsForm({ saved }: { readonly saved: MangaSettings }) {
  const save = useAtomSet(saveMangaSettingsAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dirty = !sameSettings(draft, saved)

  const change: Change = (update) => {
    setError(undefined)
    setDraft(update)
  }

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: mangaSettingsKeys })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setDraft(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="mt-6 flex flex-1 flex-col gap-5">
      <TranslationCard settings={draft} onChange={change} />
      <LetteringCard settings={draft} onChange={change} />
      <SpeedCard settings={draft} onChange={change} />
      <OutputCard settings={draft} onChange={change} />
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

export function MangaSettingsPage() {
  const result = useAtomValue(mangaSettingsAtom)
  const pluginReady = isPluginReady(useAtomValue(pluginsAtom), 'manga-image-translator')
  const openScreen = useAtomSet(screenAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Manga translation</h1>
      <p className="mt-1 text-muted-foreground">
        How Wenbu translates folders of manga pages from the Manga screen. The text is found,
        cleaned and lettered by{' '}
        <Button
          variant="link"
          className="h-auto p-0 text-base font-normal"
          onClick={() =>
            window.wenbu.openExternal('https://github.com/zyddnys/manga-image-translator')
          }
        >
          manga-image-translator
        </Button>
        .
      </p>
      {pluginReady ? null : (
        <div className="mt-5">
          <Note Icon={InfoIcon} title="Needs manga-image-translator">
            <span>It finds, cleans and letters the text. Install it from the Plugins page.</span>
            <Button
              variant="link"
              className="h-auto self-start p-0"
              onClick={() => openScreen('plugins')}
            >
              Open Plugins
            </Button>
          </Note>
        </div>
      )}
      {AsyncResult.isSuccess(result) ? <MangaSettingsForm saved={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
      ) : null}
    </div>
  )
}
