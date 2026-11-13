import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowCircleUpIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  DotsThreeIcon,
  FolderOpenIcon,
  ImagesIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { engineLabels, type Game, isTranslatable } from '#contract/Library'
import { pageImageUrl } from '#contract/PageImage'
import { formErrorOf } from '#lib/forms'
import {
  gameIdAtom,
  inGameTextReviewAtom,
  sourceChangesAtom,
  translationReviewAtom,
} from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { DetailsCard } from '../details/components/DetailsCard'
import { InGameTextCard } from '../ingametext/InGameTextCard'
import { InGameTextReviewPage } from '../ingametext/InGameTextReviewPage'
import { LaunchWithOverlayButton } from '../overlay/components/LaunchWithOverlayButton'
import { LiveControlsPill } from './components/LiveControlsPill'
import { LocalePill } from './components/LocalePill'
import { CgPackDialog } from './components/CgPackDialog'
import { EditGameDialog } from './components/EditGameDialog'
import { GameCover, useGameCover } from './components/GameCover'
import { RemoveGameDialog } from './components/RemoveGameDialog'
import { TranslationPanel } from './components/TranslationPanel'
import { GameUpdateCard } from '../translation/GameUpdateCard'
import { gameUpdateAtom } from '../translation/translationLines'
import { UndoUpdateDialog } from '../translation/UndoUpdateDialog'
import { SourceChangesPage } from '../translation/SourceChangesPage'
import { TranslationReviewPage } from '../translation/TranslationReviewPage'
import { formatDay, formatDuration, launchGameAtom, lengthOf, libraryKeys, tintOf } from './library'

type Dialog = 'edit' | 'cg-pack' | 'remove'

const bannerHues = { violet: 286, teal: 185, amber: 50, slate: 260 }

const bannerOf = (game: Game) => {
  const tint = tintOf(game)
  const hue = bannerHues[tint]
  const chroma = tint === 'slate' ? 0.02 : 0.07

  return `linear-gradient(120deg, oklch(0.4 ${chroma} ${hue}), oklch(0.24 ${chroma / 2} ${hue - 30}))`
}

const factsOf = (game: Game) => {
  const length = lengthOf(game.text)

  const story =
    length === undefined || game.text === undefined
      ? undefined
      : `${length.size} story, ${length.reading} of ${game.text.language} dialogue`

  const lastPlayed = formatDay(game.lastPlayedAt).toLowerCase()

  const played =
    game.lastPlayedAt === undefined
      ? 'Not played yet'
      : game.playSeconds < 60
        ? `Last played ${lastPlayed}`
        : `Played ${formatDuration(game.playSeconds)}, last ${lastPlayed}`

  return [engineLabels[game.engine], story, played].filter((fact) => fact !== undefined)
}

const onBanner =
  'h-10 rounded-full border-0 bg-white/12 px-4 text-white hover:bg-white/20 hover:text-white'

