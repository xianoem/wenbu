import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { GearSixIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type ReactNode, useState } from 'react'
import { bundledFonts, mangaLanguages } from '#contract/Manga'
import type { BlockKind, MangaEditorSettings } from '#contract/MangaEditor'
import { formErrorOf } from '#lib/forms'
import { useLocalFonts } from '#lib/useLocalFonts'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
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
import { Textarea } from '#ui/textarea'
import { ChoiceSelect } from '../../settings/components/ChoiceSelect'
import { useLlmSettings } from '../../settings/llm'
import { mangaEditorSettingsAtom, saveMangaEditorSettingsAtom, settingsKeys } from '../mangaEditor'
import { kinds } from './Lines'

const noPreset = 'none'

const languageChoices = mangaLanguages.map((language) => ({
  value: language.code,
  label: language.name,
}))

const typedNumber = (typed: string) => {
  const value = Math.round(Number(typed))

  return typed.trim() === '' || !Number.isFinite(value) ? undefined : value
}

const withOptional = <T extends object, K extends keyof T>(value: T, key: K, typed: string): T => {
  const { [key]: _gone, ...rest } = value
  const number = typedNumber(typed)

  // SAFETY: rest is value without key, and key gets a number or stays out.
  return (number === undefined ? rest : { ...rest, [key]: number }) as T
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
        {title}
      </span>
      {children}
    </div>
  )
}

