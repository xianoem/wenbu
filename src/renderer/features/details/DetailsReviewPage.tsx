import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowRightIcon,
  CaretLeftIcon,
  CheckIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import type { FindingProgress, FindState, ReviewItem } from '#contract/Details'
import type { Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { detailsReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { GameCover } from '../library/components/GameCover'
import { gamesAtom } from '../library/library'
import { JapanVpnNote } from './components/JapanVpnNote'
import { MatchPanel } from './components/MatchPanel'
import { ScoreBar } from './components/ScoreBar'
import {
  detailsKeys,
  findingAtom,
  linkWorkAtom,
  markNoDetailsAtom,
  pauseFindingAtom,
  reviewListAtom,
  runStateOf,
  startFindingAtom,
} from './details'

const stateLabels: Record<FindState, string> = {
  waiting: 'Waiting',
  linked: 'Linked',
  'needs-review': 'Needs review',
  'no-match': 'No match',
  'no-details': 'No details',
  failed: 'Failed',
}

const stateClasses: Record<FindState, string> = {
  waiting: 'bg-info/12 text-info',
  linked: 'bg-success/10 text-success',
  'needs-review': 'bg-warning/10 text-warning',
  'no-match': 'bg-muted text-muted-foreground',
  'no-details': 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/12 text-destructive',
}

const reviewOrder: Record<FindState, number> = {
  'needs-review': 0,
  'no-match': 1,
  failed: 2,
  waiting: 3,
  linked: 4,
  'no-details': 5,
}

function ProgressLine({ progress }: { readonly progress: FindingProgress }) {
  const share = progress.total === 0 ? 0 : (progress.linked / progress.total) * 100

  return (
    <div className="mt-3.5 flex items-center gap-3.5 text-xs">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
      </span>
      <span className="text-muted-foreground">
        {progress.linkedByCode} by code · {progress.linkedBySearch} by title
        {progress.running ? ` · ${progress.waiting} to go` : ''}
      </span>
    </div>
  )
}

function Compared({ item, game }: { readonly item: ReviewItem; readonly game: Game | undefined }) {
  const link = useAtomSet(linkWorkAtom, { mode: 'promiseExit' })
  const markNoDetails = useAtomSet(markNoDetailsAtom, { mode: 'promiseExit' })
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [searching, setSearching] = useState(false)
  const candidate = item.candidates[index % Math.max(1, item.candidates.length)]

  const linkCandidate = async () => {
    if (candidate === undefined) {
      return
    }

    const exit = await link({
      payload: { gameId: item.gameId, input: candidate.code },
      reactivityKeys: detailsKeys,
    })

    setError(Exit.isFailure(exit) ? formErrorOf(exit)?.message : undefined)
  }

  const noDetails = () =>
    markNoDetails({ payload: { gameId: item.gameId }, reactivityKeys: detailsKeys })

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (searching) {
        return
      }

      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'Enter') {
        void linkCandidate()
      }

      if (event.key === 'ArrowRight') {
        setIndex((current) => current + 1)
      }

      if (event.key.toLowerCase() === 'x') {
        void noDetails()
      }
    }

    window.addEventListener('keydown', press)

    return () => window.removeEventListener('keydown', press)
  })

  if (searching && game !== undefined) {
    return <MatchPanel game={game} className="mt-0" onClose={() => setSearching(false)} />
  }

  return (
    <section className="rounded-3xl bg-card px-[22px] py-5 shadow-card">
      <div className="flex items-center">
        <span
          className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', stateClasses[item.state])}
        >
          {stateLabels[item.state]}
        </span>
        <span className="flex-1" />
        {candidate === undefined ? null : <ScoreBar score={candidate.score} />}
      </div>

      <div className="mt-4 flex items-stretch gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">Your folder</div>
          {game === undefined ? null : (
            <GameCover game={game} className="mt-2 w-full rounded-[14px] p-3.5 text-[30px]" />
          )}
          <div className="mt-2.5 truncate font-semibold">{item.title}</div>
          <div className="truncate text-xs text-muted-foreground">{item.folderPath}</div>
        </div>
        <div className="grid place-items-center text-muted-foreground">
          <ArrowRightIcon />
        </div>
        <div className="min-w-0 flex-1">
          {candidate === undefined ? (
            <div className="flex h-full flex-col justify-center text-sm text-muted-foreground">
              {item.state === 'failed'
                ? (item.error ?? 'DLsite could not be reached.')
                : 'DLsite found nothing like this folder. Search with another title, or paste its code.'}
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                DLsite · {candidate.code}
                {item.candidates.length > 1
                  ? ` · ${(index % item.candidates.length) + 1} of ${item.candidates.length}`
                  : ''}
              </div>
              <div className="mt-2 aspect-4/3 overflow-hidden rounded-[14px] bg-muted">
                {candidate.coverUrl === null ? null : (
                  <img src={candidate.coverUrl} alt="" className="size-full object-cover" />
                )}
              </div>
              <div className="mt-2.5 truncate font-semibold">{candidate.title}</div>
              <div className="truncate text-xs text-muted-foreground">{candidate.circle}</div>
            </>
          )}
        </div>
      </div>

      {candidate === undefined ? null : (
        <ul className="mt-3.5">
          {candidate.reasons.map((reason) => (
            <li key={reason.text} className="flex items-center gap-2.5 border-t py-2 text-sm">
              {reason.agrees ? (
                <CheckIcon className="text-success" />
              ) : (
                <MinusIcon className="text-warning" />
              )}
              {reason.text}
            </li>
          ))}
        </ul>
      )}

      {error === undefined ? null : <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-3.5 flex items-center gap-2">
        {candidate === undefined ? null : (
          <Button className="rounded-full" onClick={() => void linkCandidate()}>
            <CheckIcon />
            Link
            <kbd className="rounded bg-black/10 px-1.5 text-[11px]">Enter</kbd>
          </Button>
        )}
        {item.candidates.length > 1 ? (
          <Button variant="secondary" className="rounded-full" onClick={() => setIndex(index + 1)}>
            Next candidate
            <kbd className="rounded bg-muted px-1.5 text-[11px]">→</kbd>
          </Button>
        ) : null}
        <Button variant="secondary" className="rounded-full" onClick={() => setSearching(true)}>
          Search…
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" className="rounded-full" onClick={() => void noDetails()}>
          No details
          <kbd className="rounded bg-muted px-1.5 text-[11px]">X</kbd>
        </Button>
      </div>
    </section>
  )
}

