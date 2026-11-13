import { useAtomValue } from '@effect/atom-react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import type { Game } from '#contract/Library'
import { pageImageUrl } from '#contract/PageImage'
import { gameSummariesAtom } from '../../details/details'
import { initialOf, tintOf } from '../library'

const tintClasses = {
  violet: 'bg-tint-violet text-tint-violet-foreground',
  teal: 'bg-tint-teal text-tint-teal-foreground',
  amber: 'bg-tint-amber text-tint-amber-foreground',
  slate: 'bg-tint-slate text-tint-slate-foreground',
}

export const useGameCover = (gameId: string) => {
  const summaries = useAtomValue(gameSummariesAtom)

  return AsyncResult.isSuccess(summaries)
    ? (summaries.value.find((summary) => summary.gameId === gameId)?.cover ?? undefined)
    : undefined
}

export function GameCover({
  game,
  className,
}: {
  readonly game: Pick<Game, 'id' | 'title'>
  readonly className?: string
}) {
  const cover = useGameCover(game.id)

  if (cover !== undefined) {
    return (
      <img
        src={pageImageUrl(cover, 0)}
        alt=""
        className={cn('aspect-4/3 rounded-[10px] bg-muted object-cover', className)}
      />
    )
  }

  return (
    <div
      aria-hidden
      className={cn(
        'flex aspect-4/3 items-end rounded-[10px] px-3 py-2.5 text-[22px] font-semibold',
        tintClasses[tintOf(game)],
        className,
      )}
    >
      {initialOf(game.title)}
    </div>
  )
}
