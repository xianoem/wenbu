import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  GameControllerIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { engineLabels, type Game, isTranslatable } from '#contract/Library'
import { detailsReviewAtom, gameIdAtom, type LibraryView, libraryViewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { DetailsReviewPage } from '../details/DetailsReviewPage'
import { AddGameDialog } from './components/AddGameDialog'
import { GameCover } from './components/GameCover'
import { GamePage } from './GamePage'
import { formatDay, gamesAtom, launchGameAtom, lengthOf, libraryKeys } from './library'

type Status = 'translated' | 'partial' | 'original' | 'unsupported'

type Filter = 'all' | Exclude<Status, 'unsupported'>

const statusOf = (game: Game): Status =>
  isTranslatable(game.engine) ? game.translation : 'unsupported'

const statuses: Record<Status, { readonly label: string; readonly className: string }> = {
  translated: { label: 'Translated', className: 'bg-success/10 text-success' },
  partial: { label: 'Partly translated', className: 'bg-warning/10 text-warning' },
  original: { label: 'Not translated', className: 'bg-muted text-muted-foreground' },
  unsupported: { label: "Can't translate", className: 'bg-muted text-muted-foreground' },
}

const filters: ReadonlyArray<{ readonly id: Filter; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'translated', label: 'Translated' },
  { id: 'partial', label: 'Partly' },
  { id: 'original', label: 'Not translated' },
]

const shortEngine = (game: Game) => engineLabels[game.engine].replace('RPG Maker ', '')

const playedLabel = (game: Game) => {
  if (game.lastPlayedAt === undefined) {
    return 'Not played'
  }

  const day = formatDay(game.lastPlayedAt)

  return `Played ${/^[A-Z][a-z]{2} \d/.test(day) ? day : day.toLowerCase()}`
}

const byRecency = (left: Game, right: Game) =>
  (right.lastPlayedAt ?? '').localeCompare(left.lastPlayedAt ?? '') ||
  left.title.localeCompare(right.title)

