import { createRequire } from 'node:module'
import CanvasKitInit, { type Typeface } from 'canvaskit-wasm'
import * as hb from 'harfbuzzjs'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { MangaError } from '#contract/Manga'
import type { RgbImage } from './Images'
import {
  fontVariants,
  lineMetrics,
  sanitizedFont,
  type FontFile,
  type LineMetrics,
} from './LetterFonts'
import {
  constrainGeometries,
  renderGeometry,
  safeArea,
  type Box,
  type LetterRegion,
} from './LetterGeometry'
import { optimalLayout, type Layout, type Measure } from './LetterLayout'
import { parseStyledSegments, splitWords, type LineBreaking, type Style } from './LineBreaking'
import { OpenCv } from './OpenCv'
import { crop, pillowResize } from './PillowResize'

/**
 * The lettering renderer (wenbu_manga/skia): HarfBuzz shapes, the layout search picks the font size and
 * line breaks, and Skia (CanvasKit) draws the glyphs four times larger before LANCZOS brings them back,
 * as the plugin's skia-python renderer does.
 */

const failed = (message: string) => new MangaError({ reason: 'failed', message })

export interface LetterOptions {
  readonly fontDir: string
  readonly minFontSize: number
  readonly maxFontSize: number
  readonly supersampling: number
  readonly border: boolean
  readonly borderColor: readonly [number, number, number]
  /** A colour for all text, or undefined to use each block's own. */
  readonly textColor: readonly [number, number, number] | undefined
  readonly uppercase: boolean
}

export interface LetterBlock {
  readonly region: LetterRegion
  readonly fg: readonly [number, number, number]
  readonly bg: readonly [number, number, number]
  /** The editor's lettering settings; present, even empty, for every block the editor sends. */
  readonly lettering:
    | {
        readonly breakMode?: LineBreaking['mode'] | undefined
        readonly avoidOrphans?: boolean | undefined
        readonly hyphenate?: boolean | undefined
        readonly uppercase?: boolean | undefined
        readonly size?: number | undefined
        readonly fontDir?: string | undefined
        readonly leading?: number | undefined
      }
    | undefined
}

interface LoadedFont {
  readonly data: Uint8Array
  readonly face: hb.Face
  readonly typeface: Typeface
  readonly codepoints: ReadonlySet<number>
  readonly gpos: ReadonlyArray<string>
  readonly gsub: ReadonlyArray<string>
}

type Family = Partial<Record<Style, LoadedFont>> & { readonly regular: LoadedFont }

const defaultBorderWidth = 2
const editorPadding = 0.02
const fallbackPadding = 0.08
const safePadding = 5

const lineBreaks = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029])

/** Python's str.splitlines: \r\n counts as one break. */
const splitLines = (text: string) => {
  const lines: Array<string> = []
  let current = ''
  let previous = ''

  for (const character of text) {
    const breaks = lineBreaks.has(character.codePointAt(0) ?? 0)

    if (breaks && !(character === '\n' && previous === '\r')) {
      lines.push(current)
      current = ''
    } else if (!breaks) {
      current += character
    }

    previous = character
  }

  return current === '' ? lines : [...lines, current]
}

export class Lettering extends Context.Service<
  Lettering,
  {
    readonly render: (
      page: RgbImage,
      original: RgbImage,
      blocks: ReadonlyArray<LetterBlock>,
      options: LetterOptions,
    ) => Effect.Effect<RgbImage, MangaError>
    readonly breaks: (
      original: RgbImage,
      block: LetterBlock,
      options: LetterOptions,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly lines: ReadonlyArray<string>; readonly fontSize: number }>,
      MangaError
    >
  }
