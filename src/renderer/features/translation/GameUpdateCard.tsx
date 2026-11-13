import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  FileZipIcon,
  type Icon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import type {
  InstallProgress,
  InstallStep,
  UpdateCheck,
  UpdateInspection,
} from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { formatBytes } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { libraryKeys, translationKeys } from '../library/library'
import {
  inspectGameUpdateAtom,
  installGameUpdateAtom,
  installProgressAtom,
  lineKeys,
} from './translationLines'

const checkIcons: Record<
  UpdateCheck['status'],
  { readonly Icon: Icon; readonly className: string }
> = {
  ok: { Icon: CheckCircleIcon, className: 'text-success' },
  warning: { Icon: WarningCircleIcon, className: 'text-warning' },
  blocked: { Icon: XCircleIcon, className: 'text-destructive' },
}

const installSteps: ReadonlyArray<{
  readonly id: InstallStep
  readonly label: string
  readonly weight: number
}> = [
  { id: 'restore', label: 'Put the original text back', weight: 5 },
  { id: 'unpack', label: 'Unpack the update', weight: 50 },
  { id: 'backup', label: 'Back up the files it replaces', weight: 15 },
  { id: 'move', label: 'Copy the new files in', weight: 20 },
  { id: 'settle', label: 'Find what changed and keep your translation', weight: 10 },
]

const percentOf = (progress: InstallProgress | undefined) => {
  if (progress === undefined) {
    return 0
  }

  if (progress.step === 'done') {
    return 100
  }

  const at = installSteps.findIndex((step) => step.id === progress.step)
  const before = installSteps.slice(0, at).reduce((total, step) => total + step.weight, 0)
  const share = progress.total === 0 ? 0 : progress.done / progress.total

  return Math.round(before + (installSteps[at]?.weight ?? 0) * share)
}

function InstallTrace({ gameId }: { readonly gameId: string }) {
  const result = useAtomValue(installProgressAtom(gameId))

  const progress =
    AsyncResult.isSuccess(result) && Option.isSome(result.value) ? result.value.value : undefined

  const at = installSteps.findIndex((step) => step.id === progress?.step)
  const percent = percentOf(progress)

  return (
    <div className="mt-4 flex flex-col gap-2">
      {installSteps.map((step, index) => {
        const done = progress?.step === 'done' || (at !== -1 && index < at)
        const current = index === at

        return (
          <span
            key={step.id}
            className={cn(
              'flex items-center gap-2 text-sm',
              !done && !current && 'text-muted-foreground',
            )}
          >
            {done ? <CheckCircleIcon weight="fill" className="size-4 text-success" /> : null}
            {current ? <CircleNotchIcon className="size-4 animate-spin" /> : null}
            {!done && !current ? <CircleIcon className="size-4" /> : null}
            {step.label}
            {current && progress !== undefined && progress.total > 0 ? (
              <span className="text-[13px] text-muted-foreground">
                {step.id === 'unpack'
                  ? `${formatBytes(progress.done)} of ${formatBytes(progress.total)}`
                  : `${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}`}
              </span>
            ) : null}
          </span>
        )
      })}
      <div
        role="progressbar"
        aria-label="Update progress"
        aria-valuenow={percent}
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Play is paused until the update finishes. If anything fails, Wenbu puts the backed-up files
        back.
      </p>
    </div>
  )
}

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'checked'; readonly inspection: UpdateInspection }
  | { readonly kind: 'installing'; readonly inspection: UpdateInspection }
  | { readonly kind: 'failed'; readonly message: string; readonly inspection?: UpdateInspection }

function Check({ check }: { readonly check: UpdateCheck }) {
  const { Icon, className } = checkIcons[check.status]

  return (
    <div className="flex items-start gap-2" title={check.detail}>
      <Icon weight="fill" className={cn('mt-0.5 size-4 shrink-0', className)} />
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium">{check.title}</span>
        <span className="text-xs text-muted-foreground">{check.detail}</span>
      </span>
    </div>
  )
}

