import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { InGameTextSummary } from '#contract/InGameText'
import { type Game, isTranslatable } from '#contract/Library'
import { supportsLiveControls } from '#contract/LiveControls'
import { inGameTextReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { PicturesRow } from '../pictures/PicturesRow'
import { DialogueWrapRow } from './DialogueWrapRow'
import { inGameTextSummaryAtom } from './inGameText'
import { SwitchRow } from './SwitchRow'
import { useInGameTextSettings } from './useInGameTextSettings'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function Strings({ summary }: { readonly summary: InGameTextSummary }) {
  return (
    <>
      {plural(summary.strings, 'string')}
      {summary.tooLong === 0 ? null : (
        <>
          {' · '}
          <span className="text-warning">{summary.tooLong} too long</span>
        </>
      )}
    </>
  )
}

const menusDescription = (
  unavailable: string | undefined,
  summary: InGameTextSummary | undefined,
) => {
  if (unavailable !== undefined) {
    return `Unavailable: ${unavailable}`
  }

  if (summary === undefined || summary.strings === 0) {
    return 'Text switches to its translation the first time the game shows it.'
  }

  return <Strings summary={summary} />
}

export function InGameTextCard({ game }: { readonly game: Game }) {
  const summaryResult = useAtomValue(inGameTextSummaryAtom(game.id))
  const openReview = useAtomSet(inGameTextReviewAtom)
  const { settings, loaded, error, unavailable, change } = useInGameTextSettings(game.id)

  if (!supportsLiveControls(game.engine)) {
    return null
  }

  const summary = AsyncResult.isSuccess(summaryResult) ? summaryResult.value : undefined

  return (
    <section className="mt-4 rounded-3xl bg-card p-5 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight">Menus and pictures</h2>
      <p className="mt-1.5 mb-2 text-muted-foreground">
        Text the script translation can’t reach, translated in the running game.
      </p>

      <SwitchRow
        title="Translate menus and UI while playing"
        description={menusDescription(unavailable('inGameText'), summary)}
        checked={settings.uiText}
        disabled={!loaded}
        aside={
          summary === undefined || summary.strings === 0 ? null : (
            <Button
              variant="ghost"
              className="h-8 rounded-full px-3 text-[13px]"
              onClick={() => openReview(game.id)}
            >
              Review
            </Button>
          )
        }
        onCheckedChange={(uiText) => change({ uiText })}
      />
      <PicturesRow gameId={game.id} />
      {isTranslatable(game.engine) ? null : <DialogueWrapRow game={game} />}

      {summary?.notice === undefined ? null : (
        <p className="border-t pt-3 text-[13px] text-warning">{summary.notice}</p>
      )}

      {error === undefined ? null : (
        <p className="border-t pt-3 text-[13px] text-destructive">{error}</p>
      )}
    </section>
  )
}