function StatusPill({ game }: { readonly game: Game }) {
  const status = statuses[statusOf(game)]

  return (
    <span
      className={cn(
        'inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        status.className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {status.label}
    </span>
  )
}

function PlayButton({ game, className }: { readonly game: Game; readonly className?: string }) {
  const launch = useAtomSet(launchGameAtom)

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Play ${game.title}`}
      className={cn(
        'size-9 rounded-full text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground hover:bg-primary/90',
        className,
      )}
      onClick={() => launch({ payload: { id: game.id }, reactivityKeys: libraryKeys })}
    >
      <PlayIcon weight="fill" />
    </Button>
  )
}

function GameRow({ game, onOpen }: { readonly game: Game; readonly onOpen: () => void }) {
  const length = lengthOf(game.text)

  return (
    <li className="group relative">
      <Button
        variant="ghost"
        aria-label={`Open ${game.title}`}
        onClick={onOpen}
        className="grid h-auto w-full grid-cols-[64px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_150px_40px] items-center gap-3.5 rounded-2xl px-2.5 py-2 text-left font-normal hover:bg-muted/50"
      >
        <GameCover game={game} className="h-11 w-16 rounded-[10px] px-2 py-1 text-[15px]" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{game.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[shortEngine(game), game.text?.language].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-[13px] text-muted-foreground">
          {length === undefined ? '—' : `${length.reading} story`}
        </span>
        <span className="text-[13px] text-muted-foreground">{playedLabel(game)}</span>
        <StatusPill game={game} />
      </Button>
      <PlayButton game={game} className="absolute top-1/2 right-2.5 -translate-y-1/2" />
    </li>
  )
}

function GameTile({ game, onOpen }: { readonly game: Game; readonly onOpen: () => void }) {
  return (
    <div className="group relative">
      <Button
        variant="ghost"
        aria-label={`Open ${game.title}`}
        onClick={onOpen}
        className="h-auto w-full flex-col items-stretch gap-0 rounded-3xl bg-card p-2.5 text-left font-normal shadow-card hover:bg-card"
      >
        <GameCover game={game} />
        <span className="mt-2.5 truncate px-1 font-semibold">{game.title}</span>
        <span className="mb-2 truncate px-1 text-xs text-muted-foreground">
          {[shortEngine(game), lengthOf(game.text)?.reading].filter(Boolean).join(' · ')}
        </span>
        <span className="px-1 pb-1">
          <StatusPill game={game} />
        </span>
      </Button>
      <PlayButton
        game={game}
        className="absolute top-4 right-4 bg-black/30 text-white opacity-0 group-hover:opacity-100"
      />
    </div>
  )
}

function EmptyLibrary({ onAdd }: { readonly onAdd: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-2.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <GameControllerIcon className="size-6" />
      </div>
      <p className="mt-1 text-base font-semibold">Your library is empty</p>
      <p className="max-w-sm text-muted-foreground">
        Add a game folder. Wenbu finds the game, measures its story and translates RPG Maker games.
      </p>
      <Button variant="outline" className="mt-1.5 rounded-full" onClick={onAdd}>
        <PlusIcon />
        Add game
      </Button>
    </div>
  )
}

function Games({
  games,
  query,
  view,
}: {
  readonly games: ReadonlyArray<Game>
  readonly query: string
  readonly view: LibraryView
}) {
  const setGameId = useAtomSet(gameIdAtom)
  const [filter, setFilter] = useState<Filter>('all')

  const needle = query.trim().toLocaleLowerCase()
  const searched = games.filter((game) => game.title.toLocaleLowerCase().includes(needle))

  const countOf = (id: Filter) =>
    id === 'all' ? searched.length : searched.filter((game) => statusOf(game) === id).length

  const shown = searched
    .filter((game) => filter === 'all' || statusOf(game) === filter)
    .toSorted(byRecency)

  return (
    <>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {filters.map(({ id, label }) => (
          <Button
            key={id}
            variant={filter === id ? 'default' : 'secondary'}
            aria-pressed={filter === id}
            className="h-7 rounded-full px-3.5 text-[13px] font-normal"
            onClick={() => setFilter(id)}
          >
            {label} <span className="opacity-60">{countOf(id)}</span>
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 text-muted-foreground">No games match.</p>
      ) : view === 'list' ? (
        <ul className="mt-3.5 rounded-3xl bg-card p-1.5 shadow-card">
          {shown.map((game) => (
            <GameRow key={game.id} game={game} onOpen={() => setGameId(game.id)} />
          ))}
        </ul>
      ) : (
        <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
          {shown.map((game) => (
            <GameTile key={game.id} game={game} onOpen={() => setGameId(game.id)} />
          ))}
        </div>
      )}
    </>
  )
}

function ViewSwitch() {
  const [view, setView] = useAtom(libraryViewAtom)

  return (
    <div className="inline-flex rounded-full bg-muted/60 p-[3px]">
      {(['grid', 'list'] as const).map((option) => (
        <Button
          key={option}
          variant="ghost"
          aria-pressed={view === option}
          className={cn(
            'h-7 rounded-full px-3.5 text-[13px] font-normal text-muted-foreground',
            view === option && 'bg-background font-medium text-foreground shadow-card',
          )}
          onClick={() => setView(option)}
        >
          {option === 'grid' ? 'Grid' : 'List'}
        </Button>
      ))}
    </div>
  )
}

export function LibraryPage() {
  const result = useAtomValue(gamesAtom)
  const view = useAtomValue(libraryViewAtom)
  const [gameId, setGameId] = useAtom(gameIdAtom)
  const [reviewing, setReviewing] = useAtom(detailsReviewAtom)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const games = AsyncResult.isSuccess(result) ? result.value : undefined
  const game = games?.find((candidate) => candidate.id === gameId)

  if (game !== undefined) {
    return <GamePage game={game} />
  }

  if (reviewing) {
    return <DetailsReviewPage />
  }

  const hasGames = games !== undefined && games.length > 0

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5">
        <h1 className="flex-1 text-[28px] font-semibold tracking-tight">Library</h1>
        {hasGames ? (
          <>
            <ViewSwitch />
            <Button
              variant="secondary"
              className="h-9 rounded-full px-4"
              onClick={() => setReviewing(true)}
            >
              <SparkleIcon />
              Find details
            </Button>
            <InputGroup className="h-9 w-56 rounded-full">
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search games"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <Button className="h-9 rounded-full px-4" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add game
            </Button>
          </>
        ) : null}
      </div>

      {games === undefined ? null : hasGames ? (
        <Games games={games} query={query} view={view} />
      ) : (
        <EmptyLibrary onAdd={() => setAdding(true)} />
      )}

      {adding ? (
        <AddGameDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false)
            setGameId(id)
          }}
        />
      ) : null}
    </div>
  )
}
