import { SlidersHorizontalIcon } from '@phosphor-icons/react'
import type { Game } from '#contract/Library'
import { liveControlsHotkey, supportsLiveControls } from '#contract/LiveControls'

export function LiveControlsPill({
  game,
  withHotkey = false,
}: {
  readonly game: Game
  readonly withHotkey?: boolean
}) {
  if (!supportsLiveControls(game.engine)) {
    return null
  }

  return (
    <span
      title={`Press ${liveControlsHotkey} while the game runs to open Live Game Controls.`}
      className="inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium whitespace-nowrap text-foreground"
    >
      <SlidersHorizontalIcon aria-hidden className="size-3.5" />
      Live controls
      {withHotkey ? (
        <>
          <span className="text-muted-foreground">· press</span>
          <kbd className="rounded-[5px] border border-b-2 border-border bg-background px-1 font-mono text-[11px] leading-4">
            {liveControlsHotkey}
          </kbd>
          <span className="text-muted-foreground">in game</span>
        </>
      ) : null}
    </span>
  )
}
