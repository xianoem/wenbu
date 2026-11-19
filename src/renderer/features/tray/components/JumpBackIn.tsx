import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BookOpenTextIcon,
  GameControllerIcon,
  type Icon,
  ImagesIcon,
  PlayIcon,
} from '@phosphor-icons/react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { OpenGallery, OpenGame, OpenNovel } from '#contract/Background'
import { pageThumbnailUrl } from '#contract/PageImage'
import { Button } from '#ui/button'
import { continueReadingAtom } from '../../galleries/galleries'
import { GameCover } from '../../library/components/GameCover'
import { gamesAtom } from '../../library/library'
import { NovelCover } from '../../novels/components/NovelCover'
import { shelfAtom } from '../../novels/novels'
import { launchWithOverlayAtom } from '../../overlay/overlay'
import { type JumpCard, jumpBackIn } from '../jumpBackIn'
import { PanelLabel } from './PanelLabel'

const kindIcons: Record<JumpCard['kind'], Icon> = {
  game: GameControllerIcon,
  novel: BookOpenTextIcon,
  gallery: ImagesIcon,
}

const actionIcons: Record<JumpCard['kind'], Icon> = {
  game: PlayIcon,
  novel: BookOpenTextIcon,
  gallery: ImagesIcon,
}

const actionLabels: Record<JumpCard['kind'], string> = {
  game: 'Play with overlay',
  novel: 'Continue reading',
  gallery: 'Continue reading',
}

const titleOf = (card: JumpCard) => {
  if (card.kind === 'game') {
    return card.game.title
  }

  return card.kind === 'novel'
    ? (card.novel.titleTranslated ?? card.novel.title)
    : card.gallery.title
}

function CardCover({ card }: { readonly card: JumpCard }) {
  const shape = 'absolute inset-0 size-full rounded-[14px]'

  if (card.kind === 'game') {
    return <GameCover game={card.game} className={`${shape} aspect-auto object-cover`} />
  }

  if (card.kind === 'novel') {
    return (
      <NovelCover id={card.novel.id} title={card.novel.title} size="text-sm" className={shape} />
    )
  }

  if (card.gallery.cover === null) {
    return <div aria-hidden className={`${shape} bg-tint-amber`} />
  }

  return (
    <img
      src={pageThumbnailUrl(card.gallery.cover, { size: 240, version: card.gallery.coverVersion })}
      alt=""
      className={`${shape} bg-muted object-cover`}
    />
  )
}

function Card({ card, onOpen }: { readonly card: JumpCard; readonly onOpen: () => void }) {
  const KindIcon = kindIcons[card.kind]
  const ActionIcon = actionIcons[card.kind]
  const title = titleOf(card)

  return (
    <Button
      variant="ghost"
      aria-label={`${actionLabels[card.kind]}: ${title}`}
      className="group/card flex h-auto min-w-0 flex-col items-stretch gap-0 rounded-[14px] p-0 text-left font-normal hover:bg-transparent"
      onClick={onOpen}
    >
      <span className="relative h-[76px] overflow-hidden rounded-[14px]">
        <CardCover card={card} />
        <span className="absolute right-1.5 bottom-1.5 flex size-[26px] items-center justify-center rounded-full bg-white/92 text-zinc-900 transition-transform group-hover/card:scale-110">
          <ActionIcon weight="fill" className="size-3.5" />
        </span>
      </span>
      <span className="mt-1.5 flex items-center gap-1.5 truncate text-[10.5px] text-muted-foreground">
        <KindIcon className="size-3.5 shrink-0" />
        {card.note}
      </span>
      <span className="truncate text-xs font-medium">{title}</span>
    </Button>
  )
}

export function JumpBackIn() {
  const games = useAtomValue(gamesAtom)
  const shelf = useAtomValue(shelfAtom)
  const galleries = useAtomValue(continueReadingAtom)
  const launch = useAtomSet(launchWithOverlayAtom, { mode: 'promiseExit' })

  const cards = jumpBackIn(
    AsyncResult.isSuccess(games) ? games.value : [],
    AsyncResult.isSuccess(shelf) ? shelf.value.novels : [],
    AsyncResult.isSuccess(galleries) ? galleries.value : [],
  )

  if (cards.length === 0) {
    return null
  }

  const open = async (card: JumpCard) => {
    if (card.kind === 'novel') {
      window.wenbu.openApp(OpenNovel.make({ novelId: card.novel.id, chapter: card.chapter }))

      return
    }

    if (card.kind === 'gallery') {
      window.wenbu.openApp(
        OpenGallery.make({ folder: card.gallery.folder, page: card.page, version: card.version }),
      )

      return
    }

    const exit = await launch({ payload: { gameId: card.game.id } })

    if (Exit.isSuccess(exit)) {
      window.wenbu.hidePanel()

      return
    }

    window.wenbu.openApp(OpenGame.make({ gameId: card.game.id }))
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelLabel>Jump back in</PanelLabel>
      <div className="grid grid-cols-3 gap-2">
        {cards.map((card) => (
          <Card key={`${card.kind}:${card.id}`} card={card} onOpen={() => void open(card)} />
        ))}
      </div>
    </section>
  )
}
