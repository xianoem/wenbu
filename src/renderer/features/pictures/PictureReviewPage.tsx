import { useAtomRefresh, useAtomSet, useAtomSubscribe, useAtomValue } from '@effect/atom-react'
import {
  ArrowLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ImagesIcon,
  TranslateIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { Effect, Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  cleanKeyOf,
  defaultPictureStyle,
  type GamePicture,
  PicturesError,
  type PicturesSummary,
} from '#contract/Pictures'
import { formErrorOf } from '#lib/forms'
import { isTyping } from '#lib/isTyping'
import { type PictureReviewOpening, pictureReviewAtom } from '#lib/navigation'
import { useCoreCall } from '#lib/rpc'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'
import { gamesAtom } from '../library/library'
import { LineEditor } from './components/LineEditor'
import { PrimaryKbd } from './components/PrimaryKbd'
import { type DrawnBox, nextZoom, PictureStage, type StageTool } from './components/PictureStage'
import type { LetteringEdit } from './components/LineEditor'
import { cropPage } from '../mangaEditor/components/cropPage'
import { filterLabels, ReviewDock } from './components/ReviewDock'
import { groupsOf, nextGroup, type PictureFilter, readyToApprove } from './groups'
import { renderPicture } from './lettering'
import {
  cancelPictureScanAtom,
  findPictureTextAtom,
  picturesAtom,
  picturesSummaryAtom,
  pictureStyleAtom,
  savePictureStyleAtom,
  styleKeys,
  translatePicturesAtom,
} from './pictures'
import { loadPicture, usePicture } from './usePicture'

const AHEAD = 2

const cleanVersionOf = (picture: GamePicture) => cleanKeyOf(picture.lines)

const needsCleaning = (picture: GamePicture) =>
  picture.cleaned === undefined && picture.lines.some((line) => !line.keep)

const untranslated = (picture: GamePicture) =>
  picture.lines.some((line) => !line.keep && (line.translation?.trim() ?? '') === '')

const drawFailed = () =>
  new PicturesError({ reason: 'failed', message: 'Wenbu could not draw the translated picture.' })

type LineChange = LetteringEdit & {
  readonly source?: string
  readonly translation?: string
  readonly keep?: boolean
}

const countsOf = (summary: PicturesSummary | undefined): Record<PictureFilter, number> => ({
  'to-review': (summary?.withText ?? 0) - (summary?.approved ?? 0) - (summary?.kept ?? 0),
  approved: summary?.approved ?? 0,
  kept: summary?.kept ?? 0,
  all: summary?.withText ?? 0,
})

function CenteredMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      {children}
    </div>
  )
}

function Start({
  gameId,
  summary,
}: {
  readonly gameId: string
  readonly summary: PicturesSummary
}) {
  const find = useAtomSet(findPictureTextAtom)
  const cancel = useAtomSet(cancelPictureScanAtom)

  if (summary.scan !== undefined) {
    return (
      <CenteredMessage>
        <Spinner className="size-6" />
        <p className="text-foreground">
          Reading pictures · {summary.scan.done} of {summary.scan.total}
        </p>
        <Button
          variant="ghost"
          className="rounded-full"
          onClick={() => cancel({ payload: { gameId } })}
        >
          Cancel
        </Button>
      </CenteredMessage>
    )
  }

  return (
    <CenteredMessage>
      <ImagesIcon className="size-8" />
      <p className="max-w-sm">
        {summary.scanned === 0
          ? 'Wenbu reads the game’s pictures to find the ones with text. Nothing is translated until you ask.'
          : `None of the ${summary.scanned} pictures has text Wenbu can read.`}
      </p>
      {summary.notice === undefined ? null : (
        <p className="max-w-sm text-warning">{summary.notice}</p>
      )}
      <Button className="rounded-full px-4" onClick={() => find({ payload: { gameId } })}>
        {summary.scanned === 0 ? 'Find text in pictures' : 'Find again'}
      </Button>
    </CenteredMessage>
  )
}

