import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { type Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { defaultInGameTextSettings, type InGameTextSettings } from '#contract/InGameText'
import type { HookedControl } from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { liveControlsAtom } from '../livecontrols/liveControls'
import { inGameTextSettingsAtom, saveInGameTextSettingsAtom, settingsKeys } from './inGameText'

export function useInGameTextSettings(gameId: string) {
  const result = useAtomValue(inGameTextSettingsAtom(gameId))
  const live = useAtomValue(liveControlsAtom)
  const save = useAtomSet(saveInGameTextSettingsAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)
  const loaded = AsyncResult.isSuccess(result)
  const settings = loaded ? result.value : defaultInGameTextSettings
  const state = AsyncResult.isSuccess(live) ? Option.some(live.value) : Option.none()

  const unavailable = (control: HookedControl) =>
    Option.getOrUndefined(
      Option.flatMap(state, (current) =>
        current.gameId === gameId
          ? Option.fromNullishOr(
              current.unsupported.find((entry) => entry.control === control)?.reason,
            )
          : Option.none(),
      ),
    )

  const report = async (pending: Promise<Exit.Exit<unknown, unknown>>) =>
    setError(formErrorOf(await pending)?.message)

  const change = (next: Partial<InGameTextSettings>) =>
    report(
      save({
        payload: { gameId, settings: { ...settings, ...next } },
        reactivityKeys: settingsKeys(gameId),
      }),
    )

  return { settings, loaded, error, unavailable, change }
}
