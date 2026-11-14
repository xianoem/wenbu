import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { PicturesSummary } from '#contract/Pictures'
import { pictureReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { findPictureTextAtom, picturesSummaryAtom } from './pictures'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const describe = (summary: PicturesSummary | undefined) => {
  if (summary?.scan !== undefined) {
    return `Reading pictures · ${summary.scan.done} of ${summary.scan.total}`
  }

  if (summary === undefined || summary.scanned === 0) {
    return 'Title screens, menus and labels drawn into the game’s pictures. You review each one before the game shows it.'
  }

  if (summary.withText === 0) {
    return `No text found in ${plural(summary.scanned, 'picture')}`
  }

  return `${summary.withText} of ${plural(summary.scanned, 'picture')} have text · ${summary.approved} approved`
}

export function PicturesRow({ gameId }: { readonly gameId: string }) {
  const result = useAtomValue(picturesSummaryAtom(gameId))
  const open = useAtomSet(pictureReviewAtom)
  const find = useAtomSet(findPictureTextAtom)
  const summary = AsyncResult.isSuccess(result) ? result.value : undefined
  const scanned = summary !== undefined && summary.scanned > 0

  return (
    <div className="flex items-center gap-3 border-t py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">Translate text in pictures</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{describe(summary)}</p>
      </div>
      <Button
        variant="outline"
        className="h-8 rounded-full px-4"
        onClick={() => {
          if (!scanned && summary?.scan === undefined) {
            find({ payload: { gameId } })
          }

          open({ gameId })
        }}
      >
        {scanned ? 'Review' : 'Find text'}
      </Button>
    </div>
  )
}
