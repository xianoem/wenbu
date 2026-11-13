import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useSyncExternalStore } from 'react'
import type { Theme } from '#contract/Appearance'
import { Core } from '#lib/rpc'

export const appearanceAtom = Core.query('getAppearance', undefined, {
  reactivityKeys: ['appearance'],
})

export const setAppearanceAtom = Core.mutation('setAppearance')

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeToSystemTheme = (onChange: () => void) => {
  darkQuery.addEventListener('change', onChange)

  return () => darkQuery.removeEventListener('change', onChange)
}

const useSystemPrefersDark = () =>
  useSyncExternalStore(subscribeToSystemTheme, () => darkQuery.matches)

export const useTheme = (): Theme => {
  const result = useAtomValue(appearanceAtom)

  return AsyncResult.isSuccess(result) ? result.value.theme : 'system'
}

export const useApplyTheme = () => {
  const theme = useTheme()
  const prefersDark = useSystemPrefersDark()
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
}
