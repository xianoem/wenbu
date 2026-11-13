import { Predicate } from 'effect'
import type { CoverageKey } from '#contract/GameTranslation'
import { isDataArray, isDataObject, type RpgData } from './RpgData'

export interface ProtectedText {
  readonly codeNames: ReadonlySet<string>
  readonly assetNames: ReadonlySet<string>
}

export const noProtectedText: ProtectedText = { codeNames: new Set(), assetNames: new Set() }

const CJK_RUN = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿ｦ-ﾟ々〆ー]+/g

const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g

// `//` after a colon is a URL, not a comment.
const LINE_COMMENT = /(^|[^:\\])\/\/.*$/gm

const LONGEST_NAME = 40

export const codeNamesOf = (sources: ReadonlyArray<string>) => {
  const names = new Set<string>()

  for (const source of sources) {
    const code = source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '$1')

    for (const run of code.match(CJK_RUN) ?? []) {
      names.add(run)
    }

    for (const literal of code.matchAll(STRING_LITERAL)) {
      const text = literal[2]?.trim() ?? ''

      if (text.length <= LONGEST_NAME && /[぀-ヿ㐀-鿿]/.test(text)) {
        names.add(text)
      }
    }
  }

  return names
}

const SCRIPT_CODES = new Set([355, 655])

export const eventScriptsOf = (data: RpgData) => {
  const scripts: Array<string> = []

  const visit = (node: RpgData) => {
    if (isDataArray(node)) {
      for (const child of node) {
        visit(child)
      }

      return
    }

    if (!isDataObject(node)) {
      return
    }

    const code = node['code']
    const parameters = node['parameters']

    if (Predicate.isNumber(code) && isDataArray(parameters)) {
      const script = code === 111 && parameters[0] === 12 ? parameters[1] : parameters[0]

      if (
        (SCRIPT_CODES.has(code) || (code === 111 && parameters[0] === 12)) &&
        Predicate.isString(script)
      ) {
        scripts.push(script)
      }

      return
    }

    for (const child of Object.values(node)) {
      visit(child)
    }
  }

  visit(data)

  return scripts
}

export const assetNameOf = (file: string) =>
  (file.split(/[\\/]/).at(-1) ?? '').replace(/\.[A-Za-z0-9_]+$/, '').toLowerCase()

const databaseCoverage = new Set<CoverageKey>([
  'actors',
  'classes',
  'skills',
  'items',
  'weapons',
  'armors',
  'enemies',
  'states',
  'systemTerms',
])

export const protectionOf = (
  text: string,
  coverage: ReadonlyArray<CoverageKey>,
  protection: ProtectedText,
) => {
  const trimmed = text.trim()

  if (trimmed.length > LONGEST_NAME || trimmed.includes('\n')) {
    return undefined
  }

  const database = coverage.some((key) => databaseCoverage.has(key))

  if (database && protection.codeNames.has(trimmed)) {
    return 'used-by-code' as const
  }

  if (protection.assetNames.has(trimmed.toLowerCase())) {
    return 'asset-name' as const
  }

  return undefined
}