export function GamePage({ game }: { readonly game: Game }) {
  const setGameId = useAtomSet(gameIdAtom)
  const reviewing = useAtomValue(inGameTextReviewAtom) === game.id
  const reviewingLines = useAtomValue(translationReviewAtom) === game.id
  const readingChanges = useAtomValue(sourceChangesAtom) === game.id
  const launch = useAtomSet(launchGameAtom, { mode: 'promiseExit' })
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [launchError, setLaunchError] = useState<string | undefined>(undefined)
  const translatable = isTranslatable(game.engine)
  const [updateArchive, setUpdateArchive] = useState<string | undefined>(undefined)
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | undefined>(undefined)
  const updateResult = useAtomValue(gameUpdateAtom(game.id))
  const cover = useGameCover(game.id)

  const undoable =
    AsyncResult.isSuccess(updateResult) &&
    Option.isSome(updateResult.value) &&
    updateResult.value.value.install?.canUndo === true
      ? updateResult.value.value.install
      : undefined

  const chooseUpdate = async () => {
    const archive = await window.wenbu.chooseArchive()

    if (archive !== undefined) {
      setUpdateArchive(archive)
    }
  }

  const play = async () => {
    setLaunchError(undefined)

    const exit = await launch({ payload: { id: game.id }, reactivityKeys: libraryKeys })

    if (Exit.isFailure(exit)) {
      setLaunchError(formErrorOf(exit)?.message)
    }
  }

  if (readingChanges) {
    return <SourceChangesPage game={game} />
  }

  if (reviewingLines) {
    return <TranslationReviewPage game={game} />
  }

  if (reviewing) {
    return <InGameTextReviewPage game={game} />
  }

  return (
    <div
      className="relative flex flex-col"
      onDragOver={(event) => {
        if (translatable && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files[0]

        if (translatable && file !== undefined && /\.zip$/i.test(file.name)) {
          event.preventDefault()
          setUpdateArchive(window.wenbu.pathForFile(file))
        }
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-7 left-1/2 h-[168px] w-screen -translate-x-1/2 overflow-hidden"
        style={cover === undefined ? { background: bannerOf(game) } : undefined}
      >
        {cover === undefined ? null : (
          <>
            <img
              src={pageImageUrl(cover, 0)}
              alt=""
              className="absolute -inset-10 size-[calc(100%+80px)] max-w-none object-cover opacity-80 blur-[30px] saturate-[1.15]"
            />
            <div className="absolute inset-0 bg-linear-to-b from-transparent from-15% to-background" />
          </>
        )}
      </div>

      {/* Above the cover row, which overlaps the banner's bottom edge and would take its clicks. */}
      <div className="relative z-10 flex h-[140px] flex-col justify-between pb-[18px]">
        <Button
          variant="ghost"
          className="h-8 w-fit gap-1.5 rounded-full bg-black/25 px-3 text-white hover:bg-black/35 hover:text-white"
          onClick={() => setGameId(undefined)}
        >
          <ArrowLeftIcon />
          Library
        </Button>

        <div className="flex justify-end gap-2">
          <Button
            className="h-10 w-[150px] rounded-full bg-white text-zinc-900 hover:bg-white/90"
            onClick={() => void play()}
          >
            <PlayIcon weight="fill" />
            Play
          </Button>
          <LaunchWithOverlayButton game={game} className={onBanner} onError={setLaunchError} />
          <LocalePill game={game} className={onBanner} onError={setLaunchError} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className={`${onBanner} w-10 px-0`}
                  aria-label="More actions"
                >
                  <DotsThreeIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => setDialog('edit')}>
                <PencilSimpleIcon />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.wenbu.revealPath(game.executablePath)}>
                <FolderOpenIcon />
                Show in Explorer
              </DropdownMenuItem>
              {translatable ? (
                <DropdownMenuItem onClick={() => void chooseUpdate()}>
                  <ArrowCircleUpIcon />
                  Update the game…
                </DropdownMenuItem>
              ) : null}
              {undoable === undefined ? null : (
                <DropdownMenuItem onClick={() => setUndoing(true)}>
                  <ArrowCounterClockwiseIcon />
                  {undoable.version === undefined
                    ? 'Undo the update'
                    : `Undo the update to ${undoable.version}`}
                </DropdownMenuItem>
              )}
              {translatable ? (
                <DropdownMenuItem onClick={() => setDialog('cg-pack')}>
                  <ImagesIcon />
                  Create CG pack
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('remove')}>
                <TrashIcon />
                Remove from library
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative -mt-[52px] flex items-end gap-[22px] px-1">
        <GameCover
          game={game}
          className={
            cover === undefined
              ? 'aspect-square w-[132px] shrink-0 rounded-[22px] p-3.5 text-[26px] ring-[5px] ring-background'
              : 'w-[176px] shrink-0 rounded-[20px] ring-[5px] ring-background'
          }
        />
        <div className="min-w-0 flex-1 pb-1.5">
          <h1 className="truncate text-[30px] leading-tight font-semibold tracking-tight">
            {game.title}
          </h1>
          <p className="mt-1.5 text-muted-foreground">{factsOf(game).join('  ·  ')}</p>
        </div>
      </div>

      <div className="mt-4 empty:hidden">
        <LiveControlsPill game={game} withHotkey />
      </div>

      {launchError === undefined ? null : (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-destructive">
          <WarningCircleIcon />
          {launchError}
        </p>
      )}

      {game.notes === undefined ? null : (
        <p className="mt-4 text-sm whitespace-pre-wrap text-muted-foreground">{game.notes}</p>
      )}

      <DetailsCard game={game} />

      {updateArchive === undefined ? null : (
        <GameUpdateCard
          key={updateArchive}
          game={game}
          archive={updateArchive}
          onChooseAnother={() => void chooseUpdate()}
          onClose={() => setUpdateArchive(undefined)}
        />
      )}

      {undoError === undefined ? null : (
        <p className="mt-4 text-sm text-destructive">{undoError}</p>
      )}

      <UndoUpdateDialog
        gameId={game.id}
        open={undoing}
        onOpenChange={setUndoing}
        onBusy={() => setUndoError(undefined)}
        onError={setUndoError}
      />

      <TranslationPanel game={game} onUpdateGame={() => void chooseUpdate()} />
      <InGameTextCard game={game} />

      {dialog === 'edit' ? (
        <EditGameDialog game={game} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'cg-pack' ? (
        <CgPackDialog game={game} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'remove' ? (
        <RemoveGameDialog game={game} onClose={() => setDialog(undefined)} />
      ) : null}
    </div>
  )
}
