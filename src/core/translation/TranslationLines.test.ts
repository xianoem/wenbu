import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import type { TranslationLine } from '#contract/GameTranslation'
import type { TextEntry } from '../rpgmaker/TextEntries'
import type { TextLocation } from '../rpgmaker/TextLocations'
import * as Database from '../platform/Database'
import { appliedTranslations, TranslationLines } from './TranslationLines'

const TestLayer = TranslationLines.layer.pipe(
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provideMerge(NodeServices.layer),
)

const addGame = Effect.fn(function* (id: string) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO games ${sql.insert({
    id,
    title: id,
    folder_path: `C:\\Games\\${id}`,
    folder_key: id,
    executable_path: `C:\\Games\\${id}\\Game.exe`,
    engine: 'rpg-maker-mv',
    size_bytes: 1,
    translation: 'original',
    added_at: '2026-10-25T00:00:00Z',
  })}`
})

const entry = (pointer: string, src: string, extraPointers?: ReadonlyArray<string>): TextEntry => ({
  id: `Map001.json::${pointer}`,
  file: 'Map001.json',
  pointer,
  src,
  dst: '',
  context: 'Show Text',
  ...(extraPointers === undefined ? {} : { extraPointers }),
})

const hello = entry('/events/1/0', 'こんにちは')
const bye = entry('/events/1/1', 'さようなら')

const translationsOf = (lines: ReadonlyArray<TranslationLine>) =>
  lines.map((line) => [line.entryId, line.translatedText])

describe('TranslationLines', () => {
  it.effect('stores model translations and keeps edited and locked lines', () =>
    Effect.gen(function* () {
      const store = yield* TranslationLines

      yield* addGame('game')
      yield* store.reconcile('game', [hello, bye])

      yield* store.saveTranslations('game', [
        { entryId: hello.id, text: 'Hello' },
        { entryId: bye.id, text: 'Bye' },
      ])

      yield* store.edit('game', hello.id, 'Hi there')
      yield* store.setLocked('game', bye.id, true)

      yield* store.saveTranslations('game', [
        { entryId: hello.id, text: 'Hello again' },
        { entryId: bye.id, text: 'Goodbye' },
      ])

      const lines = yield* store.lines('game')

      expect(translationsOf(lines)).toEqual([
        [hello.id, 'Hi there'],
        [bye.id, 'Bye'],
      ])

      expect(lines.map((line) => [line.origin, line.locked])).toEqual([
        ['edited', false],
        ['model', true],
      ])

      expect([...(yield* store.pending('game', 'missing'))]).toEqual([])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('marks what a game update changed until the next update', () =>
    Effect.gen(function* () {
      const store = yield* TranslationLines

      yield* addGame('game')
      yield* store.reconcile('game', [hello, bye])

      const first = yield* store.lines('game')

      yield* store.saveTranslations('game', [
        { entryId: hello.id, text: 'Hello' },
        { entryId: bye.id, text: 'Bye' },
      ])

      const counts = yield* store.reconcile('game', [{ ...hello, src: 'こんばんは' }])
      const marked = (yield* store.lines('game'))[0]

      expect(first.map((line) => line.change)).toEqual([undefined, undefined])
      expect(counts).toMatchObject({ changed: 1, removed: 1 })

      expect(marked).toMatchObject({
        sourceText: 'こんばんは',
        change: 'changed',
        previousSource: 'こんにちは',
        previousText: 'Hello',
      })

      expect(marked?.translatedText).toBeUndefined()
      expect([...(yield* store.pending('game', 'changed'))]).toEqual([hello.id])

      yield* store.saveTranslations('game', [{ entryId: hello.id, text: 'Good evening' }])
      yield* store.reconcile('game', [{ ...hello, src: 'こんばんは' }])

      expect((yield* store.lines('game'))[0]).toMatchObject({
        translatedText: 'Good evening',
        change: 'changed',
      })
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('scopes a run to the lines it should translate', () =>
    Effect.gen(function* () {
      const store = yield* TranslationLines
      const added = entry('/events/1/2', 'ありがとう')

      yield* addGame('game')
      yield* store.reconcile('game', [hello, bye])
      yield* store.saveTranslations('game', [{ entryId: hello.id, text: 'Hello' }])
      yield* store.reconcile('game', [hello, bye, added])

      expect([...(yield* store.pending('game', 'missing'))]).toEqual([bye.id, added.id])
      expect([...(yield* store.pending('game', 'changed'))]).toEqual([added.id])
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('tracks which translations are in the game files', () =>
    Effect.gen(function* () {
      const store = yield* TranslationLines

      yield* addGame('game')
      yield* store.reconcile('game', [hello])
      yield* store.saveTranslations('game', [{ entryId: hello.id, text: 'Hello' }])

      const before = yield* store.lines('game')

      yield* store.markApplied('game', [hello.id])

      const applied = yield* store.lines('game')

      yield* store.edit('game', hello.id, 'Hi')

      expect(
        [before, applied, yield* store.lines('game')].map((lines) => lines[0]?.applied),
      ).toEqual([false, true, false])

      expect(yield* store.translations('game')).toEqual(new Map([[hello.id, 'Hi']]))
    }).pipe(Effect.provide(TestLayer)),
  )
})

describe('appliedTranslations', () => {
  const at = (pointer: string, value: string): TextLocation => ({
    file: 'Map001.json',
    pointer,
    context: 'Show Text',
    value,
    coverage: ['messages', 'mapEvents'],
  })

  it('counts Latin text the translation kept as it was as translated', () => {
    const gps = entry('/events/4/0', 'GPS')
    const kana = entry('/events/5/0', 'カナ')

    expect(
      appliedTranslations([gps, kana], [at(gps.pointer, 'GPS'), at(kana.pointer, 'カナ')]),
    ).toEqual([{ entryId: gps.id, text: 'GPS' }])
  })

  it('reads what a game translated before lines were stored', () => {
    const window = entry('/events/2/0', '一行目\n二行目', ['/events/2/1'])
    const exclaim = entry('/events/3/0', '!?\n本当に？', ['/events/3/1'])

    const current = [
      at(hello.pointer, 'Hello'),
      at(bye.pointer, 'さようなら'),
      at('/events/2/0', 'First line\n'),
      at('/events/3/0', '!?\nReally?'),
    ]

    expect(appliedTranslations([hello, bye, window, exclaim], current)).toEqual([
      { entryId: hello.id, text: 'Hello' },
      { entryId: window.id, text: 'First line' },
      { entryId: exclaim.id, text: '!?\nReally?' },
    ])
  })
})
