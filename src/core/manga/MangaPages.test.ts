import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { isValidFolderName, listPages } from './MangaPages'

const withFolder = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const folder = yield* fs.makeTempDirectoryScoped()

    for (const file of files) {
      yield* fs.makeDirectory(path.dirname(path.join(folder, file)), { recursive: true })
      yield* fs.writeFileString(path.join(folder, file), '')
    }

    return folder
  })

const settings = { outputFolderName: 'translated', outputFormat: 'source' } as const

describe('listPages', () => {
  it.effect('lists pages in reading order, including subfolders', () =>
    Effect.gen(function* () {
      const folder = yield* withFolder(['10.jpg', '2.jpg', '1.png', 'notes.txt', 'ch2/1.webp'])
      const { pages } = yield* listPages(folder, settings)

      expect(pages.map((page) => page.name)).toEqual(['1.png', '2.jpg', '10.jpg', 'ch2/1.webp'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('leaves out the output folder and notices pages already translated', () =>
    Effect.gen(function* () {
      const folder = yield* withFolder(['1.jpg', '2.jpg', 'translated/1.jpg'])
      const { pages } = yield* listPages(folder, settings)

      expect(pages.map((page) => [page.name, page.translated])).toEqual([
        ['1.jpg', true],
        ['2.jpg', false],
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("leaves out the manga editor's output", () =>
    Effect.gen(function* () {
      const folder = yield* withFolder([
        '1.jpg',
        'editor-output/1.png',
        'editor-output/cleaned/1.png',
      ])

      const { pages } = yield* listPages(folder, settings)

      expect(pages.map((page) => page.name)).toEqual(['1.jpg'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('names outputs after the chosen format', () =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const folder = yield* withFolder(['a.jpg', 'b.bmp'])
      const png = yield* listPages(folder, { ...settings, outputFormat: 'png' })
      const kept = yield* listPages(folder, settings)

      expect(png.pages.map((page) => path.basename(page.output))).toEqual(['a.png', 'b.png'])
      expect(kept.pages.map((page) => path.basename(page.output))).toEqual(['a.jpg', 'b.png'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('fails for a folder that does not exist', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(listPages('Z:/no/such/folder', settings))

      expect(error.reason).toBe('not-found')
    }).pipe(Effect.provide(NodeServices.layer)),
  )
})

describe('isValidFolderName', () => {
  it('refuses paths and reserved characters', () => {
    expect(isValidFolderName('translated')).toBe(true)
    expect(isValidFolderName('a/b')).toBe(false)
    expect(isValidFolderName('..')).toBe(false)
    expect(isValidFolderName(' ')).toBe(false)
  })
})
