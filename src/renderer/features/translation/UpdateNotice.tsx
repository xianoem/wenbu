import { useAtomSet } from '@effect/atom-react'
import { ArrowCircleUpIcon, ArrowCounterClockwiseIcon, LockSimpleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { GameUpdateSummary, TranslationEstimate } from '#contract/GameTranslation'
import { formatMoment } from '#lib/format'
import { sourceChangesAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { formatTokens, formatUsd } from '../library/library'
import { UndoUpdateDialog } from './UndoUpdateDialog'

function Count({
  label,
  value,
  className,
}: {
  readonly label: string
  readonly value: number
  readonly className?: string
}) {
  return (
    <div className="flex flex-col rounded-2xl bg-muted px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('mt-0.5 text-lg font-semibold tracking-tight', className)}>
        {value.toLocaleString('en-US')}
      </span>
    </div>
  )
}

const estimateText = (estimate: TranslationEstimate | undefined) => {
  if (estimate === undefined || estimate.lines === 0) {
    return undefined
  }

  const tokens = `≈ ${formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens`

  return estimate.costUsd === undefined
    ? tokens
    : `${tokens} · ≈ ${formatUsd(estimate.costUsd.low)}`
}

export function UpdateNotice({
  gameId,
  update,
  estimate,
  disabled,
  onTranslate,
}: {
  readonly gameId: string
  readonly update: GameUpdateSummary
  readonly estimate: TranslationEstimate | undefined
  readonly disabled: boolean
  readonly onTranslate: () => void
}) {
  const openChanges = useAtomSet(sourceChangesAtom)
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const cost = estimateText(estimate)
  const install = update.install

  return (
    <div className="mt-4 rounded-[20px] bg-warning/7 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <ArrowCircleUpIcon className="size-[18px] text-warning" />
        {install === undefined
          ? 'The game’s files changed since the last run'
          : `Updated${install.version === undefined ? '' : ` to ${install.version}`} from ${install.archive}`}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {install === undefined ? 'Found' : 'Installed'}{' '}
        {formatMoment(update.detectedAt).toLowerCase()}. The new files are the originals now, and
        your translation still covers the lines that didn't change.
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Count label="Changed" value={update.changed} className="text-warning" />
        <Count label="New" value={update.added} className="text-info" />
        <Count label="Removed" value={update.removed} />
        <Count label="Unchanged · kept" value={update.unchanged + update.moved} />
      </div>
      {update.review === 0 ? null : (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockSimpleIcon />
          {update.review === 1
            ? '1 locked line changed in the original. It stays as you wrote it until you review it.'
            : `${update.review.toLocaleString('en-US')} locked lines changed in the original. They stay as you wrote them until you review them.`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {update.pending === 0 ? null : (
          <Button className="h-8 rounded-full px-4" disabled={disabled} onClick={onTranslate}>
            Translate {update.pending.toLocaleString('en-US')} lines
          </Button>
        )}
        <Button
          variant="secondary"
          className="h-8 rounded-full px-4"
          onClick={() => openChanges(gameId)}
        >
          See what changed
        </Button>
        {cost === undefined ? null : (
          <span className="ml-1.5 text-[13px] text-muted-foreground">{cost}</span>
        )}
        <span className="flex-1" />
        {install?.canUndo === true ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 font-normal text-muted-foreground"
            disabled={undoing || disabled}
            onClick={() => setConfirmingUndo(true)}
          >
            <ArrowCounterClockwiseIcon />
            {undoing ? 'Undoing…' : 'Undo the update'}
          </Button>
        ) : null}
      </div>
      {error === undefined ? null : <p className="mt-2 text-sm text-destructive">{error}</p>}
      <UndoUpdateDialog
        gameId={gameId}
        open={confirmingUndo}
        onOpenChange={setConfirmingUndo}
        onBusy={setUndoing}
        onError={setError}
      />
    </div>
  )
}
