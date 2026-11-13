import {
  type BubbleLayout,
  type EditorPage,
  type Lettering,
  type MangaEditorSettings,
  sizingOf,
  type TextBlock,
} from '#contract/MangaEditor'
import { layoutText, type TextFont, type TextLayout } from './layoutText'

export const textBoxOf = (block: TextBlock) => block.lettering.textBox ?? block.box

export const fontOf = (block: TextBlock, settings: MangaEditorSettings) =>
  block.lettering.font ?? settings.font

const shrinkFloor = 0.75

export const sizeScale = (settings: MangaEditorSettings, pageHeight: number | undefined) =>
  pageHeight === undefined || settings.sizeReference === undefined
    ? 1
    : pageHeight / settings.sizeReference

// Sizes saved before sizing modes existed are page pixels.
export const customSize = (lettering: Lettering, scale: number) => {
  if (lettering.size === undefined) {
    return undefined
  }

  return lettering.sizing === undefined ? Math.round(lettering.size / scale) : lettering.size
}

export const letteredSize = (
  block: TextBlock,
  settings: MangaEditorSettings,
  pageHeight?: number,
  lettering: Lettering = block.lettering,
) => {
  const sizing = sizingOf(lettering)
  const scale = sizeScale(settings, pageHeight)
  const kindSize = settings.kindSizes[block.kind]

  if (sizing === 'custom' && lettering.size !== undefined && lettering.sizing === undefined) {
    return lettering.size
  }

  if (sizing === 'custom' && lettering.size !== undefined) {
    return Math.max(1, Math.round(lettering.size * scale))
  }

  if (sizing === 'kind' && kindSize !== undefined) {
    return Math.max(1, Math.round(kindSize * (1 + (lettering.emphasis ?? 0) / 100) * scale))
  }

  return undefined
}

export const bubbleLayout = (
  block: TextBlock,
  settings: MangaEditorSettings,
  font: TextFont | undefined,
  pageHeight: number | undefined,
  lettering: Lettering = block.lettering,
  share = 1,
): TextLayout | undefined => {
  const box = textBoxOf(block)
  const size = letteredSize(block, settings, pageHeight, lettering)

  if (font === undefined || block.translation.trim() === '') {
    return undefined
  }

  return layoutText(font, {
    text: block.translation,
    width: box.width * share,
    height: box.height,
    ...(size === undefined ? {} : { size }),
    ...(size !== undefined && lettering.shrink === true ? { shrinkTo: size * shrinkFloor } : {}),
    minSize: settings.minFontSize,
    maxSize: settings.maxFontSize,
    leading: lettering.leading ?? 1,
    breakMode: lettering.breakMode,
    avoidOrphans: lettering.avoidOrphans,
    hyphenate: lettering.hyphenate,
    uppercase: settings.uppercase,
  })
}

export const pageLayouts = (
  pages: ReadonlyArray<EditorPage>,
  settings: MangaEditorSettings,
  fonts: ReadonlyMap<string, TextFont>,
) => {
  const layouts: Record<string, BubbleLayout> = {}

  for (const [page, block] of pages.flatMap((page) =>
    page.blocks.map((block) => [page, block] as const),
  )) {
    const layout = bubbleLayout(block, settings, fonts.get(fontOf(block, settings)), page.height)

    if (layout !== undefined) {
      layouts[block.id] = { size: Math.round(layout.size), lines: [...layout.lines] }
    }
  }

  return layouts
}
