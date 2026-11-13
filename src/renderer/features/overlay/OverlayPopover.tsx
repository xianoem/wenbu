import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowClockwiseIcon,
  BookOpenIcon,
  CaretDownIcon,
  CodeIcon,
  CpuIcon,
  EyeIcon,
  EyeSlashIcon,
  GearIcon,
  GlobeIcon,
  ListMagnifyingGlassIcon,
  MonitorPlayIcon,
  PlayIcon,
  PlugsIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  StopIcon,
  TranslateIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type ReactNode, useState } from 'react'
import { type Game, type GameLocale, localeLabels, type StartLocale } from '#contract/Library'
import type {
  OverlayDiagnostic,
  OverlayHook,
  OverlayState,
  OverlayStatus,
} from '#contract/TranslationOverlay'
import { formErrorOf } from '#lib/forms'
import { formatMoment } from '#lib/format'
import { gameIdAtom, screenAtom, settingsPageAtom } from '#lib/navigation'
import { Badge } from '#ui/badge'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '#ui/empty'
import { Input } from '#ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Spinner } from '#ui/spinner'
import {
  formatTokens,
  formatUsd,
  gamesAtom,
  libraryKeys,
  setLaunchLocaleAtom,
} from '../library/library'
import { isPluginReady, pluginsAtom } from '../plugins/plugins'
import { AttachPanel } from './components/AttachPanel'
import { HookRow } from './components/HookRow'
import { TextPipelineDialog } from './components/TextPipelineDialog'
import {
  attachOverlayElevatedAtom,
  insertHookCodeAtom,
  launchWithOverlayAtom,
  overlayAtom,
  overlayGameAtom,
  overlayGameKeys,
  overlayHooksAtom,
  overlayPopoverOpenAtom,
  overlaySettingsAtom,
  resetStoryAtom,
  retryAttachAtom,
  selectHookAtom,
  setOverlayVisibleAtom,
  stopOverlayAtom,
} from './overlay'
import { overlayIndicator } from './utils/overlayIndicator'

interface StatusMeta {
  readonly label: string
  readonly tone: 'default' | 'secondary' | 'destructive' | 'outline'
  readonly spin?: boolean
}

const statusMeta: Record<OverlayStatus, StatusMeta> = {
  idle: { label: 'Idle', tone: 'outline' },
  launching: { label: 'Launching', tone: 'secondary', spin: true },
  attached: { label: 'Attached', tone: 'default' },
  'waiting-for-text': { label: 'Waiting for text', tone: 'secondary' },
  translating: { label: 'Translating', tone: 'default', spin: true },
  'setup-required': { label: 'Setup required', tone: 'destructive' },
  failed: { label: 'Failed', tone: 'destructive' },
  stopped: { label: 'Stopped', tone: 'outline' },
}

const locales: ReadonlyArray<GameLocale> = ['auto', 'system', 'ntleas', 'locale-remulator']

const toolNames: Record<StartLocale, string> = {
  system: 'the system locale',
  ntleas: 'Ntleas',
  'locale-remulator': 'Locale Remulator',
}

const idleMessage = (state: OverlayState | undefined) => {
  if (state === undefined || state.offer !== undefined || state.message === '') {
    return 'Launch or attach a registered game to inspect hooks.'
  }

  return state.message
}

