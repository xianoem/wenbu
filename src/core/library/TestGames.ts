import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from 'effect'
import { LunaHookHost } from '../overlay/LunaHookHost'
import { Plugins } from '../plugins/Plugins'
import { GameLauncher, LaunchHooks } from './GameLauncher'
import { LaunchAlias } from './LaunchAlias'
import { LocaleDetector } from './LocaleDetector'

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const writeJson = Effect.fnUntraced(function* (target: string, value: object) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  yield* fs.makeDirectory(path.dirname(target), { recursive: true })
  yield* fs.writeFileString(target, yield* Effect.orDie(encodeJson(value)))
})

export const mvMap = (lines: ReadonlyArray<string>) => ({
  displayName: '',
  events: [null, { pages: [{ list: lines.map((line) => ({ code: 401, parameters: [line] })) }] }],
})

export const makeMvGame = Effect.fnUntraced(function* (lines: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folderPath = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-game-' })
  const data = path.join(folderPath, 'www', 'data')

  yield* writeJson(path.join(data, 'System.json'), { gameTitle: '魔法の森', currencyUnit: 'G' })
  yield* writeJson(path.join(data, 'Map001.json'), mvMap(lines))
  yield* fs.writeFileString(path.join(folderPath, 'Game.exe'), 'MZ')
  yield* fs.writeFileString(path.join(folderPath, 'unins000.exe'), 'MZ')
  yield* fs.makeDirectory(path.join(folderPath, 'www', 'img', 'pictures'), { recursive: true })

  yield* fs.writeFile(
    path.join(folderPath, 'www', 'img', 'pictures', 'cg01.rpgmvp'),
    Uint8Array.from([...Array.from({ length: 32 }, () => 1), 7, 7, 7]),
  )

  yield* fs.writeFileString(path.join(folderPath, 'www', 'img', 'pictures', 'notes.txt'), 'x')
  yield* fs.makeDirectory(path.join(folderPath, 'www', 'img', 'faces'))

  return folderPath
})

export const TestLauncher = GameLauncher.layer.pipe(
  Layer.merge(LocaleDetector.never),
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(Plugins)({
        state: Stream.empty,
        installedFolder: () => Effect.succeed(Option.none()),
        check: Effect.void,
        install: () => Effect.void,
        cancel: () => Effect.void,
        remove: () => Effect.void,
        test: () => Effect.void,
      }),
      Layer.succeed(LunaHookHost)({
        start: () => Effect.die('LunaHook is not installed in tests.'),
        processes: Effect.succeed([]),
      }),
      LaunchHooks.none,
      LaunchAlias.none,
    ),
  ),
)

export const japanese = 0x411

export const english = 0x409

export const ansiWindow = [
  'CreateWindowExA',
  'RegisterClassA',
  'DefWindowProcA',
  'TextOutA',
  'CreateFontA',
]

export const program = (options: {
  readonly imports: ReadonlyArray<string>
  readonly languages: ReadonlyArray<number>
}) => {
  const bytes = new Uint8Array(0x1400)
  const view = new DataView(bytes.buffer)
  const offsetOf = (rva: number) => rva - 0x1000 + 0x400

  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index)
    }
  }

  view.setUint16(0, 0x5a4d, true)
  view.setUint32(0x3c, 0x80, true)
  view.setUint32(0x80, 0x4550, true)
  view.setUint16(0x84, 0x14c, true)
  view.setUint16(0x86, 1, true)
  view.setUint16(0x94, 224, true)

  const optional = 0x98
  const directories = optional + 96
  const section = optional + 224

  view.setUint16(optional, 0x10b, true)
  view.setUint32(directories + 8, 0x1000, true)
  view.setUint32(directories + 12, 40, true)
  view.setUint32(directories + 16, 0x1800, true)
  view.setUint32(directories + 20, 0x200, true)
  write(section, '.rdata')
  view.setUint32(section + 8, 0x1000, true)
  view.setUint32(section + 12, 0x1000, true)
  view.setUint32(section + 16, 0x1000, true)
  view.setUint32(section + 20, 0x400, true)

  const descriptor = offsetOf(0x1000)

  view.setUint32(descriptor, 0x1040, true)
  view.setUint32(descriptor + 12, 0x1200, true)
  write(offsetOf(0x1200), 'USER32.dll')

  options.imports.forEach((name, index) => {
    const hint = 0x1220 + index * 40

    view.setUint32(offsetOf(0x1040) + index * 4, hint, true)
    write(offsetOf(hint) + 2, name)
  })

  const resources = offsetOf(0x1800)
  const names = 0x18
  const languages = 0x30

  view.setUint16(resources + 14, 1, true)
  view.setUint32(resources + 16, 16, true)
  view.setUint32(resources + 20, 0x80000000 + names, true)
  view.setUint16(resources + names + 14, 1, true)
  view.setUint32(resources + names + 16, 1, true)
  view.setUint32(resources + names + 20, 0x80000000 + languages, true)
  view.setUint16(resources + languages + 14, options.languages.length, true)

  options.languages.forEach((language, index) => {
    const entry = resources + languages + 16 + index * 8

    view.setUint32(entry, language, true)
    view.setUint32(entry + 4, 0x100 + index * 16, true)
  })

  return bytes
}
