import { Exit } from 'effect'
import { useEffect, useState } from 'react'
import { pageFontUrl } from '#contract/PageImage'
import { useCoreCall } from '#lib/rpc'
import type { TextFont } from './layoutText'

export interface LetteringFont extends TextFont {
  readonly family: string
}

type FindFont = (font: string) => Promise<string | undefined>

const loaded = new Map<string, Promise<LetteringFont>>()

const measurerFor = (family: string) => {
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  const widths = new Map<string, number>()

  return (text: string, size: number) => {
    const key = `${size}\u0000${text}`
    const known = widths.get(key)

    if (known !== undefined || context === null) {
      return known ?? text.length * size * 0.5
    }

    context.font = `${size}px ${family}`

    const width = context.measureText(text).width

    widths.set(key, width)

    return width
  }
}

const metricsOf = (family: string) => {
  const context = new OffscreenCanvas(1, 1).getContext('2d')

  if (context === null) {
    return { ascent: 0.8, descent: 0.2 }
  }

  context.font = `100px ${family}`

  const measured = context.measureText('Hg')

  return {
    ascent: measured.fontBoundingBoxAscent / 100,
    descent: measured.fontBoundingBoxDescent / 100,
  }
}

const load = async (font: string, find: FindFont): Promise<LetteringFont> => {
  const file = await find(font)
  const family = file === undefined ? `"${font}"` : `"wenbu ${font}"`

  if (file !== undefined) {
    const face = new FontFace(`wenbu ${font}`, `url("${pageFontUrl(file)}")`)

    document.fonts.add(await face.load())
  } else {
    await document.fonts.load(`40px ${family}`)
  }

  return { family, measure: measurerFor(family), gap: 0, ...metricsOf(family) }
}

export const letteringFont = (font: string, find: FindFont) => {
  const known = loaded.get(font)

  if (known !== undefined) {
    return known
  }

  const loading = load(font, find)

  loaded.set(font, loading)
  loading.catch(() => loaded.delete(font))

  return loading
}

export function useFindFont(): FindFont {
  const call = useCoreCall()

  return async (font) => {
    const exit = await call((client) => client('findMangaEditorFont', { font }))

    return Exit.isSuccess(exit) ? exit.value : undefined
  }
}

export function useLetteringFonts(fonts: ReadonlyArray<string>) {
  const find = useFindFont()
  const [ready, setReady] = useState<ReadonlyMap<string, LetteringFont>>(new Map())
  const wanted = [...new Set(fonts)].toSorted().join('\u0000')

  useEffect(() => {
    let gone = false

    for (const font of wanted.split('\u0000').filter(Boolean)) {
      void letteringFont(font, find).then(
        (loadedFont) => {
          if (!gone) {
            setReady((current) =>
              current.get(font) === loadedFont ? current : new Map(current).set(font, loadedFont),
            )
          }
        },
        () => undefined,
      )
    }

    return () => {
      gone = true
    }
  }, [find, wanted])

  return ready
}
