import type { LineChange, LineOrigin, TranslationLine } from '#contract/GameTranslation'
import type { TextEntry } from '../rpgmaker/TextEntries'

export type StoredSource = Pick<
  TranslationLine,
  | 'entryId'
  | 'file'
  | 'sourceText'
  | 'translatedText'
  | 'origin'
  | 'locked'
  | 'applied'
  | 'writeSkipped'
  | 'change'
  | 'previousSource'
  | 'previousText'
>

export interface DiffedLine {
  readonly entry: TextEntry
  readonly translatedText?: string | undefined
  readonly origin: LineOrigin
  readonly locked: boolean
  readonly applied: boolean
  readonly change?: LineChange
  readonly previousSource?: string
  readonly previousText?: string
  readonly from?: StoredSource
}

export interface DiffCounts {
  readonly unchanged: number
  readonly moved: number
  readonly changed: number
  readonly added: number
  readonly removed: number
}

const kept = (entry: TextEntry, line: StoredSource): DiffedLine => ({
  entry,
  ...(line.translatedText === undefined ? {} : { translatedText: line.translatedText }),
  origin: line.origin,
  locked: line.locked,
  applied: line.applied,
  from: line,
})

const changed = (entry: TextEntry, line: StoredSource): DiffedLine => {
  if (
    line.translatedText === undefined &&
    line.previousSource === entry.src &&
    line.previousText !== undefined
  ) {
    return {
      entry,
      translatedText: line.previousText,
      origin: line.origin,
      locked: line.locked,
      applied: false,
      change: 'changed',
      previousSource: line.sourceText,
    }
  }

  return reworded(entry, line)
}

const reworded = (entry: TextEntry, line: StoredSource): DiffedLine => ({
  entry,
  ...(line.locked && line.translatedText !== undefined
    ? { translatedText: line.translatedText }
    : {}),
  origin: line.locked ? line.origin : 'model',
  locked: line.locked,
  applied: false,
  change: 'changed',
  previousSource: line.sourceText,
  ...(line.translatedText === undefined ? {} : { previousText: line.translatedText }),
})

const pairsOf = (text: string) =>
  new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, at) => text.slice(at, at + 2)))

const similarity = (left: string, right: string) => {
  const leftPairs = pairsOf(left)
  const rightPairs = pairsOf(right)
  const shared = [...leftPairs].filter((pair) => rightPairs.has(pair)).length

  return leftPairs.size + rightPairs.size === 0
    ? 0
    : (2 * shared) / (leftPairs.size + rightPairs.size)
}

export const diffSources = <S extends StoredSource>(
  stored: ReadonlyArray<S>,
  entries: ReadonlyArray<TextEntry>,
) => {
  const byId = new Map(stored.map((line) => [line.entryId, line]))
  const used = new Set<string>()
  const result: Array<DiffedLine | undefined> = Array.from({ length: entries.length })
  let moved = 0
  let changes = 0
  let added = 0

  entries.forEach((entry, index) => {
    const line = byId.get(entry.id)

    if (line !== undefined && line.sourceText === entry.src) {
      used.add(line.entryId)
      result[index] = kept(entry, line)
    }
  })

  const byText = Map.groupBy(
    stored.filter((line) => !used.has(line.entryId)),
    (line) => line.sourceText,
  )

  entries.forEach((entry, index) => {
    if (result[index] !== undefined) {
      return
    }

    const candidates = (byText.get(entry.src) ?? []).filter((line) => !used.has(line.entryId))
    const line = candidates.find((candidate) => candidate.file === entry.file) ?? candidates[0]

    if (line !== undefined) {
      used.add(line.entryId)
      moved++
      result[index] = kept(entry, line)
    }
  })

  const storedByFile = Map.groupBy(stored, (line) => line.file)

  const positions = new Map(
    [...storedByFile.values()].flatMap((fileLines) =>
      fileLines.map((line, position) => [line.entryId, position] as const),
    ),
  )

  const cursors = new Map<string, number>()

  const lines = entries.map((entry, index) => {
    const found = result[index]
    const fileLines = storedByFile.get(entry.file) ?? []

    if (found !== undefined) {
      if (found.from !== undefined && found.from.file === entry.file) {
        cursors.set(entry.file, (positions.get(found.from.entryId) ?? -1) + 1)
      }

      return found
    }

    const at = cursors.get(entry.file) ?? 0
    const following = fileLines[at + 1]

    const removedBefore =
      fileLines[at] !== undefined &&
      following !== undefined &&
      !used.has(following.entryId) &&
      similarity(entry.src, following.sourceText) >
        similarity(entry.src, fileLines[at]?.sourceText ?? '')

    const position = removedBefore ? at + 1 : at
    const line = fileLines[position]
    const next = entries[index + 1]

    const insertedBefore =
      line !== undefined &&
      next !== undefined &&
      next.file === entry.file &&
      result[index + 1] === undefined &&
      similarity(next.src, line.sourceText) > similarity(entry.src, line.sourceText)

    if (line !== undefined && !used.has(line.entryId) && !insertedBefore) {
      used.add(line.entryId)
      cursors.set(entry.file, position + 1)
      changes++

      return changed(entry, line)
    }

    added++

    return { entry, origin: 'model', locked: false, applied: false, change: 'new' } as const
  })

  const counts: DiffCounts = {
    unchanged: entries.length - moved - changes - added,
    moved,
    changed: changes,
    added,
    removed: stored.length - used.size,
  }

  return { lines, counts, removed: stored.filter((line) => !used.has(line.entryId)) }
}

export const pendingOf = (
  diff: { readonly lines: ReadonlyArray<DiffedLine>; readonly counts: DiffCounts },
  scope: 'missing' | 'changed',
): ReadonlySet<string> => {
  const updated = diff.counts.changed > 0 || diff.counts.added > 0 || diff.counts.removed > 0

  return new Set(
    diff.lines
      .filter((line) => {
        const change = updated ? line.change : line.from?.change

        return line.translatedText === undefined && (scope === 'missing' || change !== undefined)
      })
      .map((line) => line.entry.id),
  )
}
