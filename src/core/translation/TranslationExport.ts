import type { TranslationLine } from '#contract/GameTranslation'
import { engineLabels, type GameEngine } from '#contract/Library'

export interface ExportedGame {
  readonly title: string
  readonly engine: GameEngine
  readonly targetLanguage: string
  readonly version: string | undefined
}

const translated = (lines: ReadonlyArray<TranslationLine>) =>
  lines.flatMap((line) =>
    line.translatedText === undefined ? [] : [{ ...line, translatedText: line.translatedText }],
  )

const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`

// The byte order mark and CRLF rows make Excel open Japanese text correctly.
export const csvOf = (lines: ReadonlyArray<TranslationLine>) => {
  const rows = translated(lines).map((line) =>
    [line.file, line.context, line.sourceText, line.translatedText].map(csvField).join(','),
  )

  return `﻿${['File,Location,Original,Translation', ...rows].join('\r\n')}\r\n`
}

export const jsonOf = (game: ExportedGame, lines: ReadonlyArray<TranslationLine>) => ({
  format: 'wenbu-translation',
  formatVersion: 1,
  game: {
    title: game.title,
    engine: game.engine,
    ...(game.version === undefined ? {} : { version: game.version }),
  },
  targetLanguage: game.targetLanguage,
  lines: translated(lines).map((line) => ({
    file: line.file,
    pointer: line.pointer,
    location: line.context,
    original: line.sourceText,
    translation: line.translatedText,
  })),
})

// MTool may key a message by its whole text or by each line, so both are written.
export const mtoolOf = (lines: ReadonlyArray<TranslationLine>) => {
  const pairs: Record<string, string> = {}

  const add = (original: string, translation: string) => {
    if (original.trim() !== '' && !Object.hasOwn(pairs, original)) {
      pairs[original] = translation
    }
  }

  for (const line of translated(lines)) {
    add(line.sourceText, line.translatedText)

    const originals = line.sourceText.split('\n')
    const translations = line.translatedText.split('\n')

    if (originals.length > 1 && originals.length === translations.length) {
      originals.forEach((original, index) => add(original, translations[index] ?? ''))
    }
  }

  return pairs
}

export const translatedCount = (lines: ReadonlyArray<TranslationLine>) => translated(lines).length

export const readmeOf = (game: ExportedGame, dataFolder: string, files: number, madeOn: string) =>
  [
    `${game.title} — ${game.targetLanguage} translation`,
    '',
    `Game: ${game.title} (${engineLabels[game.engine]})${game.version === undefined ? '' : `, version ${game.version}`}`,
    `Made on ${madeOn}. ${files} data ${files === 1 ? 'file' : 'files'}.`,
    '',
    'How to install',
    `1. Back up the game's ${dataFolder} folder.`,
    `2. Copy the ${dataFolder.split('/')[0]} folder from this zip into the game's folder, next to Game.exe.`,
    '3. Let it replace the files with the same names.',
    '',
    'The patch only holds the files whose text was translated. It is made for this version of',
    'the game; after a game update, ask for a new patch.',
    '',
  ].join('\r\n')
