import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  FolderOpenIcon,
  SignInIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { DownloadSettings, type SourceAccount, type SourceInfo, sources } from '#contract/Downloads'
import { fieldError, type FormError, formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Switch } from '#ui/switch'
import { type Choice, ChoiceSelect } from '../settings/components/ChoiceSelect'
import { SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { SettingsFooter } from '../settings/components/SettingsFooter'
import { accountPill, accountSummary, SourceChip, StatusPill } from './components/SourceStatus'
import {
  checkSourceAtom,
  downloadSettingsAtom,
  downloadSettingsKeys,
  downloadsAtom,
  saveDownloadSettingsAtom,
  signInToSourceAtom,
  signOutOfSourceAtom,
} from './downloads'

const sameSettings = Schema.toEquivalence(DownloadSettings)

type Change = (update: (settings: DownloadSettings) => DownloadSettings) => void

const folderNames: ReadonlyArray<Choice<DownloadSettings['folderName']>> = [
  { value: 'title', label: 'Title' },
  { value: 'id-title', label: 'Gallery ID and title' },
  { value: 'source-title', label: 'Source › Title' },
]

const titleLanguages: ReadonlyArray<Choice<DownloadSettings['titleLanguage']>> = [
  { value: 'english', label: 'English, else Japanese' },
  { value: 'japanese', label: 'Japanese, else English' },
]

const parallelChoices: ReadonlyArray<Choice<number>> = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

const exhentaiQualities: ReadonlyArray<Choice<DownloadSettings['exhentaiQuality']>> = [
  { value: 'original', label: 'Original' },
  { value: 'resampled', label: 'Resampled · 1280 px' },
]

const exhentaiDelays: ReadonlyArray<Choice<DownloadSettings['exhentaiDelay']>> = [
  { value: 'fast', label: 'Fast · 0.75–1.5 s' },
  { value: 'normal', label: 'Normal · 1.5–3 s' },
  { value: 'careful', label: 'Careful · 3–6 s' },
]

const hdoujinQualities: ReadonlyArray<Choice<DownloadSettings['hdoujinQuality']>> = [
  { value: '0', label: 'Original' },
  { value: '1600', label: '1600 px' },
  { value: '1280', label: '1280 px' },
  { value: '980', label: '980 px' },
  { value: '780', label: '780 px' },
]

const qualitySummary = (source: SourceInfo, settings: DownloadSettings) => {
  if (source.id === 'exhentai') {
    return settings.exhentaiQuality === 'original' ? 'Original quality' : 'Resampled 1280 px'
  }

  if (source.id === 'hdoujin') {
    return settings.hdoujinQuality === '0'
      ? 'Original quality'
      : `${settings.hdoujinQuality} px wide`
  }

  return source.id === 'hitomi' ? 'Full-size WebP' : 'Original quality'
}

function SavingCard({
  settings,
  error,
  onChange,
}: {
  readonly settings: DownloadSettings
  readonly error: FormError | undefined
  readonly onChange: Change
}) {
  const folderError = fieldError(error, 'folder')

  const chooseFolder = async () => {
    const folder = await window.wenbu.chooseFolder()

    if (folder !== undefined) {
      onChange((current) => ({ ...current, folder }))
    }
  }

  return (
    <SettingsCard title="Saving" description="Applies to every source." className="gap-1">
      <div className="flex flex-col divide-y">
        <div className="flex items-center gap-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">Download folder</span>
            {settings.folder === '' ? (
              <span className="text-[12.5px] text-warning">
                Choose a folder before downloading galleries.
              </span>
            ) : (
              <span
                className="truncate text-left font-mono text-[12.5px] text-muted-foreground [direction:rtl]"
                title={settings.folder}
              >
                {settings.folder}
              </span>
            )}
            {folderError === undefined ? null : (
              <span className="text-[12.5px] text-destructive">{folderError}</span>
            )}
          </div>
          {settings.folder === '' ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              onClick={() => window.wenbu.revealPath(settings.folder)}
            >
              <ArrowSquareOutIcon />
              Reveal
            </Button>
          )}
          <Button
            variant={settings.folder === '' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => void chooseFolder()}
          >
            <FolderOpenIcon />
            {settings.folder === '' ? 'Choose folder' : 'Change'}
          </Button>
        </div>
        <SettingRow
          label="Folder name"
          description="Each gallery gets its own folder inside the download folder."
        >
          <ChoiceSelect
            label="Folder name"
            choices={folderNames}
            value={settings.folderName}
            width="w-56"
            onChange={(folderName) => onChange((current) => ({ ...current, folderName }))}
          />
        </SettingRow>
        <SettingRow
          label="Title language"
          description="Used for folder names when a source has both."
        >
          <ChoiceSelect
            label="Title language"
            choices={titleLanguages}
            value={settings.titleLanguage}
            width="w-56"
            onChange={(titleLanguage) => onChange((current) => ({ ...current, titleLanguage }))}
          />
        </SettingRow>
        <SettingRow
          label="Downloads at once"
          description="Galleries downloading at the same time. Others wait in line."
        >
          <ChoiceSelect
            label="Downloads at once"
            choices={parallelChoices}
            value={settings.parallelDownloads}
            width="w-56"
            onChange={(parallelDownloads) =>
              onChange((current) => ({ ...current, parallelDownloads }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Save gallery details"
          description="Writes info.json with the title, tags, artists and source link."
        >
          <Switch
            aria-label="Save gallery details"
            checked={settings.saveDetails}
            onCheckedChange={(saveDetails) => onChange((current) => ({ ...current, saveDetails }))}
          />
        </SettingRow>
        <SettingRow
          label="Resume interrupted downloads on start"
          description="Continues from the last saved page after Wenbu closes or the network drops."
        >
          <Switch
            aria-label="Resume interrupted downloads on start"
            checked={settings.resumeOnStart}
            onCheckedChange={(resumeOnStart) =>
              onChange((current) => ({ ...current, resumeOnStart }))
            }
          />
        </SettingRow>
      </div>
    </SettingsCard>
  )
}

function AccountRow({
  source,
  account,
}: {
  readonly source: SourceInfo
  readonly account: SourceAccount
}) {
  const signIn = useAtomSet(signInToSourceAtom)
  const signOut = useAtomSet(signOutOfSourceAtom)
  const check = useAtomSet(checkSourceAtom)
  const busy = account.status === 'signing-in' || account.status === 'checking'
  const signedIn = account.status === 'ready' || account.status === 'checking'
  const summary = accountSummary(account)

  const fallback = source.signIn
    ? 'Not signed in.'
    : 'No sign-in needed. Check that Wenbu can reach the site.'

  return (
    <SettingRow
      label={source.signIn ? 'Account' : 'Connection'}
      description={summary === '' ? fallback : summary}
    >
      <span className="flex items-center gap-1.5">
        {!source.signIn || signedIn ? (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-muted-foreground"
            disabled={busy}
            onClick={() => check({ payload: { source: source.id } })}
          >
            <ArrowsClockwiseIcon />
            Check
          </Button>
        ) : null}
        {source.signIn && signedIn ? (
          <Button
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={() => signOut({ payload: { source: source.id } })}
          >
            Sign out
          </Button>
        ) : null}
        {source.signIn && !signedIn ? (
          <Button
            className="rounded-full"
            disabled={busy}
            onClick={() => signIn({ payload: { source: source.id } })}
          >
            <SignInIcon />
            {account.status === 'expired' ? 'Sign in again' : 'Sign in'}
          </Button>
        ) : null}
      </span>
    </SettingRow>
  )
}

function SourceOptions({
  source,
  settings,
  onChange,
}: {
  readonly source: SourceInfo
  readonly settings: DownloadSettings
  readonly onChange: Change
}) {
  if (source.id === 'exhentai') {
    return (
      <>
        <SettingRow
          label="Image quality"
          description="Originals use your image limits, then GP. Wenbu asks before falling back."
        >
          <ChoiceSelect
            label="ExHentai image quality"
            choices={exhentaiQualities}
            value={settings.exhentaiQuality}
            width="w-56"
            onChange={(exhentaiQuality) => onChange((current) => ({ ...current, exhentaiQuality }))}
          />
        </SettingRow>
        <SettingRow
          label="Request delay"
          description="Pause between page requests, so the site doesn't block you."
        >
          <ChoiceSelect
            label="ExHentai request delay"
            choices={exhentaiDelays}
            value={settings.exhentaiDelay}
            width="w-56"
            onChange={(exhentaiDelay) => onChange((current) => ({ ...current, exhentaiDelay }))}
          />
        </SettingRow>
      </>
    )
  }

  if (source.id === 'hdoujin') {
    return (
      <SettingRow
        label="Image quality"
        description="When a gallery lacks this size, Wenbu takes the next smaller one."
      >
        <ChoiceSelect
          label="HDoujin image quality"
          choices={hdoujinQualities}
          value={settings.hdoujinQuality}
          width="w-56"
          onChange={(hdoujinQuality) => onChange((current) => ({ ...current, hdoujinQuality }))}
        />
      </SettingRow>
    )
  }

  return null
}

function SourceRow({
  source,
  account,
  settings,
  onChange,
}: {
  readonly source: SourceInfo
  readonly account: SourceAccount
  readonly settings: DownloadSettings
  readonly onChange: Change
}) {
  const signIn = useAtomSet(signInToSourceAtom)
  const [open, setOpen] = useState(false)
  const enabled = settings.enabledSources.includes(source.id)
  const pill = accountPill(account, source.id !== 'exhentai')

  const canSignIn =
    !open && source.signIn && (account.status === 'signed-out' || account.status === 'expired')

  const setEnabled = (on: boolean) =>
    onChange((current) => ({
      ...current,
      enabledSources: on
        ? [...current.enabledSources, source.id]
        : current.enabledSources.filter((id) => id !== source.id),
    }))

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-[18px] border"
    >
      <div className={cn('flex items-center gap-3 px-4 py-3', !enabled && 'opacity-60')}>
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 text-left">
          <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          <SourceChip source={source.id} />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{source.name}</span>
            <span className="truncate text-[12.5px] text-muted-foreground">
              {source.sites} · {qualitySummary(source, settings)}
            </span>
          </span>
        </CollapsibleTrigger>
        <StatusPill pill={pill} />
        {canSignIn ? (
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => signIn({ payload: { source: source.id } })}
          >
            Sign in
          </Button>
        ) : null}
        <Switch
          aria-label={`Download from ${source.name}`}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>
      <CollapsibleContent className="flex flex-col divide-y border-t px-4 pb-1">
        <AccountRow source={source} account={account} />
        <SourceOptions source={source} settings={settings} onChange={onChange} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function SourcesCard({
  settings,
  accounts,
  onChange,
}: {
  readonly settings: DownloadSettings
  readonly accounts: ReadonlyArray<SourceAccount>
  readonly onChange: Change
}) {
  return (
    <SettingsCard
      title="Sources"
      description="Turn sources on, sign in where a site needs it, and choose the image quality."
      className="gap-3"
    >
      {sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          account={
            accounts.find((account) => account.source === source.id) ?? {
              source: source.id,
              status: source.signIn ? 'signed-out' : 'open',
            }
          }
          settings={settings}
          onChange={onChange}
        />
      ))}
    </SettingsCard>
  )
}

function DownloadsSettingsForm({ saved }: { readonly saved: DownloadSettings }) {
  const save = useAtomSet(saveDownloadSettingsAtom, { mode: 'promiseExit' })
  const state = useAtomValue(downloadsAtom)
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<FormError | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dirty = !sameSettings(draft, saved)
  const accounts = AsyncResult.isSuccess(state) ? state.value.accounts : []

  const change: Change = (update) => {
    setError(undefined)
    setDraft(update)
  }

  const submit = async () => {
    setBusy(true)

    const exit = await save({ payload: draft, reactivityKeys: downloadSettingsKeys })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setDraft(exit.value)

      return
    }

    setError(formErrorOf(exit))
  }

  return (
    <div className="mt-6 flex flex-1 flex-col gap-5">
      <SavingCard settings={draft} error={error} onChange={change} />
      <SourcesCard settings={draft} accounts={accounts} onChange={change} />
      <SettingsFooter
        error={error?.field === 'folder' ? undefined : error?.message}
        dirty={dirty}
        busy={busy}
        onDiscard={() => change(() => saved)}
        onSave={submit}
      />
    </div>
  )
}

export function DownloadsSettingsPage() {
  const result = useAtomValue(downloadSettingsAtom)

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">Downloads</h1>
      <p className="mt-1 text-muted-foreground">
        Where galleries are saved, and the sources Wenbu downloads from.
      </p>
      {AsyncResult.isSuccess(result) ? <DownloadsSettingsForm saved={result.value} /> : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
      ) : null}
    </div>
  )
}