export function PictureReviewPage({ opening }: { readonly opening: PictureReviewOpening }) {
  const { gameId } = opening
  const setOpening = useAtomSet(pictureReviewAtom)
  const summaryResult = useAtomValue(picturesSummaryAtom(gameId))
  const picturesResult = useAtomValue(picturesAtom(gameId))
  const refresh = useAtomRefresh(picturesAtom(gameId))
  const styleResult = useAtomValue(pictureStyleAtom(gameId))
  const saveStyle = useAtomSet(savePictureStyleAtom)
  const translate = useAtomSet(translatePicturesAtom)
  const games = useAtomValue(gamesAtom)
  const call = useCoreCall()
  const [filter, setFilter] = useState<PictureFilter>('to-review')
  const [variant, setVariant] = useState(0)
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [split, setSplit] = useState(0.5)
  const [showOriginal, setShowOriginal] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<StageTool>('select')
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const requested = useRef(new Set<string>())

  useAtomSubscribe(picturesSummaryAtom(gameId), (next) => {
    if (AsyncResult.isSuccess(next) && next.value.scan === undefined) {
      refresh()
    }
  })

  const summary = AsyncResult.isSuccess(summaryResult) ? summaryResult.value : undefined
  const pictures = AsyncResult.isSuccess(picturesResult) ? picturesResult.value : []
  const style = AsyncResult.isSuccess(styleResult) ? styleResult.value : defaultPictureStyle
  const groups = groupsOf(pictures, filter)

  const group =
    groups.find((candidate) =>
      candidate.pictures.some((picture) => picture.picture === opening.picture),
    ) ?? groups[0]

  const picture = group?.pictures[Math.min(variant, group.pictures.length - 1)]
  const original = usePicture(picture?.original, '0')
  const cleaned = usePicture(picture?.cleaned, picture === undefined ? '' : cleanVersionOf(picture))

  const title = AsyncResult.isSuccess(games)
    ? (games.value.find((candidate) => candidate.id === gameId)?.title ?? '')
    : ''

  const show = (key: string | undefined) => {
    const first = groups.find((candidate) => candidate.key === key)?.pictures[0]

    setVariant(0)
    setSelected(undefined)
    setZoom(1)
    setOpening({ gameId, picture: first?.picture })
  }

  const report = <A, E>(exit: Exit.Exit<A, E>) => {
    setError(Exit.isSuccess(exit) ? undefined : formErrorOf(exit)?.message)

    return exit
  }

  // Cleans the picture on screen and the next ones, so moving on doesn't wait for inpainting.
  useEffect(() => {
    if (summary?.canClean !== true || group === undefined) {
      return
    }

    const start = groups.indexOf(group)

    const upcoming = [
      picture,
      ...groups.slice(start + 1, start + 1 + AHEAD).map((next) => next.pictures[0]),
    ]

    const wanted = upcoming.flatMap((each) => {
      const id = each === undefined ? '' : `${each.picture}|${cleanVersionOf(each)}`

      return each !== undefined && needsCleaning(each) && !requested.current.has(id)
        ? [{ each, id }]
        : []
    })

    if (wanted.length === 0) {
      return
    }

    for (const { id } of wanted) {
      requested.current.add(id)
    }

    void call((client) =>
      Effect.forEach(
        wanted,
        ({ each, id }) =>
          client('cleanPicture', { gameId, picture: each.picture }).pipe(
            Effect.tapError(() => Effect.sync(() => requested.current.delete(id))),
          ),
        { discard: true },
      ),
    ).then(report)
  })

  const editLine = async (line: number, edit: LineChange) => {
    if (picture === undefined) {
      return
    }

    report(
      await call((client) =>
        client('savePictureLine', { gameId, picture: picture.picture, line, ...edit }),
      ),
    )

    refresh()
  }

  const removeLine = async (line: number) => {
    if (picture === undefined) {
      return
    }

    setSelected(undefined)

    report(
      await call((client) =>
        client('removePictureLine', { gameId, picture: picture.picture, line }),
      ),
    )

    refresh()
  }

  const addLine = async (box: DrawnBox) => {
    if (picture === undefined || original === undefined) {
      return
    }

    setTool('select')

    const image = cropPage(original, { x: box.x, y: box.y, width: box.w, height: box.h })

    const exit = report(
      await call((client) =>
        client('addPictureLine', { gameId, picture: picture.picture, box, image }),
      ),
    )

    refresh()

    if (Exit.isSuccess(exit)) {
      setSelected(Math.max(...exit.value.lines.map((each) => each.id)))
    }
  }

  const translateThese = (keys: ReadonlyArray<string>) =>
    translate({ payload: { gameId, pictures: keys } })

  const step = (direction: 1 | -1) => {
    if (group !== undefined) {
      show(nextGroup(groups, group.key, direction))
    }
  }

  const keepOriginal = async () => {
    if (group === undefined) {
      return
    }

    const following = nextGroup(groups, group.key, 1)

    const exit = report(
      await call((client) =>
        Effect.forEach(
          group.pictures,
          (each) => client('setPictureStatus', { gameId, picture: each.picture, status: 'kept' }),
          { discard: true },
        ),
      ),
    )

    refresh()

    if (Exit.isSuccess(exit)) {
      show(following)
    }
  }

  const approve = async () => {
    if (group === undefined || picture === undefined || !readyToApprove(picture) || approving) {
      return
    }

    const following = nextGroup(groups, group.key, 1)
    const pending = group.pictures.filter((each) => each === picture || each.status === 'to-review')

    setApproving(true)

    const exit = report(
      await call((client) =>
        Effect.forEach(
          pending,
          (each) =>
            Effect.gen(function* () {
              const ready =
                each.cleaned === undefined
                  ? yield* client('cleanPicture', { gameId, picture: each.picture })
                  : each

              const file = ready.cleaned

              if (file === undefined) {
                return yield* new PicturesError({
                  reason: 'not-ready',
                  message: 'Wenbu could not clean this picture yet.',
                })
              }

              const bitmap = yield* Effect.tryPromise({
                try: () => loadPicture(file, cleanVersionOf(ready)),
                catch: drawFailed,
              })

              const image = yield* Effect.tryPromise({
                try: () => renderPicture(bitmap, ready.lines, style),
                catch: drawFailed,
              })

              return yield* client('approvePicture', { gameId, picture: each.picture, image })
            }),
          { discard: true },
        ),
      ),
    )

    setApproving(false)
    refresh()

    if (Exit.isSuccess(exit)) {
      show(following)
    }
  }

  const onKey = useEffectEvent((event: KeyboardEvent, down: boolean) => {
    if (isTyping(event.target)) {
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      setShowOriginal(down)

      return
    }

    if (!down) {
      return
    }

    const actions: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      Enter: () => void approve(),
      k: () => void keepOriginal(),
      s: () => step(1),
      a: () => setTool('draw'),
      f: () => {
        if (selected !== undefined) {
          void editLine(selected, { size: null, fillBox: true })
        }
      },
      v: () => setTool('select'),
      '+': () => setZoom((current) => nextZoom(current, 1)),
      '=': () => setZoom((current) => nextZoom(current, 1)),
      '-': () => setZoom((current) => nextZoom(current, -1)),
      '0': () => setZoom(1),
      Delete: () => {
        if (selected !== undefined) {
          void removeLine(selected)
        }
      },
      t: () => {
        if (picture !== undefined) {
          translateThese([picture.picture])
        }
      },
      Escape: () => {
        if (tool === 'draw') {
          setTool('select')
        } else if (selected === undefined) {
          setOpening(undefined)
        } else {
          setSelected(undefined)
        }
      },
    }

    const action = actions[event.key]

    if (action !== undefined) {
      event.preventDefault()
      action()
    }
  })

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKey(event, true)
    const up = (event: KeyboardEvent) => onKey(event, false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const selectLine = (line: number | undefined) => {
    setSelected(line)

    const chosen = picture?.lines.find((candidate) => candidate.id === line)

    if (chosen !== undefined && picture !== undefined) {
      setSplit((chosen.x + chosen.w / 2) / picture.width)
    }
  }

  const line = picture?.lines.find((candidate) => candidate.id === selected)
  const at = group === undefined ? -1 : groups.indexOf(group)
  const position = at < 0 ? '' : `${at + 1} of ${groups.length} · ${filterLabels[filter]} · `
  const toTranslate = groups.filter((each) => each.pictures.some((member) => untranslated(member)))

  const translateBanner =
    picture !== undefined && untranslated(picture) ? (
      <div className="absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-card/95 py-1.5 pr-1.5 pl-4 shadow-[0_16px_40px_rgb(0_0_0/0.55),0_0_0_1px_oklch(1_0_0/0.07)]">
        {picture.busy === 'translating' ? (
          <p className="flex items-center gap-2 text-sm">
            <Spinner /> Translating with the picture…
          </p>
        ) : (
          <>
            <p className="text-sm">Not translated yet</p>
            <div className="flex gap-1.5">
              <Button
                className="h-8 rounded-full px-3.5"
                onClick={() => translateThese([picture.picture])}
              >
                <TranslateIcon />
                Translate <PrimaryKbd>T</PrimaryKbd>
              </Button>
              {toTranslate.length > 1 ? (
                <Button
                  variant="outline"
                  className="h-8 rounded-full px-3.5"
                  onClick={() =>
                    translateThese(
                      toTranslate.flatMap((each) =>
                        each.pictures.slice(0, 1).map((first) => first.picture),
                      ),
                    )
                  }
                >
                  Translate all {toTranslate.length}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    ) : undefined

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="absolute top-2.5 left-3 z-30 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to the game"
          className="rounded-full"
          onClick={() => setOpening(undefined)}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{picture?.picture ?? 'Text in pictures'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {position}
            {title}
          </p>
        </div>
        {group !== undefined && group.pictures.length > 1 ? (
          <div className="flex items-center text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous variant"
              className="rounded-full"
              onClick={() =>
                setVariant((index) => (index + group.pictures.length - 1) % group.pictures.length)
              }
            >
              <CaretLeftIcon />
            </Button>
            Variant {Math.min(variant, group.pictures.length - 1) + 1} of {group.pictures.length}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next variant"
              className="rounded-full"
              onClick={() => setVariant((index) => (index + 1) % group.pictures.length)}
            >
              <CaretRightIcon />
            </Button>
          </div>
        ) : null}
      </div>

      {summary?.canClean === false ? (
        <div className="absolute top-3.5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-tint-amber px-3 py-1 text-xs font-medium text-tint-amber-foreground">
          <WarningIcon />
          Install Manga Image Translator on the Plugins page to clean pictures
        </div>
      ) : null}

      {summary === undefined ? (
        <CenteredMessage>
          <Spinner className="size-6" />
        </CenteredMessage>
      ) : null}

      {summary !== undefined && (summary.withText === 0 || summary.scan !== undefined) ? (
        <Start gameId={gameId} summary={summary} />
      ) : null}

      {summary !== undefined &&
      summary.withText > 0 &&
      summary.scan === undefined &&
      picture === undefined ? (
        <CenteredMessage>
          <p>No pictures here.</p>
          <Button variant="ghost" className="rounded-full" onClick={() => setFilter('all')}>
            Show all pictures
          </Button>
        </CenteredMessage>
      ) : null}

      {picture === undefined || summary === undefined || summary.scan !== undefined ? null : (
        <PictureStage
          key={picture.picture}
          picture={picture}
          cleaned={cleaned}
          pictureStyle={style}
          selected={selected}
          split={split}
          showOriginal={showOriginal}
          onSelect={selectLine}
          onSplit={setSplit}
          zoom={zoom}
          tool={tool}
          onZoom={setZoom}
          onDraw={(box) => void addLine(box)}
          editor={
            line === undefined ? null : (
              <LineEditor
                picture={picture}
                line={line}
                pictureStyle={style}
                onSource={(source) => void editLine(line.id, { source })}
                onTranslation={(translation) => void editLine(line.id, { translation })}
                onKeep={(keep) => void editLine(line.id, { keep })}
                onLettering={(edit) => void editLine(line.id, edit)}
                onRemove={() => void removeLine(line.id)}
                onAgain={() => translateThese([picture.picture])}
              />
            )
          }
        />
      )}

      {selected === undefined ? translateBanner : null}

      {error === undefined && summary?.notice === undefined ? null : (
        <div className="absolute top-14 left-1/2 z-30 max-w-xl -translate-x-1/2 rounded-full bg-card px-4 py-1.5 text-xs text-warning shadow-[0_10px_30px_rgb(0_0_0/0.5)]">
          {error ?? summary?.notice}
        </div>
      )}

      {groups.length === 0 || summary?.scan !== undefined ? null : (
        <ReviewDock
          groups={groups}
          current={group?.key}
          approving={approving}
          canApprove={picture !== undefined && readyToApprove(picture)}
          tool={tool}
          zoom={zoom}
          filter={filter}
          counts={countsOf(summary)}
          style={style}
          onSelect={show}
          onStep={step}
          onKeep={() => void keepOriginal()}
          onApprove={() => void approve()}
          onTool={setTool}
          onZoom={setZoom}
          onFilter={(next) => {
            setFilter(next)
            setVariant(0)
          }}
          onStyle={(next) =>
            saveStyle({ payload: { gameId, style: next }, reactivityKeys: styleKeys(gameId) })
          }
        />
      )}
    </div>
  )
}
