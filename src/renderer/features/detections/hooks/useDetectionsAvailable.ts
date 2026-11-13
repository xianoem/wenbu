import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { isPluginReady, pluginsAtom } from '../../plugins/plugins'
import { detectionSettingsAtom } from '../detections'

export const useDetectionsAvailable = () => {
  const screenAiReady = isPluginReady(useAtomValue(pluginsAtom), 'screen-ai')
  const settings = useAtomValue(detectionSettingsAtom)

  return (
    screenAiReady || (AsyncResult.isSuccess(settings) && settings.value.engineId === 'google-lens')
  )
}