>()('wenbu/core/manga/engine/Lettering') {
  static readonly layer = Layer.effect(
    Lettering,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { cv } = yield* OpenCv
      const modules = createRequire(import.meta.url)

      const canvasKit = yield* Effect.tryPromise({
        try: () =>
          CanvasKitInit({ locateFile: (file) => modules.resolve(`canvaskit-wasm/bin/${file}`) }),
        catch: () => failed('CanvasKit could not be loaded.'),
      })

      const families = new Map<string, Family>()

      const loadFont = Effect.fnUntraced(function* (file: string) {
        const raw = yield* fs
          .readFile(file)
          .pipe(Effect.mapError(() => failed(`The font ${file} could not be read.`)))

        const rawFace = new hb.Face(new hb.Blob(raw), 0)
        const rawFont = new hb.Font(rawFace)
        const upem = rawFace.upem

        rawFont.setScale(upem, upem)

        const data = sanitizedFont(raw, {
          glyphOfM: rawFont.nominalGlyph(0x4d),
          xMax: (glyph) => {
            const extents = rawFont.glyphExtents(glyph)

            return extents === undefined ? undefined : extents.xBearing + extents.width
          },
          advance: (glyph) => rawFont.glyphHAdvance(glyph),
        })

        const face = new hb.Face(new hb.Blob(data), 0)
        const typeface = canvasKit.Typeface.MakeTypefaceFromData(data.slice().buffer)

        if (typeface === null) {
          return yield* failed(`The font ${file} could not be read.`)
        }

        return {
          data,
          face,
          typeface,
          codepoints: new Set(face.collectUnicodes()),
          gpos: face.getTableFeatureTags('GPOS'),
          gsub: face.getTableFeatureTags('GSUB'),
        } satisfies LoadedFont
      })

      const familyOf = Effect.fnUntraced(function* (folder: string) {
        const cached = families.get(folder)

        if (cached !== undefined) {
          return cached
        }

        const names = yield* fs
          .readDirectory(folder)
          .pipe(Effect.mapError(() => failed(`The font folder ${folder} could not be read.`)))

        const ofType = (extension: string) =>
          names
            .filter((name) => name.toLowerCase().endsWith(extension))
            .map((name): FontFile => ({ name, path: path.join(folder, name) }))

        const variants = fontVariants([...ofType('.ttf'), ...ofType('.otf')])

        if (variants.regular === undefined) {
          return yield* failed(`No font was found in ${folder}.`)
        }

        const regular = yield* loadFont(variants.regular.path)
        const family: Partial<Record<Style, LoadedFont>> & { regular: LoadedFont } = { regular }

        for (const style of ['italic', 'bold', 'bold_italic'] as const) {
          const file = variants[style]

          if (file !== undefined) {
            family[style] = yield* loadFont(file.path)
          }
        }

        families.set(folder, family)

        return family
      })

      const featuresOf = (font: LoadedFont) => [
        new hb.Feature('kern', font.gpos.includes('kern') ? 1 : 0),
        new hb.Feature('liga', 0),
        new hb.Feature('calt', font.gsub.includes('calt') ? 1 : 0),
      ]

      const shape = (
        font: LoadedFont,
        text: string,
        size: number,
        features: ReturnType<typeof featuresOf>,
      ) => {
        const hbFont = new hb.Font(font.face)
        const scale = Math.trunc(size * 64)

        hbFont.setScale(scale, scale)

        const buffer = new hb.Buffer()

        buffer.addText(text)
        buffer.guessSegmentProperties()
        hb.shape(hbFont, buffer, features)

        return { infos: buffer.getGlyphInfos(), positions: buffer.getGlyphPositions() }
      }

      const styleFont = (family: Family, style: Style) => {
        if (style === 'bold_italic') {
          return family.bold_italic ?? family.bold ?? family.italic ?? family.regular
        }

        return family[style] ?? family.regular
      }

      const measureOf = (family: Family, features: ReturnType<typeof featuresOf>): Measure => {
        const widths = new Map<string, number>()

        return {
          width: (line, size) => {
            const key = `${size}\u0000${line}`
            const cached = widths.get(key)

            if (cached !== undefined) {
              return cached
            }

            let advance = 0
            let first: number | undefined
            let last: number | undefined

            for (const [text, style] of parseStyledSegments(line)) {
              const { positions } = shape(family[style] ?? family.regular, text, size, features)

              if (positions.length === 0) {
                continue
              }

              advance += positions.reduce((total, position) => total + position.xAdvance, 0)
              first ??= positions[0]?.xOffset ?? 0
              last = positions.at(-1)?.xOffset ?? 0
            }

            const width = (advance + ((last ?? 0) - (first ?? 0))) / 64

            widths.set(key, width)

            return width
          },
          metrics: (size) => lineMetrics(family.regular.data, size),
        }
      }

      const textColourOf = (block: LetterBlock, options: LetterOptions) =>
        options.textColor ?? block.fg

      /** draw_layout on a BGRA copy of the supersampled crop. */
      const draw = (
        pixels: Uint8Array,
        width: number,
        height: number,
        layout: Layout,
        centreX: number,
        centreY: number,
        family: Family,
        features: ReturnType<typeof featuresOf>,
        colour: readonly [number, number, number],
        borderWidth: number,
        borderColour: readonly [number, number, number],
      ) => {
        const memory = canvasKit.Malloc(Uint8Array, width * height * 4)

        memory.toTypedArray().set(pixels)

        const surface = canvasKit.MakeRasterDirectSurface(
          {
            width,
            height,
            colorType: canvasKit.ColorType.BGRA_8888,
            alphaType: canvasKit.AlphaType.Premul,
            colorSpace: canvasKit.ColorSpace.SRGB,
          },
          memory,
          width * 4,
        )

        if (surface === null) {
          canvasKit.Free(memory)

          return pixels
        }

        const canvas = surface.getCanvas()
        const paint = new canvasKit.Paint()

        paint.setAntiAlias(true)
        paint.setColor(canvasKit.Color(colour[0], colour[1], colour[2], 1))

        const outline = borderWidth > 0 ? new canvasKit.Paint() : undefined

        if (outline !== undefined) {
          outline.setAntiAlias(true)
          outline.setColor(canvasKit.Color(borderColour[0], borderColour[1], borderColour[2], 1))
          outline.setStyle(canvasKit.PaintStyle.Stroke)
          outline.setStrokeWidth(borderWidth)
          outline.setStrokeJoin(canvasKit.StrokeJoin.Round)
        }

        const { metrics, lines, lineHeight, maxLineWidth, fontSize } = layout
        const blockLeft = centreX - maxLineWidth / 2
        const totalHeight = (lines.length - 1) * lineHeight - metrics.ascent + metrics.descent
        let baseline = centreY - totalHeight / 2 - metrics.ascent

        for (const line of lines) {
          let cursor = blockLeft + (maxLineWidth - line.width) / 2

          for (const [text, style] of parseStyledSegments(line.textWithMarkers)) {
            const font = styleFont(family, style)
            const { infos, positions } = shape(font, text, fontSize, features)

            if (infos.length === 0) {
              continue
            }

            const skFont = new canvasKit.Font(font.typeface, fontSize)

            skFont.setSubpixel(true)
            skFont.setHinting(canvasKit.FontHinting.None)

            const glyphs = infos.map((info) => info.codepoint)
            const points: Array<number> = []
            let advance = 0

            for (const position of positions) {
              points.push(
                cursor + advance + position.xOffset / 64,
                baseline - position.yOffset / 64,
              )

              advance += position.xAdvance / 64
            }

            if (outline !== undefined) {
              canvas.drawGlyphs(glyphs, points, 0, 0, skFont, outline)
            }

            canvas.drawGlyphs(glyphs, points, 0, 0, skFont, paint)
            skFont.delete()
            cursor += positions.reduce((total, position) => total + position.xAdvance, 0) / 64
          }

          baseline += lineHeight
        }

        surface.flush()

        const result = Uint8Array.from(memory.toTypedArray())

        paint.delete()
        outline?.delete()
        surface.delete()
        canvasKit.Free(memory)

        return result
      }

      const render = Effect.fn('Lettering.render')(function* (
        page: RgbImage,
        original: RgbImage,
        blocks: ReadonlyArray<LetterBlock>,
        options: LetterOptions,
      ) {
        const shown = blocks.filter((block) => block.region.translation.trim() !== '')

        if (shown.length === 0) {
          return page
        }

        const geometries = constrainGeometries(
          shown.map((block) => block.region),
          shown.map((block) => renderGeometry(cv, original, block.region)),
        )

        let result = page

        for (const [index, block] of shown.entries()) {
          const geometry = geometries[index]

          if (geometry === undefined) {
            continue
          }

          result = yield* letterBlock(result, block, geometry.box, geometry.mask, options)
        }

        return result
      })

      /** render_text_skia up to the layout: the text, its box, and the chosen size and lines. */
      const planBlock = Effect.fnUntraced(function* (
        block: LetterBlock,
        box: Box,
        mask: Uint8Array | undefined,
        options: LetterOptions,
        override?: LineBreaking,
      ) {
        const lettering = block.lettering
        const [x1, y1, x2, y2] = box
        const boxWidth = x2 - x1
        const boxHeight = y2 - y1

        if (boxWidth <= 0 || boxHeight <= 0) {
          return undefined
        }

        const uppercase = lettering?.uppercase ?? options.uppercase
        let translation = block.region.translation

        if (lettering?.breakMode !== 'manual') {
          translation = splitWords(translation).join(' ')
        }

        if (uppercase) {
          translation = translation.toUpperCase()
        }

        const text = splitLines(translation.replaceAll('—', '-'))
          .filter((line) => splitWords(line).length > 0)
          .map((line) => splitWords(line).join(' '))
          .join('\n')

        if (text === '') {
          return undefined
        }

        const family = yield* familyOf(lettering?.fontDir ?? options.fontDir)
        const regular = family.regular

        const layoutText = [...text]
          .filter(
            (character) =>
              character === '*' ||
              ' \t\n\r'.includes(character) ||
              regular.codepoints.has(character.codePointAt(0) ?? 0),
          )
          .join('')

        if (splitWords(layoutText).length === 0) {
          return undefined
        }

        const padding = lettering === undefined ? fallbackPadding : editorPadding

        const safe =
          mask === undefined ? undefined : safeArea(cv, mask, boxWidth, boxHeight, safePadding)

        let maxWidth: number
        let maxHeight: number
        let centreX: number
        let centreY: number

        if (safe === undefined) {
          maxWidth = boxWidth * (1 - 2 * padding)
          maxHeight = boxHeight * (1 - 2 * padding)

          if (maxWidth <= 0 || maxHeight <= 0) {
            maxWidth = Math.max(1, boxWidth)
            maxHeight = Math.max(1, boxHeight)
          }

          centreX = x1 + boxWidth / 2
          centreY = y1 + boxHeight / 2
        } else {
          const [sx, sy, sw, sh] = safe

          maxWidth = sw
          maxHeight = sh
          centreX = x1 + sx + sw / 2
          centreY = y1 + sy + sh / 2
        }

        const features = featuresOf(regular)
        const lineSpacing = lettering?.leading ?? 1
        const measure = measureOf(family, features)
        const size = lettering?.size

        const breaking: LineBreaking =
          override ??
          (lettering === undefined
            ? { mode: 'balanced', avoidOrphans: false, evenOut: false }
            : {
                mode: lettering.breakMode ?? 'balanced',
                avoidOrphans: lettering.avoidOrphans ?? true,
                evenOut: (lettering.breakMode ?? 'balanced') === 'balanced',
              })

        const layout = optimalLayout(
          layoutText,
          maxWidth,
          maxHeight,
          measure,
          {
            minFontSize: size ?? options.minFontSize,
            maxFontSize: size ?? options.maxFontSize,
            lineSpacing,
            hyphenate: lettering?.hyphenate ?? true,
            hyphenationMinWordLength: 8,
            forceFit: true,
            breaks: {
              style: breaking,
              badnessExponent: 3,
              hyphenPenalty: 1000,
              detachEllipsis: true,
            },
          },
          safe === undefined || mask === undefined
            ? undefined
            : {
                mask: { data: mask, width: boxWidth, height: boxHeight },
                left: safe[0],
                top: safe[1],
              },
          mask !== undefined,
        )

        return layout === undefined ? undefined : { layout, family, features, centreX, centreY }
      })

      const letterBlock = Effect.fnUntraced(function* (
        page: RgbImage,
        block: LetterBlock,
        box: Box,
        mask: Uint8Array | undefined,
        options: LetterOptions,
      ) {
        const [x1, y1, x2, y2] = box
        const plan = yield* planBlock(block, box, mask, options)

        if (plan === undefined) {
          return page
        }

        const { layout, family, features, centreX, centreY } = plan

        const cx1 = Math.max(0, x1)
        const cy1 = Math.max(0, y1)
        const cx2 = Math.min(page.width, x2)
        const cy2 = Math.min(page.height, y2)
        const cropWidth = cx2 - cx1
        const cropHeight = cy2 - cy1
        const factor = Math.max(1, options.supersampling)
        const region = crop(page, cx1, cy1, cx2, cy2)

        const large =
          factor === 1
            ? region
            : pillowResize(
                region,
                Math.trunc(cropWidth * factor),
                Math.trunc(cropHeight * factor),
                'lanczos',
              )

        const bgra = new Uint8Array(large.width * large.height * 4)

        for (let p = 0; p < large.width * large.height; p += 1) {
          bgra[p * 4] = large.data[p * 3 + 2] ?? 0
          bgra[p * 4 + 1] = large.data[p * 3 + 1] ?? 0
          bgra[p * 4 + 2] = large.data[p * 3] ?? 0
          bgra[p * 4 + 3] = 255
        }

        const scaledMetrics: LineMetrics = {
          ascent: layout.metrics.ascent * factor,
          descent: layout.metrics.descent * factor,
          leading: layout.metrics.leading * factor,
        }

        const drawn = draw(
          bgra,
          large.width,
          large.height,
          {
            fontSize: layout.fontSize * factor,
            lines: layout.lines.map((line) => ({ ...line, width: line.width * factor })),
            metrics: scaledMetrics,
            maxLineWidth: layout.maxLineWidth * factor,
            lineHeight: layout.lineHeight * factor,
          },
          (centreX - cx1) * factor,
          (centreY - cy1) * factor,
          family,
          features,
          textColourOf(block, options),
          options.border ? defaultBorderWidth * factor : 0,
          options.borderColor,
        )

        const rgb = new Uint8Array(large.width * large.height * 3)

        for (let p = 0; p < large.width * large.height; p += 1) {
          rgb[p * 3] = drawn[p * 4 + 2] ?? 0
          rgb[p * 3 + 1] = drawn[p * 4 + 1] ?? 0
          rgb[p * 3 + 2] = drawn[p * 4] ?? 0
        }

        const small =
          factor === 1
            ? { width: large.width, height: large.height, data: rgb }
            : pillowResize(
                { width: large.width, height: large.height, data: rgb },
                cropWidth,
                cropHeight,
                'lanczos',
              )

        const data = Uint8Array.from(page.data)

        for (let row = 0; row < cropHeight; row += 1) {
          data.set(
            small.data.subarray(row * cropWidth * 3, (row + 1) * cropWidth * 3),
            ((cy1 + row) * page.width + cx1) * 3,
          )
        }

        return { width: page.width, height: page.height, data }
      })

      /** layout_candidates: balanced, greedy, and balanced in a box 10% narrower on each side. */
      const breaks = Effect.fn('Lettering.breaks')(function* (
        original: RgbImage,
        block: LetterBlock,
        options: LetterOptions,
      ) {
        const { box } = renderGeometry(cv, original, block.region)
        const [x1, y1, x2, y2] = box
        const narrow = Math.trunc((x2 - x1) * 0.1)
        const avoidOrphans = block.lettering?.avoidOrphans ?? true

        const candidates: Array<{
          readonly lines: ReadonlyArray<string>
          readonly fontSize: number
        }> = []

        const tries = [
          ['balanced', box],
          ['greedy', box],
          ['balanced', [x1 + narrow, y1, x2 - narrow, y2] as const],
        ] as const

        for (const [mode, tried] of tries) {
          const plan = yield* planBlock(block, tried, undefined, options, {
            mode,
            avoidOrphans,
            evenOut: mode === 'balanced',
          })

          const lines = plan?.layout.lines.map((line) => line.textWithMarkers) ?? []

          if (
            plan !== undefined &&
            lines.length > 0 &&
            candidates.every((candidate) => candidate.lines.join('\n') !== lines.join('\n'))
          ) {
            candidates.push({ lines, fontSize: Math.trunc(plan.layout.fontSize) })
          }
        }

        return candidates
      })

      return Lettering.of({ render, breaks })
    }),
  )
}