function SectionRow({
  title,
  count,
  note,
}: {
  readonly title: string
  readonly count?: number
  readonly note?: string
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1 text-xs font-medium text-muted-foreground">
      <span className="text-foreground">{title}</span>
      {count === undefined ? null : (
        <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[11px] text-foreground">
          {count}
        </span>
      )}
      {note === undefined ? null : <span className="text-[11px]">{note}</span>}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function Banner({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description: string
  readonly action: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm">
      <WarningCircleIcon className="size-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {action}
    </div>
  )
}

function SetupBanners({ presetMissing }: { readonly presetMissing: boolean }) {
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const lunaHookReady = isPluginReady(useAtomValue(pluginsAtom), 'luna-hook')

  const openSettings = () => {
    setSettingsPage('overlay')
    setScreen('settings')
  }

  return (
    <>
      {lunaHookReady ? null : (
        <Banner
          title="The Translation Overlay needs LunaHook."
          description="Install it from Plugins to read text from running games."
          action={
            <Button size="sm" variant="outline" onClick={() => setScreen('plugins')}>
              <PuzzlePieceIcon />
              Plugins
            </Button>
          }
        />
      )}
      {presetMissing ? (
        <Banner
          title="Live overlay needs a translation preset."
          description="Complete setup in Settings to translate captured hook text."
          action={
            <Button size="sm" variant="outline" onClick={openSettings}>
              <GearIcon />
              Settings
            </Button>
          }
        />
      ) : null}
    </>
  )
}

function StatusBadge({ status }: { readonly status: OverlayStatus }) {
  const meta = statusMeta[status]

  return (
    <Badge variant={meta.tone} className="gap-1.5">
      {meta.spin === true ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
      {meta.label}
    </Badge>
  )
}

function OfferPanel({ state, game }: { readonly state: OverlayState; readonly game?: Game }) {
  const setLocale = useAtomSet(setLaunchLocaleAtom, { mode: 'promiseExit' })
  const launch = useAtomSet(launchWithOverlayAtom, { mode: 'promiseExit' })
  const elevate = useAtomSet(attachOverlayElevatedAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)
  const { offer } = state

  if (offer === undefined) {
    return null
  }

  const relaunch = async (gameId: string, locale: StartLocale) => {
    const saved = await setLocale({ payload: { id: gameId, locale }, reactivityKeys: libraryKeys })
    const started = await launch({ payload: { gameId }, reactivityKeys: libraryKeys })

    setError(formErrorOf(saved)?.message ?? formErrorOf(started)?.message)
  }

  const action =
    offer.kind === 'locale' ? (
      <Button
        size="sm"
        disabled={game === undefined}
        onClick={() => (game === undefined ? undefined : relaunch(game.id, offer.locale))}
      >
        <GlobeIcon />
        Relaunch with {toolNames[offer.locale]}
      </Button>
    ) : (
      <Button
        size="sm"
        onClick={async () =>
          setError(formErrorOf(await elevate({ payload: { processId: offer.processId } }))?.message)
        }
      >
        <ShieldCheckIcon />
        Attach as administrator
      </Button>
    )

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex items-start gap-3">
        <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 text-[13px]">{state.message}</div>
      </div>
      <div className="flex justify-end">{action}</div>
      {error === undefined ? null : <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

function InsertHookCode() {
  const insert = useAtomSet(insertHookCodeAtom, { mode: 'promiseExit' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = async () => {
    const exit = await insert({ payload: { code } })

    setError(formErrorOf(exit)?.message)

    if (Exit.isSuccess(exit)) {
      setCode('')
    }
  }

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
      >
        <CodeIcon />
        Advanced / insert hook code
        <CaretDownIcon className="ml-auto" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="space-y-2 pr-2">
          <div className="flex gap-2">
            <Input
              aria-label="Hook code"
              value={code}
              placeholder="e.g. HSN-4@1A2B3C:game.exe"
              className="font-mono"
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <Button variant="outline" disabled={code.trim() === ''} onClick={submit}>
              Insert
            </Button>
          </div>
          {error === undefined ? null : <div className="text-xs text-destructive">{error}</div>}
          <div className="text-xs text-muted-foreground">
            Adds a LunaHook code to the running game. Saved codes are inserted again next time.
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Diagnostics({ diagnostics }: { readonly diagnostics: ReadonlyArray<OverlayDiagnostic> }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
      >
        <ListMagnifyingGlassIcon />
        Diagnostics
        {diagnostics.length > 0 ? (
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px]">
            {diagnostics.length}
          </span>
        ) : null}
        <CaretDownIcon className="ml-auto" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {diagnostics.length === 0 ? (
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            No diagnostics yet.
          </div>
        ) : (
          <ScrollArea className="h-48 overflow-hidden">
            <div className="space-y-2 pr-2">
              {diagnostics.toReversed().map((diagnostic) => (
                <div key={diagnostic.id} className="flex gap-2 rounded-lg bg-muted p-2 text-xs">
                  <Badge
                    variant={diagnostic.level === 'error' ? 'destructive' : 'secondary'}
                    className="h-5 uppercase"
                  >
                    {diagnostic.level}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div>{diagnostic.message}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatMoment(diagnostic.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function GameMemory({ gameId }: { readonly gameId: string }) {
  const result = useAtomValue(overlayGameAtom(gameId))
  const resetStory = useAtomSet(resetStoryAtom)

  if (!AsyncResult.isSuccess(result)) {
    return null
  }

  const { savedHook, story } = result.value

  return (
    <>
      {savedHook === undefined ? null : (
        <div className="flex items-center gap-2 rounded-xl border border-border p-3 text-xs">
          <CodeIcon className="text-muted-foreground" />
          <span className="text-muted-foreground">Saved hook</span>
          <code className="min-w-0 truncate font-mono">{savedHook.code}</code>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {formatMoment(savedHook.savedAt)}
          </span>
        </div>
      )}
      {story === undefined ? null : (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-xs">
          <div className="flex items-center gap-2">
            <BookOpenIcon className="text-muted-foreground" />
            <span className="font-medium">Story so far</span>
            <span className="text-muted-foreground">
              {story.lineCount} lines · {formatMoment(story.updatedAt)}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => resetStory({ payload: { gameId }, reactivityKeys: overlayGameKeys })}
            >
              Reset
            </Button>
          </div>
          <ScrollArea className="max-h-32 overflow-hidden">
            <div className="pr-2 whitespace-pre-wrap text-muted-foreground">{story.summary}</div>
          </ScrollArea>
        </div>
      )}
    </>
  )
}

function GamePicker({
  games,
  gameId,
  onChange,
}: {
  readonly games: ReadonlyArray<Game>
  readonly gameId: string | undefined
  readonly onChange: (gameId: string) => void
}) {
  return (
    <Select
      items={Object.fromEntries(games.map((game) => [game.id, game.title]))}
      value={gameId ?? null}
      onValueChange={(value) => (value === null ? undefined : onChange(value))}
    >
      <SelectTrigger aria-label="Game" className="w-full">
        <SelectValue placeholder="Select a registered game…" />
      </SelectTrigger>
      <SelectContent>
        {games.map((game) => (
          <SelectItem key={game.id} value={game.id}>
            {game.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LaunchControls({ game }: { readonly game: Game | undefined }) {
  const launch = useAtomSet(launchWithOverlayAtom, { mode: 'promiseExit' })
  const setLocale = useAtomSet(setLaunchLocaleAtom)
  const lunaHookReady = isPluginReady(useAtomValue(pluginsAtom), 'luna-hook')
  const [error, setError] = useState<string | undefined>(undefined)

  const start = async () => {
    if (game !== undefined) {
      setError(
        formErrorOf(await launch({ payload: { gameId: game.id }, reactivityKeys: libraryKeys }))
          ?.message,
      )
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button className="flex-1" disabled={game === undefined || !lunaHookReady} onClick={start}>
          <PlayIcon />
          Launch with Translation Overlay
        </Button>
        <Select
          items={localeLabels}
          value={game?.locale ?? 'auto'}
          disabled={game === undefined || !lunaHookReady}
          onValueChange={(locale) =>
            game === undefined || locale === null
              ? undefined
              : setLocale({ payload: { id: game.id, locale }, reactivityKeys: libraryKeys })
          }
        >
          <SelectTrigger aria-label="Launch locale" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locales.map((locale) => (
              <SelectItem key={locale} value={locale}>
                {localeLabels[locale]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error === undefined ? null : <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

function SessionCard({ state, title }: { readonly state: OverlayState; readonly title: string }) {
  const setVisible = useAtomSet(setOverlayVisibleAtom)
  const retryAttach = useAtomSet(retryAttachAtom)
  const stop = useAtomSet(stopOverlayAtom)

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
          <TranslateIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{state.message}</div>
        </div>
        <StatusBadge status={state.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {state.processIds.length > 0 ? (
          state.processIds.map((pid) => (
            <span
              key={pid}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-mono text-xs"
            >
              <CpuIcon />
              pid {pid}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
            <PlugsIcon />
            No process attached
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
          {state.visible ? <EyeIcon /> : <EyeSlashIcon />}
          Overlay {state.visible ? 'visible' : 'hidden'}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        {state.visible ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVisible({ payload: { visible: false } })}
          >
            <EyeSlashIcon />
            Hide
          </Button>
        ) : (
          <Button size="sm" onClick={() => setVisible({ payload: { visible: true } })}>
            <EyeIcon />
            Show
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => retryAttach({ payload: undefined })}>
          <ArrowClockwiseIcon />
          Retry attach
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="ml-auto"
          onClick={() => stop({ payload: undefined })}
        >
          <StopIcon />
          Stop
        </Button>
      </div>
    </div>
  )
}

function Latest({ state }: { readonly state: OverlayState }) {
  if (state.sourceText === undefined && state.translatedText === undefined) {
    return null
  }

  const { usage } = state
  const tokens = usage.inputTokens + usage.outputTokens

  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        Latest
        {state.cacheHit ? <Badge variant="secondary">cache hit</Badge> : null}
        {state.translating ? <Badge>live</Badge> : null}
      </div>
      {state.sourceText === undefined ? null : (
        <div className="line-clamp-2 text-muted-foreground">{state.sourceText}</div>
      )}
      {state.translatedText === undefined ? null : (
        <div className="mt-2 line-clamp-3 text-sm font-medium">{state.translatedText}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {tokens === 0 ? (
          <span>No tokens consumed yet</span>
        ) : (
          <>
            <span>{formatTokens(tokens)} tokens</span>
            {usage.costUsd === undefined ? null : <span>{formatUsd(usage.costUsd)}</span>}
            <span className="min-w-0 truncate">{usage.modelName ?? 'Unknown model'}</span>
          </>
        )}
      </div>
    </div>
  )
}

function HookList({ gameId, gameTitle }: { readonly gameId: string; readonly gameTitle: string }) {
  const result = useAtomValue(overlayHooksAtom)
  const overlayGame = useAtomValue(overlayGameAtom(gameId))
  const select = useAtomSet(selectHookAtom)
  const [sample, setSample] = useState<string | undefined>(undefined)
  const hooks: ReadonlyArray<OverlayHook> = AsyncResult.isSuccess(result) ? result.value : []
  const selected = hooks.find((hook) => hook.selected)
  const others = hooks.filter((hook) => !hook.selected)

  const enabledCount = AsyncResult.isSuccess(overlayGame)
    ? overlayGame.value.pipeline.processors.filter((processor) => processor.enabled).length
    : 0

  const row = (hook: OverlayHook) => (
    <HookRow
      key={hook.id}
      hook={hook}
      enabledProcessorCount={enabledCount}
      onSelect={(hookId) => select({ payload: { hookId }, reactivityKeys: overlayGameKeys })}
      onOpenTextProcessing={setSample}
    />
  )

  return (
    <>
      <SectionRow title="Hook candidates" count={hooks.length} note="Auto-picked best match" />
      {selected === undefined ? null : row(selected)}
      {others.length === 0 ? null : (
        <div className="space-y-1">
          <div className="px-1 text-[11px] font-medium text-muted-foreground">Other candidates</div>
          <ScrollArea className="h-40 overflow-hidden rounded-xl">
            <div className="space-y-2 pr-3">{others.map(row)}</div>
          </ScrollArea>
        </div>
      )}
      {sample === undefined ? null : (
        <TextPipelineDialog
          gameId={gameId}
          gameTitle={gameTitle}
          initialText={sample}
          onClose={() => setSample(undefined)}
        />
      )}
    </>
  )
}

export function OverlayPopover() {
  const [open, setOpen] = useAtom(overlayPopoverOpenAtom)
  const stateResult = useAtomValue(overlayAtom)
  const settings = useAtomValue(overlaySettingsAtom)
  const gamesResult = useAtomValue(gamesAtom)
  const pageGameId = useAtomValue(gameIdAtom)
  const [pickedGameId, setPickedGameId] = useState<string | undefined>(undefined)
  const state = AsyncResult.isSuccess(stateResult) ? stateResult.value : undefined
  const games = AsyncResult.isSuccess(gamesResult) ? gamesResult.value : []
  const active = state?.sessionId !== undefined
  const gameId = state?.gameId ?? pickedGameId ?? pageGameId
  const game = games.find((candidate) => candidate.id === gameId)
  const title = state?.gameTitle ?? game?.title ?? 'Translation Overlay'
  const presetMissing = AsyncResult.isSuccess(settings) && settings.value.presetId === ''
  const indicator = overlayIndicator(state)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Overlay"
            className={cn(
              'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
              open && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
            )}
          />
        }
      >
        <MonitorPlayIcon />
        Overlay
        {indicator === undefined ? null : (
          <span className={cn('ml-auto size-2 animate-pulse rounded-full', indicator)} />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={24}
        className="flex max-h-[calc(100vh-2rem)] w-[36rem] flex-col overflow-hidden rounded-[22px] bg-popover/90 p-0 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="inline-flex items-center gap-2 text-sm font-semibold">
            <MonitorPlayIcon className="text-muted-foreground" />
            Translation Overlay
          </div>
          {state?.sessionId === undefined ? null : (
            <span className="font-mono text-xs text-muted-foreground">
              {state.sessionId.slice(-8)}
            </span>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col gap-3 px-3 pb-3">
            <SetupBanners presetMissing={presetMissing} />

            {active ? (
              <>
                <SessionCard state={state} title={title} />
                <OfferPanel state={state} {...(game === undefined ? {} : { game })} />
                <Latest state={state} />
                {gameId === undefined ? null : <HookList gameId={gameId} gameTitle={title} />}
                <InsertHookCode />
              </>
            ) : (
              <>
                {state === undefined ? null : (
                  <OfferPanel state={state} {...(game === undefined ? {} : { game })} />
                )}
                <Empty className="min-h-36 border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MonitorPlayIcon />
                    </EmptyMedia>
                    <EmptyTitle>No overlay session</EmptyTitle>
                    <EmptyDescription>{idleMessage(state)}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
                <GamePicker games={games} gameId={gameId} onChange={setPickedGameId} />
                <LaunchControls game={game} />
              </>
            )}

            {gameId === undefined ? null : <GameMemory gameId={gameId} />}
            <SectionRow title="Attach to a process" />
            <AttachPanel gameId={gameId} />
            <Diagnostics diagnostics={state?.diagnostics ?? []} />
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
