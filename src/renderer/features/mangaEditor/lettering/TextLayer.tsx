import type { MangaEditorSettings, TextBlock } from '#contract/MangaEditor'
import type { ShownPage } from '../components/PageView'
import { bubbleLayout, fontOf, textBoxOf } from './bubbleLayout'
import type { LetteringFont } from './letteringFonts'

const outlineWidth = 2

const keyedLines = (lines: ReadonlyArray<string>) => {
  const seen = new Map<string, number>()

  return lines.map((text) => {
    const count = seen.get(text) ?? 0

    seen.set(text, count + 1)

    return { key: `${text}#${count}`, text }
  })
}

function Bubble({
  block,
  settings,
  font,
  pageHeight,
  scale,
}: {
  readonly block: TextBlock
  readonly settings: MangaEditorSettings
  readonly font: LetteringFont
  readonly pageHeight: number | undefined
  readonly scale: number
}) {
  const layout = bubbleLayout(block, settings, font, pageHeight)

  if (layout === undefined) {
    return null
  }

  const box = textBoxOf(block)
  const top = box.y + box.height / 2 - layout.height / 2
  const ink = block.ink === undefined ? 'rgb(0 0 0)' : `rgb(${block.ink.join(' ')})`

  return (
    <>
      {layout.fits ? null : (
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          rx={4 / scale}
          fill="none"
          stroke="rgb(245 158 11)"
          strokeWidth={2 / scale}
          strokeDasharray={`${6 / scale} ${4 / scale}`}
        />
      )}
      <text
        textAnchor="middle"
        fontFamily={font.family}
        fontSize={layout.size}
        fill={ink}
        stroke={settings.outline ? settings.outlineColor : 'none'}
        strokeWidth={outlineWidth}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {keyedLines(layout.lines).map(({ key, text }, index) => (
          <tspan
            key={key}
            x={box.x + box.width / 2}
            y={top + layout.ascent + index * layout.lineHeight}
          >
            {text}
          </tspan>
        ))}
      </text>
    </>
  )
}

export function TextLayer({
  page,
  pageHeight,
  blocks,
  settings,
  fonts,
}: {
  readonly page: ShownPage
  readonly pageHeight: number | undefined
  readonly blocks: ReadonlyArray<TextBlock>
  readonly settings: MangaEditorSettings
  readonly fonts: ReadonlyMap<string, LetteringFont>
}) {
  return (
    <svg
      viewBox={`0 0 ${page.width} ${page.height}`}
      className="pointer-events-none absolute inset-0 size-full select-none"
    >
      {blocks.map((block) => {
        const font = fonts.get(fontOf(block, settings))

        return font === undefined ? null : (
          <Bubble
            key={block.id}
            block={block}
            settings={settings}
            font={font}
            pageHeight={pageHeight}
            scale={page.scale}
          />
        )
      })}
    </svg>
  )
}
