import { useState } from 'react'

export type FontLoad = 'idle' | 'loading' | 'loaded' | 'error'

const localFonts = async (): Promise<ReadonlyArray<string>> => {
  const query = window.queryLocalFonts

  if (query === undefined) {
    throw new Error('Local fonts are unavailable.')
  }

  const fonts = await query()

  return [...new Set(fonts.map((font) => font.family).filter((family) => family !== ''))].toSorted(
    (left, right) => left.localeCompare(right),
  )
}

export function useLocalFonts() {
  const [fonts, setFonts] = useState<ReadonlyArray<string>>([])
  const [state, setState] = useState<FontLoad>('idle')

  const load = (open: boolean) => {
    if (!open || state === 'loading' || state === 'loaded') {
      return
    }

    setState('loading')

    localFonts().then(
      (families) => {
        setFonts(families)
        setState('loaded')
      },
      () => setState('error'),
    )
  }

  return { fonts, state, load }
}