export function DetailsReviewPage() {
  const setReviewing = useAtomSet(detailsReviewAtom)
  const progressResult = useAtomValue(findingAtom)
  const gamesResult = useAtomValue(gamesAtom)
  const start = useAtomSet(startFindingAtom, { mode: 'promiseExit' })
  const pause = useAtomSet(pauseFindingAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const progress = AsyncResult.isSuccess(progressResult) ? progressResult.value : undefined
  const reviewResult = useAtomValue(reviewListAtom(runStateOf(progress)))
  const games = AsyncResult.isSuccess(gamesResult) ? gamesResult.value : []

  const items = (AsyncResult.isSuccess(reviewResult) ? reviewResult.value : []).toSorted(
    (a, b) => reviewOrder[a.state] - reviewOrder[b.state],
  )

  const queue = items.filter((item) => !skipped.has(item.gameId))
  const current = queue[0]

  const run = async () => {
    setError(undefined)

    const exit = await start({ payload: undefined, reactivityKeys: detailsKeys })

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message)
    }
  }

  const skip = () => {
    if (current !== undefined) {
      setSkipped(new Set([...skipped, current.gameId]))
    }
  }

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's' && !(event.target instanceof HTMLInputElement)) {
        skip()
      }
    }

    window.addEventListener('keydown', press)

    return () => window.removeEventListener('keydown', press)
  })

  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        className="h-7 w-fit gap-1 rounded-full px-2 text-sm text-muted-foreground"
        onClick={() => setReviewing(false)}
      >
        <CaretLeftIcon />
        Library
      </Button>
      <div className="mt-2 flex items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Details review</h1>
          <p className="mt-1 text-muted-foreground">
            {progress === undefined
              ? 'Details from DLsite for the games in your Library'
              : `${progress.linked} of ${progress.total} games linked to DLsite`}
          </p>
        </div>
        {progress?.running === true ? (
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={() => void pause({ payload: undefined })}
          >
            <PauseIcon weight="fill" />
            Pause
          </Button>
        ) : (
          <Button className="rounded-full" onClick={() => void run()}>
            <PlayIcon weight="fill" />
            {progress?.paused === true ? 'Resume' : 'Find details'}
          </Button>
        )}
      </div>

      {progress === undefined ? null : <ProgressLine progress={progress} />}
      {items.some((item) => item.state === 'no-match') ? (
        <JapanVpnNote className="mt-4">
          Outside Japan, DLsite leaves some games out of its search, so they find no match here. Set
          your VPN to Japan and run Find details again to find them.
        </JapanVpnNote>
      ) : null}
      {error === undefined ? null : <p className="mt-3 text-sm text-destructive">{error}</p>}

      {current === undefined ? (
        <p className="mt-8 text-muted-foreground">
          {progress?.running === true
            ? 'Games that need you appear here as the run reaches them.'
            : 'Nothing to review.'}
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_230px] gap-5">
          <div>
            <div className="mb-2 flex items-center text-xs text-muted-foreground">
              <span className="flex-1">1 of {queue.length} to review</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 rounded-full px-2 text-xs"
                onClick={skip}
              >
                Skip <kbd className="ml-1 rounded bg-muted px-1.5">S</kbd>
              </Button>
            </div>
            <Compared
              key={current.gameId}
              item={current}
              game={games.find((game) => game.id === current.gameId)}
            />
          </div>
          <div>
            <div className="text-[13px] font-medium text-muted-foreground">Up next</div>
            <ul className="mt-1.5">
              {queue.slice(1, 12).map((item) => (
                <li key={item.gameId} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      stateClasses[item.state],
                    )}
                  >
                    {item.candidates[0] === undefined
                      ? stateLabels[item.state]
                      : `${item.candidates[0].score}%`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
