import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { useEffect } from 'react'
import { type Screen, screenAtom } from '#lib/navigation'
import { areaLook } from '../areaLook'
import { markAreaSeenAtom, whatsNewAtom, whatsNewKeys } from '../updates'

export const useNewScreens = (): ReadonlySet<Screen> => {
  const result = useAtomValue(whatsNewAtom)
  const screen = useAtomValue(screenAtom)
  const markAreaSeen = useAtomSet(markAreaSeenAtom)
  const newAreas = AsyncResult.isSuccess(result) ? result.value.newAreas : []
  const opened = newAreas.find((area) => areaLook(area).screen === screen)

  useEffect(() => {
    if (opened !== undefined) {
      markAreaSeen({ payload: { area: opened }, reactivityKeys: whatsNewKeys })
    }
  }, [opened, markAreaSeen])

  return new Set(newAreas.flatMap((area) => areaLook(area).screen ?? []))
}
