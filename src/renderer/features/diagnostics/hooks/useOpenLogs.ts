import { useAtom, useAtomSet } from '@effect/atom-react'
import { returnScreenAtom, screenAtom } from '#lib/navigation'

export const useOpenLogs = () => {
  const [screen, setScreen] = useAtom(screenAtom)
  const setReturnScreen = useAtomSet(returnScreenAtom)

  return () => {
    if (screen !== 'logs') {
      setReturnScreen(screen)
    }

    setScreen('logs')
  }
}
