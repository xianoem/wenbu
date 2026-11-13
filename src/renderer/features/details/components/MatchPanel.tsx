import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  CheckIcon,
  GlobeHemisphereEastIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { MatchCandidate } from '#contract/Details'
import type { Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { Spinner } from '#ui/spinner'
import {
  detailsErrorOf,
  detailsKeys,
  findMatchesAtom,
  formatReleaseDate,
  initialMatchesAtom,
  linkWorkAtom,
  looksLikeCode,
  markNoDetailsAtom,
} from '../details'
import { JapanVpnNote } from './JapanVpnNote'
import { ScoreBar } from './ScoreBar'

const shownReasons = 2

function CandidateRow({
  candidate,
  best,
  linking,
  onLink,
}: {
  readonly candidate: MatchCandidate
  readonly best: boolean
  readonly linking: boolean
  readonly onLink: () => void
}) {
  const facts = [
    candidate.circle,
    candidate.releasedOn === null ? undefined : formatReleaseDate(candidate.releasedOn),
    candidate.code,
  ].filter(Boolean)

  return (
    <li className={cn('flex items-center gap-3.5 rounded-2xl p-2.5', best && 'bg-muted/60')}>
      <span className="block aspect-4/3 w-24 shrink-0 overflow-hidden rounded-[10px] bg-muted">
        {candidate.coverUrl === null ? null : (
          <img src={candidate.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{candidate.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{facts.join(' · ')}</div>
        <div className="mt-1.5 flex gap-3 overflow-hidden">
          {candidate.reasons.slice(0, shownReasons).map((reason) => (
            <span
              key={reason.text}
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            >
              {reason.agrees ? (
                <CheckIcon className="size-3 text-success" />
              ) : (
                <MinusIcon className="size-3 text-warning" />
              )}
              {reason.text}
            </span>
          ))}
        </div>
      </div>
      <ScoreBar score={candidate.score} />
      <Button
        size="sm"
        variant={best ? 'default' : 'secondary'}
        className="rounded-full"
        disabled={linking}
        onClick={onLink}
      >
        {linking ? <Spinner /> : <LinkSimpleIcon />}
        Link
      </Button>
    </li>
  )
}

function NothingFound({ searchedFor }: { readonly searchedFor: string | undefined }) {
  return (
    <div className="mt-2">
      <div className="px-4 pt-5 pb-3 text-center">
        <div className="font-semibold">
          {searchedFor === undefined
            ? 'DLsite found nothing like this folder'
            : `DLsite found nothing for “${searchedFor}”`}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Try fewer words or the Japanese title, or paste the game’s code or link.
        </div>
      </div>
      <JapanVpnNote>
        DLsite hides many games from visitors outside Japan, so they don’t show up in searches. Set
        your VPN to Japan, then search again.
      </JapanVpnNote>
    </div>
  )
}

export function MatchPanel({
  game,
  className,
  onClose,
}: {
  readonly game: Game
  readonly className?: string
  readonly onClose: () => void
}) {
  const initial = useAtomValue(initialMatchesAtom(game.id))
  const find = useAtomSet(findMatchesAtom, { mode: 'promiseExit' })
  const link = useAtomSet(linkWorkAtom, { mode: 'promiseExit' })
  const markNoDetails = useAtomSet(markNoDetailsAtom, { mode: 'promiseExit' })
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState<ReadonlyArray<MatchCandidate> | undefined>(undefined)
  const [searchedFor, setSearchedFor] = useState<string | undefined>(undefined)
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const initialError = AsyncResult.isFailure(initial) ? detailsErrorOf(initial.cause) : undefined

  const candidates = searched ?? (AsyncResult.isSuccess(initial) ? initial.value : undefined)

  const loading = searching || (searched === undefined && AsyncResult.isInitial(initial))
  const shownError = error ?? initialError?.message

  const search = async (text: string) => {
    setSearching(true)
    setError(undefined)

    const exit = await find({
      payload: { gameId: game.id, ...(text === '' ? {} : { query: text }) },
    })

    setSearching(false)
    setSearchedFor(text === '' ? undefined : text)

    if (Exit.isSuccess(exit)) {
      return setSearched(exit.value)
    }

    setSearched([])
    setError(formErrorOf(exit)?.message)
  }

  const linkWith = async (input: string) => {
    setLinking(input)
    setError(undefined)

    const exit = await link({
      payload: { gameId: game.id, input },
      reactivityKeys: detailsKeys,
    })

    setLinking(undefined)

    if (Exit.isSuccess(exit)) {
      return onClose()
    }

    setError(formErrorOf(exit)?.message)
  }

  const noDetails = async () => {
    await markNoDetails({ payload: { gameId: game.id }, reactivityKeys: detailsKeys })
    onClose()
  }

  const submit = (text: string) => {
    if (looksLikeCode(text)) {
      return void linkWith(text)
    }

    void search(text)
  }

  return (
    <section className={cn('mt-5 rounded-3xl bg-card px-[22px] py-5 shadow-card', className)}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Find details on DLsite</h2>
          <p className="truncate text-xs text-muted-foreground">{game.folderPath}</p>
        </div>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void noDetails()}>
          No details
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          className="rounded-full"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>

      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit(query.trim())
        }}
      >
        <InputGroup className="h-9 rounded-full">
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search DLsite, or paste a code or link"
            placeholder={`Search DLsite for “${game.title}”, or paste a code or link: RJ…, https://www.dlsite.com/…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {linking === undefined || !looksLikeCode(linking) ? null : (
            <InputGroupAddon align="inline-end">
              <Spinner />
            </InputGroupAddon>
          )}
        </InputGroup>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-6 text-sm text-muted-foreground">
          <Spinner /> Searching DLsite…
        </div>
      ) : null}
      {!loading && candidates?.length === 0 ? <NothingFound searchedFor={searchedFor} /> : null}
      {!loading && candidates !== undefined && candidates.length > 0 ? (
        <>
          <ul className="mt-2.5 flex flex-col gap-0.5">
            {candidates.map((candidate, at) => (
              <CandidateRow
                key={candidate.code}
                candidate={candidate}
                best={at === 0}
                linking={linking === candidate.code}
                onLink={() => void linkWith(candidate.code)}
              />
            ))}
          </ul>
          <p className="mt-2.5 flex items-center gap-1.5 px-2.5 text-xs text-muted-foreground">
            <GlobeHemisphereEastIcon className="shrink-0 text-info" />
            Not seeing the game? DLsite hides many games outside Japan. Set your VPN to Japan and
            search again.
          </p>
        </>
      ) : null}

      {shownError === undefined ? null : (
        <p className="mt-3 px-2.5 text-sm text-destructive">{shownError}</p>
      )}
    </section>
  )
}
