import type { Game } from '#contract/Library'
import { supportsLiveControls } from '#contract/LiveControls'
import { Checkbox } from '#ui/checkbox'
import { SwitchRow } from './SwitchRow'
import { useInGameTextSettings } from './useInGameTextSettings'

export function DialogueWrapRow({
  game,
  className,
}: {
  readonly game: Game
  readonly className?: string
}) {
  const { settings, loaded, error, unavailable, change } = useInGameTextSettings(game.id)

  if (!supportsLiveControls(game.engine)) {
    return null
  }

  const reason = unavailable('wordWrap')

  return (
    <SwitchRow
      className={className}
      title="Wrap long dialogue lines"
      description={
        reason === undefined
          ? 'Breaks lines between words while you play, so you can keep a comfortable font size.'
          : `Unavailable: ${reason}`
      }
      checked={settings.wordWrap}
      disabled={!loaded}
      onCheckedChange={(wordWrap) => change({ wordWrap })}
    >
      {settings.wordWrap ? (
        <label className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Checkbox
            checked={settings.reflow}
            onCheckedChange={(reflow) => change({ reflow: reflow === true })}
          />
          Reflow each message into one paragraph before wrapping
        </label>
      ) : null}
      {error === undefined ? null : <p className="mt-2 text-[13px] text-destructive">{error}</p>}
    </SwitchRow>
  )
}
