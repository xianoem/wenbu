import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { UsersThreeIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { GameGlossary, GlossaryEstimate } from '#contract/GameGlossary'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'
import { Switch } from '#ui/switch'
import { offPreparedSummary, offSummary, readySummary, unpreparedSummary } from '../glossaryText'
import {
  gameGlossaryAtom,
  glossaryKeys,
  prepareGameGlossaryAtom,
  setGameGlossaryEnabledAtom,
  translationKeys,
} from '../library'
import { GameGlossarySheet } from './GameGlossarySheet'

const avatarColors = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3']

const refreshKeys = [...glossaryKeys, ...translationKeys]

const summaryOf = (
  glossary: GameGlossary,
  estimate: GlossaryEstimate | undefined,
  preparing: boolean,
) => {
  if (preparing) {
    return 'Reading the game and preparing the glossary. This takes a minute or two.'
  }

  if (glossary.preparedAt === undefined) {
    return glossary.enabled ? unpreparedSummary(estimate) : offSummary(estimate)
  }

  return glossary.enabled
    ? readySummary(glossary, estimate)
    : offPreparedSummary(glossary, estimate)
}

function Badge({ glossary }: { readonly glossary: GameGlossary }) {
  const characters = glossary.entries.filter((entry) => entry.kind === 'character').slice(0, 3)

  if (glossary.preparedAt === undefined || characters.length === 0) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UsersThreeIcon />
      </span>
    )
  }

  return (
    <span className="flex shrink-0 -space-x-2" aria-hidden>
      {characters.map((character, index) => (
        <span
          key={character.id}
          className={cn(
            'flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-card',
            avatarColors[index] ?? 'bg-muted',
          )}
        >
          {character.translation.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  )
}

export function GameGlossaryRow({
  gameId,
  title,
  estimate,
  disabled,
}: {
  readonly gameId: string
  readonly title: string
  readonly estimate: GlossaryEstimate | undefined
  readonly disabled: boolean
}) {
  const result = useAtomValue(gameGlossaryAtom(gameId))
  const setEnabled = useAtomSet(setGameGlossaryEnabledAtom)
  const prepare = useAtomSet(prepareGameGlossaryAtom, { mode: 'promiseExit' })
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [reviewing, setReviewing] = useState(false)

  if (!AsyncResult.isSuccess(result)) {
    return null
  }

  const glossary = result.value
  const prepared = glossary.preparedAt !== undefined

  const runPrepare = async () => {
    setPreparing(true)
    setError(undefined)

    const exit = await prepare({ payload: { gameId }, reactivityKeys: refreshKeys })

    setPreparing(false)

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message ?? 'The glossary could not be prepared. Try again.')
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-muted/40 px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Badge glossary={glossary} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">Game glossary</span>
          <span className="text-[13px] text-muted-foreground">
            {summaryOf(glossary, estimate, preparing)}
          </span>
        </div>
        {preparing ? <Spinner className="size-4 text-muted-foreground" /> : null}
        {prepared && !preparing ? (
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3 font-normal"
            onClick={() => setReviewing(true)}
          >
            Review
          </Button>
        ) : null}
        {!prepared && glossary.enabled && !preparing ? (
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3 font-normal"
            disabled={disabled}
            onClick={() => void runPrepare()}
          >
            Prepare now
          </Button>
        ) : null}
        <Switch
          className="ml-1"
          aria-label="Use the game glossary"
          checked={glossary.enabled}
          disabled={disabled || preparing}
          onCheckedChange={(enabled) =>
            setEnabled({ payload: { gameId, enabled }, reactivityKeys: refreshKeys })
          }
        />
      </div>
      {error === undefined ? null : <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      {prepared ? (
        <GameGlossarySheet
          title={title}
          glossary={glossary}
          estimate={estimate}
          open={reviewing}
          busy={disabled || preparing}
          onOpenChange={setReviewing}
          onPrepareAgain={() => void runPrepare()}
        />
      ) : null}
    </div>
  )
}
