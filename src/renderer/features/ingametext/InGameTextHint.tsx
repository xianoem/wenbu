import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import { TranslateIcon, XIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { Button } from '#ui/button'
import { liveControlsAtom } from '../livecontrols/liveControls'
import {
  answeredHintsAtom,
  inGameTextSettingsAtom,
  saveInGameTextSettingsAtom,
  settingsKeys,
} from './inGameText'

function Hint({ gameId, gameTitle }: { readonly gameId: string; readonly gameTitle: string }) {
  const result = useAtomValue(inGameTextSettingsAtom(gameId))
  const save = useAtomSet(saveInGameTextSettingsAtom)
  const [answered, setAnswered] = useAtom(answeredHintsAtom)

  if (!AsyncResult.isSuccess(result) || result.value.uiText || answered.includes(gameId)) {
    return null
  }

  const answer = () => setAnswered([...answered, gameId])

  const turnOn = () => {
    save({
      payload: { gameId, settings: { ...result.value, uiText: true } },
      reactivityKeys: settingsKeys(gameId),
    })

    answer()
  }

  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-muted/50 px-3.5 py-2.5 text-[13px]">
      <TranslateIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        Wenbu can translate {gameTitle}’s menus automatically while you play.
      </span>
      <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={turnOn}>
        Turn on
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={answer}>
        <XIcon />
      </Button>
    </div>
  )
}

export function InGameTextHint() {
  const live = useAtomValue(liveControlsAtom)

  if (!AsyncResult.isSuccess(live) || live.value.status !== 'connected') {
    return null
  }

  const { gameId, gameTitle } = live.value

  if (gameId === undefined || gameTitle === undefined) {
    return null
  }

  return <Hint gameId={gameId} gameTitle={gameTitle} />
}
