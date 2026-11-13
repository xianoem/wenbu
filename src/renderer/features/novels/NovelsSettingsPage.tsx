import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { GlobeSimpleIcon, MagnifyingGlassIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  builtInFlags,
  NovelSettings,
  RemoveSite,
  SaveSite,
  type SitePreview,
} from '#contract/Novels'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Spinner } from '#ui/spinner'
import { type Choice, ChoiceSelect } from '../settings/components/ChoiceSelect'
import { NumberField, SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import { useLlmSettings } from '../settings/llm'
import {
  detectSiteAtom,
  novelSettingsAtom,
  novelSettingsKeys,
  novelSitesAtom,
  novelSitesKeys,
  saveNovelSettingsAtom,
  editSiteAtom,
} from './novels'

const sameSettings = Schema.toEquivalence(NovelSettings)

const noPreset = 'none'

const languages: ReadonlyArray<Choice<string>> = [
  'English',
  'Spanish',
  'Portuguese',
  'French',
  'German',
  'Italian',
  'Russian',
  'Indonesian',
  'Vietnamese',
  'Polish',
  'Romanian',
].map((language) => ({ value: language, label: language }))

function TranslationCard({
  settings,
  onChange,
}: {
  readonly settings: NovelSettings
  readonly onChange: (settings: NovelSettings) => void
}) {
  const llm = useLlmSettings()
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  return (
    <SettingsCard
      title="Translation"
      description="Every novel is translated with this preset, as game translation uses one for all games."
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
              onChange({ ...settings, presetId: value === null || value === noPreset ? '' : value })
            }
          >
            <SelectTrigger aria-label="Novels preset" className="h-9 w-56 rounded-full">
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
            choices={languages}
            value={settings.targetLanguage}
            width="w-56"
            onChange={(targetLanguage) => onChange({ ...settings, targetLanguage })}
          />
        </SettingRow>
        <SettingRow
          label="Translate ahead"
          description="Chapters after the one you read, translated while you read it."
        >
          <NumberField
            label="Chapters translated ahead"
            value={settings.readAhead}
            suffix="chapters"
            onChange={(value) => onChange({ ...settings, readAhead: value ?? settings.readAhead })}
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function ContentCheckCard({
  settings,
  onChange,
}: {
  readonly settings: NovelSettings
  readonly onChange: (settings: NovelSettings) => void
}) {
  const [flag, setFlag] = useState('')
  const added = flag.trim()

  const add = () => {
    if (added === '' || settings.contentFlags.includes(added)) {
      return
    }

    onChange({ ...settings, contentFlags: [...settings.contentFlags, added] })
    setFlag('')
  }

  return (
    <SettingsCard
      title="Content Check"
      description="What Wenbu looks for in every chapter it reads before you ask about a novel. Your own flags are checked in chapters read from now on."
    >
      <div className="flex flex-wrap gap-1.5">
        {builtInFlags.map((builtIn) => (
          <span
            key={builtIn.id}
            className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
          >
            {builtIn.label}
          </span>
        ))}
        {settings.contentFlags.map((custom) => (
          <span
            key={custom}
            className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-0.5 pl-2.5 text-xs"
          >
            {custom}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${custom}`}
              className="rounded-full"
              onClick={() =>
                onChange({
                  ...settings,
                  contentFlags: settings.contentFlags.filter((kept) => kept !== custom),
                })
              }
            >
              <XIcon />
            </Button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label="New content flag"
          placeholder="Your own, like “amnesia” or “animal death”"
          value={flag}
          className="h-9 flex-1 rounded-full px-3.5"
          onChange={(event) => setFlag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              add()
            }
          }}
        />
        <Button
          variant="secondary"
          className="h-9 rounded-full px-4"
          disabled={added === ''}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </SettingsCard>
  )
}

function Preview({
  preview,
  onSaved,
}: {
  readonly preview: SitePreview
  readonly onSaved: () => void
}) {
  const save = useAtomSet(editSiteAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <div className="mt-3 rounded-[18px] bg-background/60 p-4 text-[13px]">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{preview.title ?? preview.entry.name}</span>
        <span className="text-xs text-muted-foreground">
          {preview.author ?? ''} · {preview.chapters} chapters found
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <div>
          <div className="font-medium text-foreground/80">First chapters</div>
          {preview.firstChapters.map((title) => (
            <div key={title} className="truncate font-serif">
              {title}
            </div>
          ))}
        </div>
        <div>
          <div className="font-medium text-foreground/80">Last chapters</div>
          {preview.lastChapters.map((title) => (
            <div key={title} className="truncate font-serif">
              {title}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 text-xs font-medium text-foreground/80">First chapter’s text</div>
      <div className="mt-1 max-h-28 overflow-hidden font-serif text-xs leading-relaxed text-muted-foreground">
        {preview.sample.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          If the chapters and text look right, save the site.
        </span>
        {error === undefined ? null : <span className="text-xs text-destructive">{error}</span>}
        <Button
          className="h-8 rounded-full px-3.5"
          disabled={preview.chapters === 0 || preview.sample.length === 0}
          onClick={() =>
            void save({
              payload: { edit: SaveSite.make({ entry: preview.entry }) },
              reactivityKeys: novelSitesKeys,
            }).then((exit) => {
              if (Exit.isSuccess(exit)) {
                onSaved()

                return
              }

              setError(formErrorOf(exit)?.message)
            })
          }
        >
          Save site
        </Button>
      </div>
    </div>
  )
}

function SitesCard() {
  const sites = useAtomValue(novelSitesAtom)
  const detect = useAtomSet(detectSiteAtom, { mode: 'promiseExit' })
  const remove = useAtomSet(editSiteAtom, { mode: 'promiseExit' })
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SitePreview | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const find = async () => {
    setBusy(true)
    setError(undefined)
    setPreview(undefined)

    const exit = await detect({ payload: { url } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setPreview(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <SettingsCard
      title="Sites"
      description="Hosting sites Wenbu reads chapters from. Paste a book page from another site and Wenbu works out where its chapters and text are."
    >
      <div className="flex flex-col divide-y">
        {(AsyncResult.isSuccess(sites) ? sites.value : []).map((site) => (
          <div key={site.id} className="flex items-center gap-3 py-2.5">
            <span className="grid size-7 place-items-center rounded-full bg-secondary">
              <GlobeSimpleIcon />
            </span>
            <span className="flex-1">
              <span className="block font-medium">{site.name}</span>
              <span className="block text-xs text-muted-foreground">
                {site.hosts.join(', ')} ·{' '}
                {site.selectors.search === null ? 'add by link' : 'search and links'}
              </span>
            </span>
            {site.builtIn ? (
              <span className="text-xs text-muted-foreground">Built in</span>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${site.name}`}
                onClick={() =>
                  void remove({
                    payload: { edit: RemoveSite.make({ id: site.id }) },
                    reactivityKeys: novelSitesKeys,
                  })
                }
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <InputGroup className="h-9 flex-1 rounded-full">
          <InputGroupAddon>
            {busy ? <Spinner className="size-3.5" /> : <MagnifyingGlassIcon />}
          </InputGroupAddon>
          <InputGroupInput
            aria-label="A book page on the site"
            placeholder="A book page on the site, like https://example.com/book/123.html"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void find()
              }
            }}
          />
        </InputGroup>
        <Button
          variant="secondary"
          className="h-9 rounded-full px-4"
          disabled={busy || url.trim() === ''}
          onClick={() => void find()}
        >
          Add site
        </Button>
      </div>
      {error === undefined ? null : <p className="text-xs text-destructive">{error}</p>}
      {preview === undefined ? null : (
        <Preview
          preview={preview}
          onSaved={() => {
            setPreview(undefined)
            setUrl('')
          }}
        />
      )}
    </SettingsCard>
  )
}

function SettingsForm({ saved }: { readonly saved: NovelSettings }) {
  const save = useAtomSet(saveNovelSettingsAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: novelSettingsKeys })

    setBusy(false)
    setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="mt-6 flex flex-1 flex-col gap-5">
      <TranslationCard
        settings={draft}
        onChange={(next) => {
          setError(undefined)
          setDraft(next)
        }}
      />
      <ContentCheckCard
        settings={draft}
        onChange={(next) => {
          setError(undefined)
          setDraft(next)
        }}
      />
      <SitesCard />
      <SettingsFooter
        error={error}
        dirty={!sameSettings(draft, saved)}
        busy={busy}
        onDiscard={() => setDraft(saved)}
        onSave={submit}
      />
    </div>
  )
}

export function NovelsSettingsPage() {
  const result = useAtomValue(novelSettingsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Novels</h1>
      <p className="mt-1 text-muted-foreground">
        How Wenbu translates the novels you read, and the sites it reads their chapters from.
      </p>
      {AsyncResult.isSuccess(result) ? <SettingsForm saved={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
      ) : null}
    </div>
  )
}