const statusPill = (phase: Phase) => {
  if (phase.kind === 'checking') {
    return { text: 'Checking', className: 'bg-info/12 text-info' }
  }

  if (phase.kind === 'installing') {
    return { text: 'Updating', className: 'bg-info/12 text-info' }
  }

  if (phase.kind === 'failed' || phase.inspection.blocked) {
    return { text: 'Can’t install', className: 'bg-destructive/12 text-destructive' }
  }

  return phase.inspection.checks.some((check) => check.status === 'warning')
    ? { text: 'Check the warnings', className: 'bg-warning/10 text-warning' }
    : { text: 'Ready to install', className: 'bg-success/10 text-success' }
}

export function GameUpdateCard({
  game,
  archive,
  onChooseAnother,
  onClose,
}: {
  readonly game: Game
  readonly archive: string
  readonly onChooseAnother: () => void
  readonly onClose: () => void
}) {
  const inspect = useAtomSet(inspectGameUpdateAtom, { mode: 'promiseExit' })
  const install = useAtomSet(installGameUpdateAtom, { mode: 'promiseExit' })
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })

  useEffect(() => {
    let current = true

    void inspect({ payload: { gameId: game.id, archive } }).then((exit) => {
      if (!current) {
        return
      }

      setPhase(
        Exit.isSuccess(exit)
          ? { kind: 'checked', inspection: exit.value }
          : { kind: 'failed', message: formErrorOf(exit)?.message ?? 'The zip could not be read.' },
      )
    })

    return () => {
      current = false
    }
  }, [archive, game.id, inspect])

  const inspection = phase.kind === 'checking' ? undefined : phase.inspection
  const warnings = inspection?.checks.some((check) => check.status === 'warning') ?? false
  const pill = statusPill(phase)

  const start = async (found: UpdateInspection) => {
    setPhase({ kind: 'installing', inspection: found })

    const exit = await install({
      payload: { gameId: game.id, archive, acceptWarnings: true },
      reactivityKeys: [...lineKeys, ...translationKeys, ...libraryKeys],
    })

    if (Exit.isSuccess(exit)) {
      onClose()

      return
    }

    setPhase({
      kind: 'failed',
      inspection: found,
      message: formErrorOf(exit)?.message ?? 'The update could not be installed.',
    })
  }

  return (
    <section className="mt-7 rounded-3xl bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Game update</h2>
        <span
          className={cn(
            'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
            pill.className,
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {pill.text}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted px-3.5 py-2.5">
        <span className="grid size-9 place-items-center rounded-[10px] bg-card">
          <FileZipIcon className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{inspection?.archive ?? archive}</span>
          <span className="text-xs text-muted-foreground">
            {inspection === undefined
              ? 'Reading the zip…'
              : `${formatBytes(inspection.archiveBytes)} · ${inspection.replaced.toLocaleString('en-US')} files replaced, ${inspection.added.toLocaleString('en-US')} new`}
          </span>
        </span>
        {inspection?.version === undefined ? null : (
          <span className="text-[13px] text-muted-foreground">Version {inspection.version}</span>
        )}
      </div>

      {inspection === undefined ? null : (
        <div className="mt-3 grid grid-cols-3 gap-x-5 gap-y-2.5">
          {inspection.checks.map((check) => (
            <Check key={check.id} check={check} />
          ))}
        </div>
      )}

      {phase.kind === 'installing' ? <InstallTrace gameId={game.id} /> : null}

      {phase.kind === 'failed' ? (
        <p className="mt-3 text-sm text-destructive">
          {phase.message}
          {inspection?.blocked === true ? ' Nothing was changed.' : ''}
        </p>
      ) : null}

      {phase.kind === 'checked' || phase.kind === 'failed' ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {phase.kind === 'checked' && !phase.inspection.blocked ? (
            <Button className="h-8 rounded-full px-4" onClick={() => void start(phase.inspection)}>
              {warnings ? 'Install anyway' : 'Install update'}
            </Button>
          ) : null}
          <Button variant="secondary" className="h-8 rounded-full px-4" onClick={onChooseAnother}>
            Choose another zip
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" className="h-8 rounded-full px-3 font-normal" onClick={onClose}>
            Cancel
          </Button>
        </div>
      ) : null}

      {phase.kind === 'checked' && !phase.inspection.blocked ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Wenbu backs up every file the update replaces, so you can undo it from the Translation
          card.
        </p>
      ) : null}
    </section>
  )
}
