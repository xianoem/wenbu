import { Predicate } from 'effect'
import type { TranslationSettings } from '#contract/GameTranslation'
import { noProtectedText, type ProtectedText, protectionOf } from './ProtectedText'
import type { TextLocation } from './TextLocations'

export interface TextEntry {
  readonly id: string
  readonly file: string
  readonly pointer: string
  readonly src: string
  readonly dst: string
  readonly context: string
  readonly extraPointers?: ReadonlyArray<string>
}

export interface TranslationItem {
  readonly id: string
  readonly src: string
  readonly context: string
  readonly entryIds: ReadonlyArray<string>
}

export type SkipReason =
  | 'coverage-disabled'
  | 'non-string'
  | 'empty'
  | 'plugin-tag'
  | 'filename'
  | 'number'
  | 'punctuation'
  | 'code-like'
  | 'latin-text'
  | 'used-by-code'
  | 'asset-name'
  | 'control-codes'

export interface PreparedEntries {
  readonly entries: ReadonlyArray<TextEntry>
  readonly items: ReadonlyArray<TranslationItem>
  readonly skipped: ReadonlyMap<SkipReason, number>
}

export const hasCjkOrKorean = (text: string) => /[぀-ヿ㐀-鿿가-힯]/.test(text)

const isPluginTag = (text: string) => /^<[^>]+>$/.test(text)

const isFilename = (text: string) =>
  /^[\w .-]+\.(?:png|jpe?g|webp|ogg|m4a|mp3|wav|json|js)$/i.test(text)

const isNumber = (text: string) => /^[-+]?\d+(?:\.\d+)?$/.test(text)

const isPunctuation = (text: string) => !/[A-Za-z0-9぀-ヿ㐀-鿿가-힯]/.test(text)

const isControlCodesOnly = (text: string) =>
  text.replace(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z{}.|!><^$]/g, '').trim() === ''

const isCodeLike = (text: string) => /^(?:true|false|null|none|auto|undefined)$/i.test(text)

const skipReasonOf = (
  text: string,
  filters: TranslationSettings['filters'],
): SkipReason | undefined => {
  const trimmed = text.trim()

  const checks: ReadonlyArray<readonly [boolean, SkipReason]> = [
    [filters.skipEmpty && trimmed === '', 'empty'],
    [trimmed !== '' && isControlCodesOnly(trimmed), 'control-codes'],
    [filters.skipPluginTags && isPluginTag(trimmed), 'plugin-tag'],
    [filters.skipFilenames && isFilename(trimmed), 'filename'],
    [filters.skipNumbers && isNumber(trimmed), 'number'],
    [filters.skipPunctuationOnly && isPunctuation(trimmed), 'punctuation'],
    [filters.skipCodeLike && isCodeLike(trimmed), 'code-like'],
    [!filters.includeLatinText && !hasCjkOrKorean(trimmed), 'latin-text'],
  ]

  return checks.find(([applies]) => applies)?.[1]
}

const itemsOf = (entries: ReadonlyArray<TextEntry>, reuseDuplicates: boolean) => {
  if (!reuseDuplicates) {
    return entries.map((entry) => ({
      id: entry.id,
      src: entry.src,
      context: entry.context,
      entryIds: [entry.id],
    }))
  }

  const bySource = new Map<string, TranslationItem>()

  for (const entry of entries) {
    const existing = bySource.get(entry.src)

    bySource.set(
      entry.src,
      existing === undefined
        ? { id: entry.id, src: entry.src, context: entry.context, entryIds: [entry.id] }
        : { ...existing, entryIds: [...existing.entryIds, entry.id] },
    )
  }

  return [...bySource.values()]
}

export const prepareEntries = (
  locations: ReadonlyArray<TextLocation>,
  settings: TranslationSettings,
  protection: ProtectedText = noProtectedText,
): PreparedEntries => {
  const entries: Array<TextEntry> = []
  const skipped = new Map<SkipReason, number>()

  const skip = (reason: SkipReason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)

  for (const location of locations) {
    if (!location.coverage.every((key) => settings.coverage[key])) {
      skip('coverage-disabled')
      continue
    }

    if (!Predicate.isString(location.value)) {
      skip('non-string')
      continue
    }

    const reason =
      skipReasonOf(location.value, settings.filters) ??
      protectionOf(location.value, location.coverage, protection)

    if (reason !== undefined) {
      skip(reason)
      continue
    }

    entries.push({
      id: `${location.file}::${location.pointer}`,
      file: location.file,
      pointer: location.pointer,
      src: location.value,
      dst: '',
      context: location.context,
      ...(location.extraPointers === undefined ? {} : { extraPointers: location.extraPointers }),
    })
  }

  return { entries, items: itemsOf(entries, settings.reuseDuplicates), skipped }
}