function Form({
  folder,
  initial,
  pageHeight,
  onDone,
}: {
  readonly folder: string
  readonly initial: MangaEditorSettings
  readonly pageHeight: number | undefined
  readonly onDone: () => void
}) {
  const [settings, setSettings] = useState(initial)
  const [problem, setProblem] = useState<string>()
  const save = useAtomSet(saveMangaEditorSettingsAtom, { mode: 'promiseExit' })
  const llm = useLlmSettings()
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []
  const { fonts: installed, load } = useLocalFonts()

  const fontItems = {
    ...Object.fromEntries(bundledFonts.map((font) => [font, font])),
    ...Object.fromEntries(installed.map((family) => [family, family])),
    [settings.font]: settings.font,
  }

  const change = (patch: Partial<MangaEditorSettings>) =>
    setSettings((current) => ({ ...current, ...patch }))

  const changeKindSize = (kind: BlockKind, typed: string) =>
    setSettings((current) => ({
      ...current,
      kindSizes: withOptional(current.kindSizes, kind, typed),
    }))

  const changeReference = (typed: string) =>
    setSettings((current) => withOptional(current, 'sizeReference', typed))

  const submit = async () => {
    const exit = await save({ payload: { folder, settings }, reactivityKeys: settingsKeys(folder) })

    if (Exit.isSuccess(exit)) {
      onDone()

      return
    }

    setProblem(formErrorOf(exit)?.message)
  }

  return (
    <div className="flex flex-col gap-4">
      <Group title="Translation">
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
          <SelectTrigger aria-label="Preset" className="h-9 w-full rounded-full">
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
        <ChoiceSelect
          label="Translate into"
          choices={languageChoices}
          value={settings.targetLanguage}
          width="w-full"
          onChange={(targetLanguage) => change({ targetLanguage })}
        />
        <Textarea
          value={settings.seriesNotes}
          placeholder="Series notes: names, honorifics, how each character talks"
          onChange={(event) => change({ seriesNotes: event.target.value })}
          className="min-h-18 resize-none rounded-xl text-[12.5px] md:text-[12.5px]"
        />
      </Group>
      <Group title="Lettering">
        <Select
          items={fontItems}
          value={settings.font}
          onOpenChange={load}
          onValueChange={(font) => change({ font: font ?? settings.font })}
        >
          <SelectTrigger aria-label="Font" className="h-9 w-full rounded-full">
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
              {installed.map((family) => (
                <SelectItem key={family} value={family}>
                  {family}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-muted-foreground">Size</span>
          <Input
            type="number"
            aria-label="Smallest size"
            value={settings.minFontSize}
            onChange={(event) => change({ minFontSize: Number(event.target.value) })}
            className="h-8 w-16 rounded-full"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="number"
            aria-label="Largest size"
            value={settings.maxFontSize}
            onChange={(event) => change({ maxFontSize: Number(event.target.value) })}
            className="h-8 w-16 rounded-full"
          />
          <div className="flex-1" />
          <span className="text-muted-foreground">Outline</span>
          <Switch checked={settings.outline} onCheckedChange={(outline) => change({ outline })} />
          <Input
            type="color"
            aria-label="Outline colour"
            value={settings.outlineColor}
            disabled={!settings.outline}
            onChange={(event) => change({ outlineColor: event.target.value })}
            className="h-8 w-10 rounded-full p-1"
          />
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant={settings.uppercase ? 'secondary' : 'outline'}
            className="rounded-full"
            onClick={() => change({ uppercase: true })}
          >
            Uppercase
          </Button>
          <Button
            size="xs"
            variant={settings.uppercase ? 'outline' : 'secondary'}
            className="rounded-full"
            onClick={() => change({ uppercase: false })}
          >
            Mixed case
          </Button>
        </div>
      </Group>
      <Group title="Text sizes">
        <div className="grid grid-cols-5 gap-1.5">
          {kinds.map(({ kind, label }) => (
            <label key={kind} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {label}
              <Input
                type="number"
                aria-label={`${label} size`}
                placeholder="Fill"
                value={settings.kindSizes[kind] ?? ''}
                onChange={(event) => changeKindSize(kind, event.target.value)}
                className="h-8 rounded-full px-2.5 text-[12.5px]"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-muted-foreground">Measured on pages</span>
          <Input
            type="number"
            aria-label="Page height sizes are measured at"
            placeholder="Any"
            value={settings.sizeReference ?? ''}
            onChange={(event) => changeReference(event.target.value)}
            className="h-8 w-20 rounded-full"
          />
          <span className="text-muted-foreground">px tall</span>
          <div className="flex-1" />
          {pageHeight === undefined || pageHeight === settings.sizeReference ? null : (
            <Button
              size="xs"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              onClick={() => change({ sizeReference: pageHeight })}
            >
              This page: {pageHeight}
            </Button>
          )}
        </div>
        <span className="text-[11.5px] leading-relaxed text-muted-foreground">
          Every bubble of a kind gets its size, scaled to each page's height. Leave a kind empty to
          fill its boxes; leave the height empty to size in each page's own pixels.
        </span>
      </Group>
      {problem === undefined ? null : (
        <span className="text-[12.5px] text-destructive">{problem}</span>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" className="rounded-full" onClick={() => void submit()}>
          Save
        </Button>
      </div>
    </div>
  )
}

export function SettingsPopover({
  folder,
  pageHeight,
}: {
  readonly folder: string
  readonly pageHeight: number | undefined
}) {
  const [open, setOpen] = useState(false)
  const settings = useAtomValue(mangaEditorSettingsAtom(folder))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant={open ? 'secondary' : 'ghost'}
            className="rounded-full"
            aria-label="Gallery settings"
          >
            <GearSixIcon />
          </Button>
        }
      />
      <PopoverContent side="top" align="end" sideOffset={12} className="w-100 rounded-[20px] p-4">
        <div className="mb-3 flex flex-col">
          <span className="text-[13.5px] font-semibold">Gallery settings</span>
          <span className="text-[11.5px] text-muted-foreground">
            Every page in this gallery uses these
          </span>
        </div>
        {AsyncResult.isSuccess(settings) ? (
          <Form
            folder={folder}
            initial={settings.value}
            pageHeight={pageHeight}
            onDone={() => setOpen(false)}
          />
        ) : (
          <span className="text-[12.5px] text-muted-foreground">Loading…</span>
        )}
      </PopoverContent>
    </Popover>
  )
}
