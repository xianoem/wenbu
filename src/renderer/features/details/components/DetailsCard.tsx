import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  InfoIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  StarIcon,
  SwapIcon,
  TranslateIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type ReactNode, useState } from 'react'
import type { GameDetails } from '#contract/Details'
import type { Game } from '#contract/Library'
import { formatDay } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'
import {
  detailsKeys,
  formatReleaseDate,
  gameDetailsAtom,
  linkedByLabel,
  refreshDetailsAtom,
  translateDetailsAtom,
  workTypeLabel,
} from '../details'
import { EditDetailsDialog } from './EditDetailsDialog'
import { JapanVpnNote } from './JapanVpnNote'
import { MatchPanel } from './MatchPanel'

const shownGenres = 6

const shownSamples = 5

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{children}</div>
    </div>
  )
}

function FooterAction({
  Icon,
  label,
  busy = false,
  onClick,
}: {
  readonly Icon: typeof InfoIcon
  readonly label: string
  readonly busy?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 rounded-full px-2 text-xs"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Spinner /> : <Icon />}
      {label}
    </Button>
  )
}

function LinkedCard({
  game,
  details,
  onChange,
}: {
  readonly game: Game
  readonly details: GameDetails
  readonly onChange: () => void
}) {
  const refresh = useAtomSet(refreshDetailsAtom, { mode: 'promiseExit' })
  const translate = useAtomSet(translateDetailsAtom, { mode: 'promiseExit' })
  const [showOriginal, setShowOriginal] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [allGenres, setAllGenres] = useState(false)
  const [busy, setBusy] = useState<'refresh' | 'translate' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const translated = details.translatedDescription !== null && !showOriginal
  const description = translated ? details.translatedDescription : details.description
  const genres = allGenres ? details.genres : details.genres.slice(0, shownGenres)

  const run = async (kind: 'refresh' | 'translate') => {
    setBusy(kind)
    setError(undefined)

    const call = kind === 'refresh' ? refresh : translate
    const exit = await call({ payload: { gameId: game.id }, reactivityKeys: detailsKeys })

    setBusy(undefined)

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message)
    }
  }

  const translation = () => {
    if (details.translatedDescription === null) {
      return void run('translate')
    }

    setShowOriginal(!showOriginal)
  }

  const translationLabel = () => {
    if (details.translatedDescription === null) {
      return 'Translate'
    }

    return showOriginal ? 'Show translation' : 'Show original'
  }

  return (
    <section className="mt-5 rounded-3xl bg-card px-[22px] py-5 shadow-card">
      {details.restricted ? (
        <JapanVpnNote className="mb-4">
          DLsite shows only part of this game outside Japan. For its genres, release date, rating
          and samples, set your VPN to Japan, then Refresh.
        </JapanVpnNote>
      ) : null}
      <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr] gap-4 text-sm">
        <Fact label="Circle">{details.circle}</Fact>
        <Fact label="Released">
          {details.releasedOn === '' ? '—' : formatReleaseDate(details.releasedOn)}
        </Fact>
        <Fact label="Type">{details.workType === '' ? '—' : workTypeLabel(details.workType)}</Fact>
        <Fact label="Rating">
          {details.rating === null ? (
            '—'
          ) : (
            <span className="inline-flex items-center gap-1">
              <StarIcon weight="fill" className="size-3.5" />
              {details.rating.toFixed(2)}
              {details.ratingCount === null ? null : (
                <span className="text-muted-foreground">
                  · {details.ratingCount.toLocaleString('en-US')}
                </span>
              )}
            </span>
          )}
        </Fact>
        <Fact label="Source">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-info" />
            DLsite
          </span>
        </Fact>
      </div>

      <div className="my-4 h-px bg-border" />

      {details.translatedTitle !== null && !showOriginal ? (
        <p className="mb-1.5 text-sm font-semibold">{details.translatedTitle}</p>
      ) : null}
      {description === '' ? null : (
        <p
          className={cn('text-sm leading-relaxed text-foreground/90', !expanded && 'line-clamp-2')}
        >
          {description}
        </p>
      )}
      {description !== null && description.length > 180 ? (
        <Button
          variant="link"
          className="h-auto p-0 text-xs text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Less' : 'More'}
        </Button>
      ) : null}

      {details.genres.length === 0 ? null : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {genres.map((genre) => (
            <span key={genre.id} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              {genre.name}
            </span>
          ))}
          {details.genres.length > shownGenres ? (
            <Button
              variant="ghost"
              className="h-auto rounded-full bg-secondary/60 px-2.5 py-0.5 text-xs font-normal text-muted-foreground"
              onClick={() => setAllGenres(!allGenres)}
            >
              {allGenres ? 'Fewer' : `${details.genres.length - shownGenres} more`}
            </Button>
          ) : null}
        </div>
      )}

      {details.samples.length === 0 ? null : (
        <div className="mt-4 flex gap-3 overflow-hidden">
          {details.samples.slice(0, shownSamples).map((sample) => (
            <Button
              key={sample}
              variant="ghost"
              aria-label="Open the sample on DLsite"
              className="aspect-4/3 h-auto w-[118px] shrink-0 overflow-hidden rounded-[10px] bg-muted p-0"
              onClick={() => window.wenbu.openExternal(details.url)}
            >
              <img src={sample} alt="" loading="lazy" className="size-full object-cover" />
            </Button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <LinkSimpleIcon className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          DLsite {details.link.code} · {linkedByLabel[details.link.linkedBy]} · fetched{' '}
          {formatDay(details.fetchedAt).toLowerCase()}
        </span>
        <FooterAction
          Icon={TranslateIcon}
          label={translationLabel()}
          busy={busy === 'translate'}
          onClick={translation}
        />
        <FooterAction
          Icon={ArrowsClockwiseIcon}
          label="Refresh"
          busy={busy === 'refresh'}
          onClick={() => void run('refresh')}
        />
        <FooterAction
          Icon={ArrowSquareOutIcon}
          label="Open on DLsite"
          onClick={() => window.wenbu.openExternal(details.url)}
        />
        <FooterAction Icon={SwapIcon} label="Change" onClick={onChange} />
        <FooterAction Icon={PencilSimpleIcon} label="Edit" onClick={() => setEditing(true)} />
      </div>
      {error === undefined ? null : <p className="mt-2 text-sm text-destructive">{error}</p>}

      {editing ? <EditDetailsDialog details={details} onClose={() => setEditing(false)} /> : null}
    </section>
  )
}

function NoDetailsCard({ onFind }: { readonly onFind: () => void }) {
  return (
    <section className="mt-5 flex items-center gap-2.5 rounded-3xl bg-card px-[22px] py-4 shadow-card">
      <InfoIcon className="text-muted-foreground" />
      <span className="flex-1 text-sm">No details yet</span>
      <Button size="sm" className="rounded-full" onClick={onFind}>
        <MagnifyingGlassIcon />
        Find details
      </Button>
    </section>
  )
}

export function DetailsCard({ game }: { readonly game: Game }) {
  const result = useAtomValue(gameDetailsAtom(game.id))
  const [matching, setMatching] = useState(false)

  if (!AsyncResult.isSuccess(result)) {
    return null
  }

  if (matching) {
    return <MatchPanel game={game} onClose={() => setMatching(false)} />
  }

  return result.value === null ? (
    <NoDetailsCard onFind={() => setMatching(true)} />
  ) : (
    <LinkedCard game={game} details={result.value} onChange={() => setMatching(true)} />
  )
}
