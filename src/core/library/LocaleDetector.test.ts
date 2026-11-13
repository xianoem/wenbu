import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { isJapaneseProgram, LocaleDetector } from './LocaleDetector'
import { ansiWindow, english, japanese, program } from './TestGames'

const unicodeWindow = ansiWindow.map((name) => `${name.slice(0, -1)}W`)

describe('isJapaneseProgram', () => {
  it('finds a program that draws with the ANSI Windows functions and has Japanese resources', () => {
    expect(
      isJapaneseProgram(program({ imports: ansiWindow, languages: [english, japanese] })),
    ).toBe(true)
  })

  it('leaves out Unicode programs, even with Japanese resources', () => {
    expect(isJapaneseProgram(program({ imports: unicodeWindow, languages: [japanese] }))).toBe(
      false,
    )

    expect(
      isJapaneseProgram(
        program({ imports: [...unicodeWindow, 'MessageBoxA'], languages: [japanese] }),
      ),
    ).toBe(false)
  })

  it('leaves out ANSI programs without Japanese resources', () => {
    expect(isJapaneseProgram(program({ imports: ansiWindow, languages: [english] }))).toBe(false)
  })

  it('leaves out programs that only touch one ANSI function, like Ren’Py launchers', () => {
    expect(isJapaneseProgram(program({ imports: ['MessageBoxA'], languages: [japanese] }))).toBe(
      false,
    )
  })

  it('leaves out files that are not programs or are cut short', () => {
    expect(isJapaneseProgram(new Uint8Array(10))).toBe(false)
    expect(isJapaneseProgram(new TextEncoder().encode('MZ, but not really a program'))).toBe(false)

    expect(
      isJapaneseProgram(program({ imports: ansiWindow, languages: [japanese] }).slice(0, 0x500)),
    ).toBe(false)
  })
})

const detect = Effect.fn(function* (codePage: Option.Option<number>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-locale-' })
  const executable = path.join(folder, 'Game.exe')

  yield* fs.writeFile(executable, program({ imports: ansiWindow, languages: [japanese] }))

  const services = yield* Layer.build(
    LocaleDetector.layerWith({ systemCodePage: Effect.succeed(codePage) }),
  )

  const detector = Context.get(services, LocaleDetector)

  return {
    game: yield* detector.needsJapaneseLocale(executable),
    missing: yield* detector.needsJapaneseLocale(path.join(folder, 'Gone.exe')),
  }
})

describe('LocaleDetector', () => {
  it.live('says a Japanese program needs a Japanese locale on Windows in another language', () =>
    Effect.gen(function* () {
      const found = { game: Option.some(true), missing: Option.none() }

      expect(yield* detect(Option.some(1252))).toEqual(found)
      expect(yield* detect(Option.none())).toEqual(found)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('leaves Japanese programs alone on Japanese Windows', () =>
    Effect.gen(function* () {
      expect(yield* detect(Option.some(932))).toEqual({
        game: Option.some(false),
        missing: Option.none(),
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
