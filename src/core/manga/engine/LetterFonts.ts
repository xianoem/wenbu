import type { Style } from './LineBreaking'

/**
 * Fonts as the lettering loads them (wenbu_manga/skia/font_manager.py): which file in a folder is the
 * regular, bold and italic face, and the plugin's clean-up of the font data before shaping and drawing.
 */

const keywords = {
  bold: ['bold', 'heavy', 'black'],
  italic: ['italic', 'oblique', 'slanted', 'inclined'],
  regular: ['regular', 'normal', 'roman', 'medium'],
} as const

const specific = [
  'light',
  'thin',
  'condensed',
  'expanded',
  'semi',
  'demi',
  'extra',
  'ultra',
  'book',
  'medium',
  'black',
  'heavy',
]

export interface FontFile {
  /** The file name with its extension. */
  readonly name: string
  readonly path: string
}

const stemOf = (name: string) => name.replace(/\.[^.]*$/u, '').toLowerCase()

const has = (stem: string, words: ReadonlyArray<string>) =>
  words.some((word) => stem.includes(word))

/**
 * find_font_variants: `files` are the folder's .ttf then .otf files in directory order. Longer names are
 * tried first, so "Font Bold Italic" is not taken for "Font Bold".
 */
export const fontVariants = (files: ReadonlyArray<FontFile>): Partial<Record<Style, FontFile>> => {
  const ordered = files.toSorted((a, b) => b.name.length - a.name.length)
  const found: Partial<Record<Style, FontFile>> = {}
  const taken = new Set<FontFile>()

  const take = (style: Style, file: FontFile) => {
    found[style] = file
    taken.add(file)
  }

  for (const file of ordered) {
    const stem = stemOf(file.name)

    if (
      !taken.has(file) &&
      has(stem, keywords.bold) &&
      has(stem, keywords.italic) &&
      found.bold_italic === undefined
    ) {
      take('bold_italic', file)
    }
  }

  for (const file of ordered) {
    const stem = stemOf(file.name)
    const bold = has(stem, keywords.bold)
    const italic = has(stem, keywords.italic)

    if (taken.has(file)) {
      continue
    }

    if (bold && !italic && found.bold === undefined) {
      take('bold', file)
    } else if (italic && !bold && found.italic === undefined) {
      take('italic', file)
    }
  }

  for (const file of ordered) {
    const stem = stemOf(file.name)

    if (
      !taken.has(file) &&
      has(stem, keywords.regular) &&
      !has(stem, keywords.bold) &&
      !has(stem, keywords.italic) &&
      found.regular === undefined
    ) {
      take('regular', file)
    }
  }

  if (found.regular === undefined) {
    const plain = ordered.find((file) => {
      const stem = stemOf(file.name)

      return (
        !taken.has(file) &&
        !has(stem, keywords.bold) &&
        !has(stem, keywords.italic) &&
        !has(stem, keywords.regular) &&
        !has(file.name.toLowerCase(), specific)
      )
    })

    if (plain !== undefined) {
      take('regular', plain)
    }
  }

  if (found.regular === undefined) {
    const first = ordered.find((file) => !taken.has(file))

    if (first !== undefined) {
      take('regular', first)
    }
  }

  if (found.regular === undefined) {
    const backup = found.bold ?? found.italic ?? found.bold_italic ?? ordered[0]

    if (backup !== undefined) {
      found.regular = backup
    }
  }

  return found
}

interface TableEntry {
  readonly tag: string
  readonly offset: number
  readonly length: number
  readonly record: number
}

const tablesOf = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(4)
  const tables: Array<TableEntry> = []

  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16

    tables.push({
      tag: String.fromCharCode(...data.subarray(record, record + 4)),
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
      record,
    })
  }

  return tables
}

/** A copy of the font with the table directory entry for `tag` left out; table data stays where it was. */
const withoutTable = (data: Uint8Array, tag: string) => {
  const tables = tablesOf(data)
  const kept = tables.filter((table) => table.tag !== tag)
  const out = Uint8Array.from(data)
  const view = new DataView(out.buffer)
  const power = 2 ** Math.floor(Math.log2(Math.max(1, kept.length)))

  view.setUint16(4, kept.length)
  view.setUint16(6, power * 16)
  view.setUint16(8, Math.log2(power))
  view.setUint16(10, kept.length * 16 - power * 16)

  kept.forEach((table, index) => {
    out.set(data.subarray(table.record, table.record + 16), 12 + index * 16)
  })

  return out
}

export interface GlyphMetrics {
  /** The glyph for "M" in the best cmap, if the font has one. */
  readonly glyphOfM: number | undefined
  /** That glyph's right edge and advance, in font units. */
  readonly xMax: (glyph: number) => number | undefined
  readonly advance: (glyph: number) => number
}

/**
 * sanitize_font_data: the plugin drops the legacy `kern` table (its check reads an attribute fontTools
 * does not have, so every `kern` table counts as corrupt), and sets 1000 units per em when "M" draws
 * past its advance, which some fonts get wrong.
 */
export const sanitizedFont = (data: Uint8Array, metrics: GlyphMetrics) => {
  const tables = tablesOf(data)
  const head = tables.find((table) => table.tag === 'head')
  let out = tables.some((table) => table.tag === 'kern') ? withoutTable(data, 'kern') : data

  if (
    head === undefined ||
    metrics.glyphOfM === undefined ||
    !tables.some((table) => table.tag === 'glyf')
  ) {
    return out
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const italic = (view.getUint16(head.offset + 44) & 0b10) !== 0
  const xMax = metrics.xMax(metrics.glyphOfM)

  if (xMax !== undefined && xMax > metrics.advance(metrics.glyphOfM) * (italic ? 1.3 : 1)) {
    out = out === data ? Uint8Array.from(data) : out
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(head.offset + 18, 1000)
  }

  return out
}

export interface LineMetrics {
  /** Negative, above the baseline. */
  readonly ascent: number
  readonly descent: number
  readonly leading: number
}

/**
 * Line metrics as Skia reports them through DirectWrite on Windows, where the plugin runs: the OS/2
 * table's Windows ascent and descent, or its typographic values when the font asks for them, and no
 * line gap for the Windows values.
 */
export const lineMetrics = (data: Uint8Array, size: number): LineMetrics => {
  const tables = tablesOf(data)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const head = tables.find((table) => table.tag === 'head')
  const os2 = tables.find((table) => table.tag === 'OS/2')
  const hhea = tables.find((table) => table.tag === 'hhea')
  const unitsPerEm = head === undefined ? 1000 : view.getUint16(head.offset + 18)
  const f = Math.fround
  const scaled = (units: number) => f(f(size * units) / unitsPerEm)

  if (os2 !== undefined) {
    const useTypo = (view.getUint16(os2.offset + 62) & 0x80) !== 0

    if (useTypo) {
      return {
        ascent: -scaled(view.getInt16(os2.offset + 68)),
        descent: scaled(-view.getInt16(os2.offset + 70)),
        leading: scaled(view.getInt16(os2.offset + 72)),
      }
    }

    return {
      ascent: -scaled(view.getUint16(os2.offset + 74)),
      descent: scaled(view.getUint16(os2.offset + 76)),
      leading: 0,
    }
  }

  if (hhea === undefined) {
    return { ascent: -size, descent: 0, leading: 0 }
  }

  return {
    ascent: -scaled(view.getInt16(hhea.offset + 4)),
    descent: scaled(-view.getInt16(hhea.offset + 6)),
    leading: scaled(view.getInt16(hhea.offset + 8)),
  }
}
