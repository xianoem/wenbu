import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  AppWindowIcon,
  ArrowClockwiseIcon,
  CaretDownIcon,
  CopyIcon,
  EyeIcon,
  GearIcon,
  LightningIcon,
  EyeSlashIcon,
  PauseIcon,
  PlayIcon,
  PuzzlePieceIcon,
  SpeakerHighIcon,
  StopIcon,
  WarningCircleIcon,
  WaveformIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  AppAudio,
  appName,
  type AudioSource,
  ComputerAudio,
  defaultSpeechModel,
  isAppAudio,
  type SpeechModelId,
  speechModels,
  type SubtitleLine,
  type SubtitleSettings,
  type SubtitleState,
} from '#contract/Subtitles'
import { appIconUrl } from '#contract/PageImage'
import { formErrorOf } from '#lib/forms'
import { screenAtom, settingsPageAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { InlineTextEdit } from '#ui/inline-text-edit'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { formatTokens, formatUsd } from '../library/library'
import { isPluginReady, pluginsAtom } from '../plugins/plugins'
import { useLlmSettings } from '../settings/llm'
import {
  audioLevelAtom,
  audioSourcesAtom,
  retrySubtitleTranslationAtom,
  saveSubtitleSettingsAtom,
  setSubtitleOverlayVisibleAtom,
  setSubtitlesPausedAtom,
  startSubtitlesAtom,
  stopSubtitlesAtom,
  subtitleBacklogAtom,
  subtitleSettingsAtom,
  subtitleSettingsKeys,
  subtitlesAtom,
  subtitlesPopoverOpenAtom,
} from './subtitles'

const sourceName = (source: AudioSource) => appName(source) ?? 'Computer audio'

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const running = (state: SubtitleState | undefined) =>
  state !== undefined && state.status !== 'stopped' && state.status !== 'failed'

function useSaveSettings(settings: SubtitleSettings) {
  const save = useAtomSet(saveSubtitleSettingsAtom, { mode: 'promiseExit' })

  return async (change: Partial<SubtitleSettings>) => {
    const exit = await save({
      payload: { ...settings, ...change },
      reactivityKeys: subtitleSettingsKeys,
    })

    return Exit.isSuccess(exit) ? undefined : formErrorOf(exit)?.message
  }
}

function SourceMenu({ settings }: { readonly settings: SubtitleSettings }) {
  const sources = useAtomValue(audioSourcesAtom)
  const save = useSaveSettings(settings)
  const apps = AsyncResult.isSuccess(sources) ? sources.value.apps : []
  const appCapture = !AsyncResult.isSuccess(sources) || sources.value.appCapture

  const output = AsyncResult.isSuccess(sources)
    ? sources.value.outputs.find((candidate) =>
        settings.outputId === undefined ? candidate.isDefault : candidate.id === settings.outputId,
      )
    : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-full bg-foreground/6 px-2.5 font-normal text-foreground"
          />
        }
      >
        {isAppAudio(settings.source) ? (
          <AppIcon path={settings.source.path} />
        ) : (
          <SpeakerHighIcon />
        )}
        {sourceName(settings.source)}
        <CaretDownIcon className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuItem onClick={() => void save({ source: ComputerAudio.make({}) })}>
          <SpeakerHighIcon />
          Computer audio
          <span className="ml-auto truncate text-xs text-muted-foreground">{output?.name}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Apps playing sound</DropdownMenuLabel>
          {appCapture ? null : (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              This version of Windows can't capture one app.
            </p>
          )}
          {appCapture && apps.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              No app is playing sound right now.
            </p>
          ) : null}
          {appCapture
            ? apps.map((app) => (
                <DropdownMenuItem
                  key={app.pid}
                  onClick={() => void save({ source: AppAudio.make(app) })}
                >
                  <AppIcon path={app.path} />
                  <span className="truncate">{app.name}</span>
                </DropdownMenuItem>
              ))
            : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppIcon({ path }: { readonly path: string }) {
  const [missing, setMissing] = useState(false)

  if (missing || path === '') {
    return <AppWindowIcon />
  }

  return (
    <img
      src={appIconUrl(path)}
      alt=""
      draggable={false}
      className="size-4 shrink-0"
      onError={() => setMissing(true)}
    />
  )
}

function PresetMenu({ settings }: { readonly settings: SubtitleSettings }) {
  const llm = useLlmSettings()
  const save = useSaveSettings(settings)
  const setScreen = useAtomSet(screenAtom)
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  if (presets.length === 0) {
    return (
      <Button variant="link" className="h-7 px-1 text-[13px]" onClick={() => setScreen('settings')}>
        add a preset in Settings
      </Button>
    )
  }

  return (
    <Select
      items={Object.fromEntries(presets.map((preset) => [preset.id, preset.name]))}
      value={settings.presetId === '' ? null : settings.presetId}
      onValueChange={(presetId) => {
        if (presetId !== null) {
          void save({ presetId })
        }
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Preset"
        className="h-7 rounded-full border-0 bg-foreground/6 px-2.5 text-[13px] dark:bg-foreground/6"
      >
        <SelectValue placeholder="choose a preset" />
      </SelectTrigger>
      <SelectContent>
        {presets.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            {preset.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Sentence({ settings }: { readonly settings: SubtitleSettings }) {
  const save = useSaveSettings(settings)

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
      Listen to
      <SourceMenu settings={settings} />
      and translate into
      <InlineTextEdit
        value={settings.targetLanguage}
        label="Language to translate into"
        placeholder="English"
        hint="Type any language. The spoken language is detected by itself."
        className="bg-foreground/6 text-foreground"
        onSave={(targetLanguage) => save({ targetLanguage })}
      >
        {settings.targetLanguage}
      </InlineTextEdit>
      with
      <PresetMenu settings={settings} />
    </div>
  )
}

const barColour = (lit: boolean, speech: boolean) => {
  if (!lit) {
    return 'bg-foreground/15'
  }

  return speech ? 'bg-success' : 'bg-foreground/60'
}

function Meter() {
  const level = useAtomValue(audioLevelAtom)
  const value = AsyncResult.isSuccess(level) ? level.value : undefined
  const loudness = Math.min(1, (value?.level ?? 0) * 6)

  return (
    <span className="flex h-3 items-center gap-[2px]" aria-hidden>
      {Array.from({ length: 14 }, (_, index) => (
        <span
          key={index}
          className={cn(
            'w-[2px] rounded-full transition-[height] duration-100',
            barColour(index / 14 < loudness, value?.speech === true),
          )}
          style={{ height: `${4 + Math.round(8 * Math.abs(Math.sin(index * 1.7)))}px` }}
        />
      ))}
    </span>
  )
}

function BacklogLine({ line }: { readonly line: SubtitleLine }) {
  const retry = useAtomSet(retrySubtitleTranslationAtom)

  return (
    <div className="grid grid-cols-[38px_1fr] gap-x-2.5 gap-y-px rounded-xl px-2 py-1.5">
      <span className="pt-0.5 text-[11px] text-muted-foreground tabular-nums">
        {clock(line.start)}
      </span>
      {line.status === 'failed' ? (
        <span className="flex items-center gap-1.5 text-[13px] text-warning">
          <WarningCircleIcon className="size-3.5" />
          Translation failed
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-[13px]"
            onClick={() => retry({ payload: { lineId: line.id } })}
          >
            Retry
          </Button>
        </span>
      ) : (
        <span
          className={cn(
            'text-sm leading-snug',
            line.translation === undefined && 'text-muted-foreground',
          )}
        >
          {line.translation ?? 'Translating…'}
        </span>
      )}
      <span className="col-start-2 text-xs text-muted-foreground">
        <span className="mr-1.5 rounded bg-foreground/8 px-1 py-px text-[10px] font-semibold uppercase">
          {line.language === '' ? '··' : line.language}
        </span>
        {line.original}
      </span>
    </div>
  )
}

function Backlog({ state }: { readonly state: SubtitleState }) {
  const backlog = useAtomValue(subtitleBacklogAtom)
  const lines = AsyncResult.isSuccess(backlog) ? backlog.value : []

  const copy = () =>
    void navigator.clipboard.writeText(
      lines.map((line) => `${line.original}\n${line.translation ?? ''}`).join('\n\n'),
    )

  return (
    <>
      <div className="flex items-center gap-2.5 px-1 text-xs font-medium text-muted-foreground">
        <span>Backlog</span>
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] text-foreground tabular-nums">
          {lines.length}
        </span>
        <span className="h-px flex-1 bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-full px-2 text-xs font-normal"
          disabled={lines.length === 0}
          onClick={copy}
        >
          <CopyIcon />
          Copy
        </Button>
      </div>
      <ScrollArea className="h-[360px] overflow-hidden rounded-[18px]">
        <div className="flex min-h-[360px] flex-col justify-end gap-0.5 pr-2">
          {lines.length === 0 && state.partial === undefined ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Lines appear here as they are heard. They are kept until Wenbu closes.
            </div>
          ) : null}
          {lines.map((line) => (
            <BacklogLine key={line.id} line={line} />
          ))}
          {state.partial === undefined ? null : (
            <div className="grid grid-cols-[38px_1fr] gap-x-2.5 px-2 py-1.5">
              <span />
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <WaveformIcon />
                Hearing…
              </span>
              <span className="col-start-2 text-[13px] text-foreground/75">{state.partial}</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

function Footer({ state }: { readonly state: SubtitleState }) {
  const delays = [
    state.textDelay === undefined ? undefined : `${state.textDelay.toFixed(1)} s to text`,
    state.translationDelay === undefined
      ? undefined
      : `${state.translationDelay.toFixed(1)} s to translation`,
    state.tokens === 0 ? undefined : `${formatTokens(state.tokens)} tokens`,
    state.costUsd === undefined ? undefined : formatUsd(state.costUsd),
  ].filter((part) => part !== undefined)

  return (
    <div className="flex items-center gap-2.5 px-1 text-[11px] text-muted-foreground">
      {running(state) ? <Meter /> : null}
      <span className="flex-1 truncate">{delays.join(' · ')}</span>
      <span>{[state.model, state.device].filter((part) => part !== undefined).join(' · ')}</span>
    </div>
  )
}

function Controls({ state }: { readonly state: SubtitleState }) {
  const start = useAtomSet(startSubtitlesAtom, { mode: 'promiseExit' })
  const stop = useAtomSet(stopSubtitlesAtom)
  const setPaused = useAtomSet(setSubtitlesPausedAtom)
  const setVisible = useAtomSet(setSubtitleOverlayVisibleAtom)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!running(state)) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          className="h-8 rounded-full px-3.5"
          onClick={async () => {
            setError(undefined)

            const exit = await start({ payload: undefined })

            if (Exit.isFailure(exit)) {
              setError(formErrorOf(exit)?.message)
            }
          }}
        >
          <PlayIcon weight="fill" />
          Start
        </Button>
        {error === undefined ? null : <span className="text-xs text-destructive">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="icon-sm"
        className="rounded-full"
        aria-label={state.overlayVisible ? 'Hide the subtitles' : 'Show the subtitles'}
        onClick={() => setVisible({ payload: { visible: !state.overlayVisible } })}
      >
        {state.overlayVisible ? <EyeIcon /> : <EyeSlashIcon />}
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        className="rounded-full"
        aria-label={state.status === 'paused' ? 'Resume' : 'Pause'}
        onClick={() => setPaused({ payload: { paused: state.status !== 'paused' } })}
      >
        {state.status === 'paused' ? <PlayIcon /> : <PauseIcon />}
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        className="rounded-full"
        aria-label="Stop"
        onClick={() => stop({ payload: undefined })}
      >
        <StopIcon weight="fill" />
      </Button>
    </div>
  )
}

function SettingsButton({ onOpen }: { readonly onOpen: () => void }) {
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full text-muted-foreground"
      aria-label="Subtitle settings"
      title="Subtitle settings"
      onClick={() => {
        setSettingsPage('subtitles')
        setScreen('settings')
        onOpen()
      }}
    >
      <GearIcon />
    </Button>
  )
}

function SlowNote({ state }: { readonly state: SubtitleState }) {
  const running = state.status === 'listening' || state.status === 'paused'

  if (!running || state.slowRecognition !== true) {
    return null
  }

  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-muted/50 px-3.5 py-3 text-sm">
      <LightningIcon className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-medium">Lines are slow to come</div>
        <div className="text-[13px] text-muted-foreground">
          Recognition takes over half a second a line. On a laptop, keep it plugged in: on battery
          the GPU slows down and lines lag.
        </div>
      </div>
    </div>
  )
}

function PluginMissing({ model }: { readonly model: SpeechModelId }) {
  const setScreen = useAtomSet(screenAtom)

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/50 px-3.5 py-3 text-sm">
      <PuzzlePieceIcon className="size-4 shrink-0" />
      <span className="flex-1">
        Live Subtitles needs {speechModels[model].name} to recognise speech.
      </span>
      <Button size="sm" className="h-7 rounded-full" onClick={() => setScreen('plugins')}>
        Open Plugins
      </Button>
    </div>
  )
}

const statusLabel = (state: SubtitleState) => {
  if (state.status === 'loading-model') {
    return 'Loading the speech model…'
  }

  if (state.status === 'paused') {
    return 'Paused'
  }

  return undefined
}

export function SubtitlesPopover() {
  const [open, setOpen] = useAtom(subtitlesPopoverOpenAtom)
  const stateResult = useAtomValue(subtitlesAtom)
  const settingsResult = useAtomValue(subtitleSettingsAtom)
  const state = AsyncResult.isSuccess(stateResult) ? stateResult.value : undefined
  const settings = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : undefined
  const model = settings?.model ?? defaultSpeechModel
  const pluginReady = isPluginReady(useAtomValue(pluginsAtom), model)
  const listening = state?.status === 'listening'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Subtitles"
            className={cn(
              'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
              open && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
            )}
          />
        }
      >
        <WaveformIcon />
        Subtitles
        {running(state) ? (
          <span
            className={cn(
              'ml-auto size-2 rounded-full',
              listening ? 'animate-pulse bg-success' : 'bg-muted-foreground',
            )}
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={24}
        className="flex w-[544px] flex-col gap-3 rounded-[22px] bg-popover/75 p-4 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-start gap-3 px-1 pt-0.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-medium">
              <WaveformIcon className="size-4 text-muted-foreground" />
              Live Subtitles
              {state === undefined || statusLabel(state) === undefined ? null : (
                <span className="text-xs font-normal text-muted-foreground">
                  {statusLabel(state)}
                </span>
              )}
            </div>
            {settings === undefined ? null : <Sentence settings={settings} />}
          </div>
          {state === undefined || !pluginReady ? null : <Controls state={state} />}
          <SettingsButton onOpen={() => setOpen(false)} />
        </div>

        {pluginReady ? null : <PluginMissing model={model} />}

        {state?.status === 'failed' && state.message !== undefined ? (
          <div className="flex items-start gap-2.5 rounded-2xl bg-muted/50 px-3.5 py-3 text-sm">
            <ArrowClockwiseIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">Live Subtitles stopped</div>
              <div className="text-[13px] text-muted-foreground">{state.message}</div>
            </div>
          </div>
        ) : null}

        {state === undefined ? null : <SlowNote state={state} />}

        {state === undefined ? null : <Backlog state={state} />}
        {state === undefined ? null : <Footer state={state} />}
      </PopoverContent>
    </Popover>
  )
}
