import { Context, Effect, FileSystem, Layer, Option } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const japaneseLanguage = 0x411

const japaneseCodePage = 932

const readLimit = 32 * 1024 ** 2

const fewAnsiCalls = 5

const isWindowLibrary = (name: string) => /^(user32|gdi32)(\.dll)?$/i.test(name)

interface Section {
  readonly address: number
  readonly size: number
  readonly offset: number
}

export const isJapaneseProgram = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const u16 = (offset: number) =>
    offset >= 0 && offset + 2 <= bytes.length ? view.getUint16(offset, true) : 0

  const u32 = (offset: number) =>
    offset >= 0 && offset + 4 <= bytes.length ? view.getUint32(offset, true) : 0

  const header = u32(0x3c)

  if (u16(0) !== 0x5a4d || u32(header) !== 0x4550) {
    return false
  }

  const optional = header + 24
  const wide = u16(optional) === 0x20b
  const directories = optional + (wide ? 112 : 96)
  const firstSection = optional + u16(header + 20)

  const sections = Array.from({ length: u16(header + 6) }, (_, index): Section => {
    const section = firstSection + index * 40

    return {
      address: u32(section + 12),
      size: Math.max(u32(section + 8), u32(section + 16)),
      offset: u32(section + 20),
    }
  })

  const offsetOf = (address: number) => {
    const section = sections.find(
      (candidate) => address >= candidate.address && address < candidate.address + candidate.size,
    )

    return section === undefined ? -1 : address - section.address + section.offset
  }

  const textAt = (offset: number) => {
    if (offset < 0 || offset >= bytes.length) {
      return ''
    }

    const end = bytes.indexOf(0, offset)

    return String.fromCharCode(
      ...bytes.subarray(offset, Math.min(end < 0 ? offset : end, offset + 64)),
    )
  }

  const windowFunctions = () => {
    const names: Array<string> = []
    const step = wide ? 8 : 4
    const table = u32(directories + 8)

    if (table === 0) {
      return names
    }

    for (let library = offsetOf(table); u32(library + 12) !== 0; library += 20) {
      if (!isWindowLibrary(textAt(offsetOf(u32(library + 12))))) {
        continue
      }

      const lookups = offsetOf(u32(library) === 0 ? u32(library + 16) : u32(library))

      for (let lookup = lookups; lookup > 0 && names.length < 4096; lookup += step) {
        const entry = u32(lookup)
        const byOrdinal = u32(lookup + step - 4) >= 0x80000000

        if (entry === 0 && u32(lookup + step - 4) === 0) {
          break
        }

        if (!byOrdinal) {
          names.push(textAt(offsetOf(entry) + 2))
        }
      }
    }

    return names
  }

  const languages = () => {
    const found = new Set<number>()
    const root = offsetOf(u32(directories + 16))

    const walk = (directory: number, depth: number) => {
      const count = Math.min(u16(directory + 12) + u16(directory + 14), 4096)

      for (let index = 0; index < count; index += 1) {
        const entry = directory + 16 + index * 8
        const target = u32(entry + 4)

        if (target < 0x80000000) {
          found.add(u32(entry))
        } else if (depth < 3) {
          walk(root + (target - 0x80000000), depth + 1)
        }
      }
    }

    if (root > 0) {
      walk(root, 0)
    }

    return found
  }

  const functions = windowFunctions()
  const ansi = functions.filter((name) => /[a-z0-9]A$/.test(name)).length
  const unicode = functions.filter((name) => /[a-z0-9]W$/.test(name)).length

  return ansi >= fewAnsiCalls && ansi > unicode && languages().has(japaneseLanguage)
}

const codePageKey = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`

export class LocaleDetector extends Context.Service<
  LocaleDetector,
  {
    readonly needsJapaneseLocale: (executablePath: string) => Effect.Effect<Option.Option<boolean>>
  }
>()('wenbu/core/library/LocaleDetector') {
  static readonly layerWith = (options: {
    readonly systemCodePage: Effect.Effect<Option.Option<number>>
  }) =>
    Layer.effect(
      LocaleDetector,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const systemCodePage = yield* Effect.cached(options.systemCodePage)

        const readProgram = (executablePath: string) =>
          Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(executablePath)
              const { size } = yield* file.stat

              return yield* file.readAlloc(Math.min(Number(size), readLimit))
            }),
          ).pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()))

        const needsJapaneseLocale = Effect.fn('LocaleDetector.needsJapaneseLocale')(function* (
          executablePath: string,
        ) {
          const program = yield* readProgram(executablePath)
          const japaneseWindows = Option.contains(yield* systemCodePage, japaneseCodePage)

          return Option.map(program, (bytes) => !japaneseWindows && isJapaneseProgram(bytes))
        })

        return LocaleDetector.of({ needsJapaneseLocale })
      }),
    )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const systemCodePage = spawner
        .string(ChildProcess.make('reg', ['query', codePageKey, '/v', 'ACP'], { stderr: 'ignore' }))
        .pipe(
          Effect.map((output) =>
            Option.map(Option.fromNullishOr(/\bACP\s+REG_SZ\s+(\d+)/.exec(output)?.[1]), (page) =>
              Number(page),
            ),
          ),
          Effect.orElseSucceed(() => Option.none<number>()),
        )

      return LocaleDetector.layerWith({ systemCodePage })
    }),
  )

  static readonly never = Layer.succeed(LocaleDetector)({
    needsJapaneseLocale: () => Effect.succeed(Option.some(false)),
  })
}
