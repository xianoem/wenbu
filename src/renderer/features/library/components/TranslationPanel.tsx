import { useAtomRefresh, useAtomSet, useAtomSubscribe, useAtomValue } from '@effect/atom-react'
import {
  CaretRightIcon,
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  type Icon,
  MinusCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type {
  SpendLimit,
  StepId,
  StepStatus,
  TranslationRun,
  TranslationScope,
  TranslationSettings,
  TranslationStep,
} from '#contract/GameTranslation'
import { type Game, isTranslatable } from '#contract/Library'
import type { SpaceShortfall } from '#contract/Storage'
import { formErrorOf, spaceErrorOf } from '#lib/forms'
import { screenAtom, translationReviewAtom } from '#lib/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#ui/alert-dialog'
import { Button } from '#ui/button'
import { InlineTextEdit } from '#ui/inline-text-edit'
import { ScrollArea } from '#ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '#ui/trace'
import { useLlmSettings } from '../../settings/llm'
import { NotEnoughSpaceNotice } from '../../storage/NotEnoughSpaceNotice'
import {
  cancelTranslationAtom,
  estimateKey,
  formatLimit,
  formatMoment,
  formatTokens,
  formatUsd,
  gamesAtom,
  latestRunAtom,
  libraryKeys,
  removeTranslationAtom,
  saveTranslationSettingsAtom,
  startTranslationAtom,
  translationEstimateAtom,
  translationKeys,
  translationRunsAtom,
  translationSettingsAtom,
} from '../library'
import { gameUpdateAtom } from '../../translation/translationLines'
import { OutsideChangesNotice } from '../../translation/OutsideChangesNotice'
import { UpdateNotice } from '../../translation/UpdateNotice'
import { SpendMeter } from './SpendMeter'
import { TranslateDialog } from './TranslateDialog'
import { TranslationEstimate } from './TranslationEstimate'

const stepTitles: Record<StepId, string> = {
  prepare: 'Save the original files',
  extract: 'Find the text',
  translate: 'Translate',
  apply: 'Write to the game',
}

const stepIcons: Record<StepStatus, { readonly Icon: Icon; readonly className: string }> = {
  pending: { Icon: CircleIcon, className: '' },
  running: { Icon: CircleNotchIcon, className: 'animate-spin text-foreground' },
  done: { Icon: CheckCircleIcon, className: 'text-success' },
  warning: { Icon: WarningCircleIcon, className: 'text-warning' },
  failed: { Icon: XCircleIcon, className: 'text-destructive' },
  cancelled: { Icon: MinusCircleIcon, className: '' },
}

const lineStatuses: Partial<Record<StepStatus, 'running' | 'error' | 'pending'>> = {
  running: 'running',
  failed: 'error',
  pending: 'pending',
}

const lineStatus = (status: StepStatus) => {
  const mapped = lineStatuses[status]

  return mapped === undefined ? {} : { status: mapped }
}

const runLabels: Record<
  TranslationRun['status'],
  { readonly text: string; readonly className: string }
> = {
  running: { text: 'Translating', className: 'text-warning' },
  translated: { text: 'Translated', className: 'text-success' },
  partial: { text: 'Partly translated', className: 'text-warning' },
  failed: { text: 'Failed', className: 'text-destructive' },
  cancelled: { text: 'Cancelled', className: 'text-muted-foreground' },
}

const barColors: Record<TranslationRun['status'], string> = {
  running: 'bg-warning',
  translated: 'bg-success',
  partial: 'bg-warning',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
}

const percentOf = (run: TranslationRun) =>
  run.lines.total === 0 ? 0 : Math.floor((run.lines.translated / run.lines.total) * 100)

const costOf = (run: TranslationRun) =>
  [
    run.usage.inputTokens + run.usage.outputTokens > 0
      ? `${formatTokens(run.usage.inputTokens + run.usage.outputTokens)} tokens`
      : undefined,
    run.usage.costUsd === undefined ? undefined : formatUsd(run.usage.costUsd),
  ].filter((part) => part !== undefined)

function StepLine({ step }: { readonly step: TranslationStep }) {
  const { Icon, className } = stepIcons[step.status]

  const line = (
    <TraceLine {...lineStatus(step.status)} className="max-w-full">
      <TraceIcon>
        <Icon className={className} />
      </TraceIcon>
      <TraceTitle className="text-foreground">{stepTitles[step.id]}</TraceTitle>
      {step.summary === undefined ? null : (
        <TraceDescription className="min-w-0 truncate">{step.summary}</TraceDescription>
      )}
    </TraceLine>
  )

  if (step.notes.length === 0) {
    return line
  }

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-48">
          <ul className="flex flex-col gap-1 pr-3 text-[13px]">
            {step.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </ScrollArea>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function RunProgress({ run }: { readonly run: TranslationRun }) {
  const done = run.status === 'translated' || run.status === 'partial'
  const lines = done ? run.lines.written : run.lines.translated
  const percent = run.lines.total === 0 ? 0 : Math.floor((lines / run.lines.total) * 100)
  const label = run.status === 'running' ? `${percentOf(run)}%` : runLabels[run.status].text

  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Translated lines"
        aria-valuenow={percent}
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            barColors[run.status],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn('text-[13px] font-medium', runLabels[run.status].className)}>
        {label}
      </span>
    </div>
  )
}

function TargetLanguage({
  settings,
  disabled,
}: {
  readonly settings: TranslationSettings
  readonly disabled: boolean
}) {
  const save = useAtomSet(saveTranslationSettingsAtom, { mode: 'promiseExit' })

  const submit = async (targetLanguage: string) => {
    const exit = await save({
      payload: { ...settings, targetLanguage },
      reactivityKeys: ['translation-settings'],
    })

    return Exit.isSuccess(exit) ? undefined : formErrorOf(exit)?.message
  }

  return (
    <InlineTextEdit
      value={settings.targetLanguage}
      label="Language to translate into"
      placeholder="English"
      hint="Any language, like “Brazilian Portuguese”."
      title="The game's own language is detected automatically."
      align="end"
      disabled={disabled}
      onSave={submit}
    >
      into {settings.targetLanguage}
    </InlineTextEdit>
  )
}

function PresetPicker({
  settings,
  disabled,
}: {
  readonly settings: TranslationSettings
  readonly disabled: boolean
}) {
  const llm = useLlmSettings()
  const save = useAtomSet(saveTranslationSettingsAtom)
  const setScreen = useAtomSet(screenAtom)
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  if (presets.length === 0) {
    return (
      <Button variant="link" className="h-8 px-1 text-[13px]" onClick={() => setScreen('settings')}>
        Add a preset in Settings
      </Button>
    )
  }

  return (
    <Select
      items={Object.fromEntries(presets.map((preset) => [preset.id, preset.name]))}
      value={settings.presetId === '' ? null : settings.presetId}
      disabled={disabled}
      onValueChange={(presetId) => {
        if (presetId !== null) {
          save({ payload: { ...settings, presetId }, reactivityKeys: ['translation-settings'] })
        }
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Preset"
        className="h-8 rounded-full border-0 bg-transparent px-3 text-[13px] text-muted-foreground hover:bg-muted dark:bg-transparent"
      >
        <SelectValue placeholder="Choose a preset" />
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

const translateLabel = (game: Game, run: TranslationRun | undefined, remaining: number) => {
  if (game.translation === 'original') {
    return run?.status === 'failed' ? 'Try again' : 'Translate'
  }

  return remaining > 0
    ? `Translate ${remaining.toLocaleString('en-US')} more lines`
    : 'Translate again'
}

function History({ runs }: { readonly runs: ReadonlyArray<TranslationRun> }) {
  return (
    <ul className="mt-4 flex flex-col gap-1 text-[13px]">
      {runs.map((run) => (
        <li key={run.id} className="flex gap-3 rounded-xl bg-muted/40 px-3.5 py-2">
          <span className="flex-1 text-muted-foreground">{formatMoment(run.startedAt)}</span>
          <span className={runLabels[run.status].className}>{runLabels[run.status].text}</span>
          <span className="w-36 text-right text-muted-foreground">
            {[`${run.lines.written.toLocaleString('en-US')} lines`, ...costOf(run)].join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TranslationPanel({
  game,
  onUpdateGame,
}: {
  readonly game: Game
  readonly onUpdateGame: () => void
}) {
  const latest = useAtomValue(latestRunAtom(game.id))
  const settingsResult = useAtomValue(translationSettingsAtom)
  const runsResult = useAtomValue(translationRunsAtom(game.id))
  const start = useAtomSet(startTranslationAtom, { mode: 'promiseExit' })
  const cancel = useAtomSet(cancelTranslationAtom)
  const remove = useAtomSet(removeTranslationAtom, { mode: 'promiseExit' })
  const refreshGames = useAtomRefresh(gamesAtom)
  const refreshRuns = useAtomRefresh(translationRunsAtom(game.id))
  const missingAtom = translationEstimateAtom(estimateKey(game.id, 'missing'))
  const changedAtom = translationEstimateAtom(estimateKey(game.id, 'changed'))
  const missingResult = useAtomValue(missingAtom)
  const changedResult = useAtomValue(changedAtom)
  const refreshMissing = useAtomRefresh(missingAtom)
  const refreshChanged = useAtomRefresh(changedAtom)
  const updateResult = useAtomValue(gameUpdateAtom(game.id))
  const refreshUpdate = useAtomRefresh(gameUpdateAtom(game.id))
  const [error, setError] = useState<string | undefined>(undefined)
  const [outsideChanges, setOutsideChanges] = useState<string | undefined>(undefined)
  const [space, setSpace] = useState<SpaceShortfall | undefined>(undefined)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingRun, setConfirmingRun] = useState(false)
  const [showingHistory, setShowingHistory] = useState(false)
  const review = useAtomSet(translationReviewAtom)

  useAtomSubscribe(latestRunAtom(game.id), (result) => {
    if (
      AsyncResult.isSuccess(result) &&
      Option.exists(result.value, (run) => run.status !== 'running')
    ) {
      refreshGames()
      refreshRuns()
      refreshMissing()
      refreshChanged()
      refreshUpdate()
    }
  })

  const latestRun = AsyncResult.isSuccess(latest) ? Option.getOrUndefined(latest.value) : undefined

  const run =
    latestRun !== undefined &&
    game.translation === 'original' &&
    (latestRun.status === 'translated' || latestRun.status === 'partial')
      ? undefined
      : latestRun

  const running = run?.status === 'running'
  const settings = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : undefined
  const runs = AsyncResult.isSuccess(runsResult) ? runsResult.value : []
  const missing = AsyncResult.isSuccess(missingResult) ? missingResult.value : undefined
  const changed = AsyncResult.isSuccess(changedResult) ? changedResult.value : undefined

  const update =
    AsyncResult.isSuccess(updateResult) && Option.isSome(updateResult.value)
      ? updateResult.value.value
      : undefined

  const translate = async (scope: TranslationScope, spendLimit?: SpendLimit) => {
    setConfirmingRun(false)
    setError(undefined)

    const exit = await start({
      payload: { gameId: game.id, scope, ...(spendLimit === undefined ? {} : { spendLimit }) },
    })

    const shortfall = spaceErrorOf(exit)
    const failure = shortfall === undefined ? formErrorOf(exit) : undefined
    const stopped = failure?.field === 'gameFiles'

    setSpace(shortfall)
    setOutsideChanges(stopped ? failure.message : undefined)
    setError(stopped ? undefined : failure?.message)
  }

  const needsConfirming = () => {
    if (missing === undefined || changed === undefined || settings === undefined) {
      return false
    }

    const choice = changed.lines > 0 && missing.lines > changed.lines

    const costly =
      settings.confirmAboveUsd !== undefined &&
      (missing.costUsd?.high ?? 0) > settings.confirmAboveUsd

    return choice || costly
  }

  const confirmRemove = async () => {
    setConfirmingRemove(false)

    const exit = await remove({
      payload: { gameId: game.id },
      reactivityKeys: [...libraryKeys, ...translationKeys],
    })

    setError(Exit.isFailure(exit) ? formErrorOf(exit)?.message : undefined)
  }

  if (!isTranslatable(game.engine)) {
    return (
      <section className="mt-7 rounded-3xl bg-card p-5 text-muted-foreground shadow-card">
        Wenbu translates RPG Maker MV, MZ and VX Ace games. This game uses another engine.
      </section>
    )
  }

  return (
    <section className="mt-7 rounded-3xl bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <h2 className="flex-1 pt-0.5 text-[15px] font-semibold tracking-tight">Translation</h2>
        {settings === undefined ? null : <TargetLanguage settings={settings} disabled={running} />}
      </div>

      {run === undefined ? (
        <p className="mt-3 text-muted-foreground">
          Wenbu keeps a copy of the original files, so the game can always go back.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <RunProgress run={run} />
          <Trace>
            {run.steps.map((step) => (
              <StepLine key={step.id} step={step} />
            ))}
          </Trace>
          {running ? <SpendMeter run={run} /> : null}
          {run.error === undefined ? null : <p className="text-sm text-destructive">{run.error}</p>}
          {run.stopped !== undefined && !running ? (
            <p className="text-sm text-warning">
              Stopped at the {formatLimit(run.stopped.limit, run.usage.costUsd !== undefined)}{' '}
              spending limit. What was translated is in the game.
            </p>
          ) : null}
        </div>
      )}

      {!running && update?.active === true ? (
        <UpdateNotice
          gameId={game.id}
          update={update}
          estimate={changed}
          disabled={settings?.presetId === ''}
          onTranslate={() => void translate('changed', settings?.spendLimit)}
        />
      ) : null}

      {!running &&
      update?.active !== true &&
      missing !== undefined &&
      missing.lines > 0 &&
      settings !== undefined ? (
        <TranslationEstimate estimate={missing} settings={settings} />
      ) : null}

      {space === undefined ? null : (
        <NotEnoughSpaceNotice
          className="mt-3"
          space={space}
          onRetry={() => void translate('missing')}
        />
      )}

      {error === undefined ? null : <p className="mt-3 text-sm text-destructive">{error}</p>}

      {outsideChanges === undefined ? null : (
        <OutsideChangesNotice
          className="mt-3"
          gameId={game.id}
          message={outsideChanges}
          onRestored={() => setOutsideChanges(undefined)}
          onUpdateGame={() => {
            setOutsideChanges(undefined)
            onUpdateGame()
          }}
        />
      )}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {running ? (
          <Button
            variant="outline"
            className="h-8 rounded-full px-4"
            onClick={() => cancel({ payload: { gameId: game.id } })}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant={game.translation === 'original' ? 'default' : 'outline'}
            className="h-8 rounded-full px-4"
            disabled={settings?.presetId === ''}
            onClick={() => (needsConfirming() ? setConfirmingRun(true) : void translate('missing'))}
          >
            {translateLabel(game, run, missing?.lines ?? 0)}
          </Button>
        )}
        {settings === undefined ? null : <PresetPicker settings={settings} disabled={running} />}
        <span className="flex-1" />
        {!running && game.translation !== 'original' ? (
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 text-[13px] font-normal"
            onClick={() => review(game.id)}
          >
            Review text
          </Button>
        ) : null}
        {!running && game.translation !== 'original' ? (
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 text-[13px] font-normal text-destructive hover:text-destructive"
            onClick={() => setConfirmingRemove(true)}
          >
            Remove translation
          </Button>
        ) : null}
        {runs.length === 0 ? null : (
          <Button
            variant="ghost"
            aria-expanded={showingHistory}
            className="group h-8 gap-1 rounded-full px-3 text-[13px] font-normal text-muted-foreground"
            onClick={() => setShowingHistory(!showingHistory)}
          >
            History
            <CaretRightIcon className="transition-transform group-aria-expanded:rotate-90" />
          </Button>
        )}
      </div>

      {showingHistory ? <History runs={runs} /> : null}

      {confirmingRun && settings !== undefined && missing !== undefined && changed !== undefined ? (
        <TranslateDialog
          title={game.title}
          settings={settings}
          estimates={{ missing, changed }}
          open
          onOpenChange={setConfirmingRun}
          onStart={(scope, spendLimit) => void translate(scope, spendLimit)}
        />
      ) : null}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the translation?</AlertDialogTitle>
            <AlertDialogDescription>
              Wenbu puts the original game files back and forgets the translated text, with your
              edits and locks. The run history stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRemove()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
