import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { MonitorPlayIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { sidebarOpenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { libraryKeys } from '../../library/library'
import { isPluginReady, pluginsAtom } from '../../plugins/plugins'
import { launchWithOverlayAtom, overlayAtom, overlayPopoverOpenAtom } from '../overlay'

export function LaunchWithOverlayButton({
  game,
  className,
  onError,
}: {
  readonly game: Game
  readonly className: string
  readonly onError: (message: string | undefined) => void
}) {
  const launch = useAtomSet(launchWithOverlayAtom, { mode: 'promiseExit' })
  const openPopover = useAtomSet(overlayPopoverOpenAtom)
  const sidebarOpen = useAtomValue(sidebarOpenAtom)
  const overlay = useAtomValue(overlayAtom)
  const lunaHookReady = isPluginReady(useAtomValue(pluginsAtom), 'luna-hook')
  const [starting, setStarting] = useState(false)
  const state = AsyncResult.isSuccess(overlay) ? overlay.value : undefined
  const running = state?.sessionId !== undefined && state.gameId === game.id

  const showSession = () => {
    if (sidebarOpen) {
      openPopover(true)
    }
  }

  const start = async () => {
    setStarting(true)
    onError(undefined)

    const exit = await launch({ payload: { gameId: game.id }, reactivityKeys: libraryKeys })

    setStarting(false)

    if (Exit.isSuccess(exit)) {
      showSession()

      return
    }

    onError(formErrorOf(exit)?.message)
  }

  if (!lunaHookReady) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span />}>
          <Button variant="ghost" className={className} disabled>
            <MonitorPlayIcon />
            With overlay
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Install LunaHook from Plugins to use the Translation Overlay.
        </TooltipContent>
      </Tooltip>
    )
  }

  if (running) {
    return (
      <Button variant="ghost" className={className} onClick={showSession}>
        <span className="size-2 animate-pulse rounded-full bg-warning" />
        Overlay running
      </Button>
    )
  }

  return (
    <Button variant="ghost" className={className} disabled={starting} onClick={() => void start()}>
      {starting ? <Spinner /> : <MonitorPlayIcon />}
      With overlay
    </Button>
  )
}
