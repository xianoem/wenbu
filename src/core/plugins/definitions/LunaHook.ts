import { Config, Effect, FileSystem, Path, Schema } from 'effect'
import { PluginError } from '#contract/Plugins'
import { readZip } from '../Archives'
import { download, getJson } from '../Downloads'
import {
  failed,
  onDisk,
  type InstallStepDefinition,
  type PluginDefinition,
  platformKey,
  runCommand,
  servicesProvider,
  writeFiles,
} from '../PluginDefinition'

// Pinned: the bridge calls LunaHost's C exports, whose signatures change between releases.
const pinnedRelease = 'v12.1.2.15'

const releaseUrl = `https://api.github.com/repos/HIllya51/LunaTranslator/releases/tags/${pinnedRelease}`

const assetName = 'LunaTranslator_x64.zip'

const hookFiles = {
  'LunaHook32.dll': 0x14c,
  'LunaHook64.dll': 0x8664,
  'LunaHost64.dll': 0x8664,
} as const

export const localeTools = {
  ntleas: { x86: 'locale/ntleas/x86/ntleas.exe', x64: 'locale/ntleas/x64/ntleas.exe' },
  localeRemulator: 'locale/locale-remulator/LRProc.exe',
} as const

const archiveFolders: ReadonlyArray<readonly [string, string]> = [
  ['LunaTranslator_x64/files/Locale/ntleas046_x64/', 'locale/ntleas/'],
  ['LunaTranslator_x64/files/Locale/Locale_Remulator/', 'locale/locale-remulator/'],
  ['LunaTranslator_x64/LICENSES/LICENSE.LunaTranslator', 'LICENSES/LunaTranslator'],
  ['LunaTranslator_x64/LICENSES/LICENSE.InWILL.Locale_Remulator', 'LICENSES/Locale_Remulator'],
]

export const pluginPath = (name: string) => {
  const file = name.split('/').at(-1) ?? ''

  if (name.includes('/files/LunaHook/') && Object.hasOwn(hookFiles, file)) {
    return file
  }

  const folder = archiveFolders.find(([from]) => name.startsWith(from))

  return folder === undefined ? undefined : folder[1] + name.slice(folder[0].length)
}

export const lunaHookHelper = (resources: string, path: Path.Path) =>
  path.join(resources, 'native', platformKey, 'wenbu-luna-hook.exe')

const Release = Schema.Struct({
  tag_name: Schema.String,
  published_at: Schema.String,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.Int,
      digest: Schema.optional(Schema.NullOr(Schema.String)),
      browser_download_url: Schema.String,
    }),
  ),
})

export const machineOf = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.length < 64 || view.getUint16(0, true) !== 0x5a4d) {
    return undefined
  }

  const header = view.getUint32(0x3c, true)

  return header + 6 <= bytes.length && view.getUint32(header, true) === 0x4550
    ? view.getUint16(header + 4, true)
    : undefined
}

const bits = (machine: number) => (machine === 0x14c ? '32' : '64')

export const makeLunaHook = Effect.gen(function* () {
  const provided = yield* servicesProvider
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const supported = platformKey === 'win32-x64'

  const resolve = Effect.gen(function* () {
    if (!supported) {
      return yield* new PluginError({
        reason: 'unsupported',
        message: 'LunaHook only runs on Windows.',
      })
    }

    const release = yield* getJson(releaseUrl, Release)
    const asset = release.assets.find((candidate) => candidate.name === assetName)

    if (asset === undefined) {
      return yield* new PluginError({
        reason: 'unavailable',
        message: `LunaTranslator ${release.tag_name} has no ${assetName}.`,
      })
    }

    let sha256 = ''

    const steps: ReadonlyArray<InstallStepDefinition> = [
      {
        label: 'Download',
        run: (step) =>
          provided(
            download(asset.browser_download_url, `${step.work}/luna.zip`, step.progress),
          ).pipe(
            Effect.map((result) => {
              sha256 = result.sha256
            }),
          ),
      },
      {
        label: 'Check the download',
        run: () => {
          if (asset.digest === undefined || asset.digest === null) {
            return Effect.fail(failed('GitHub published no checksum for this download.'))
          }

          return asset.digest === `sha256:${sha256}`
            ? Effect.void
            : Effect.fail(failed('The download does not match the checksum GitHub publishes.'))
        },
      },
      {
        label: 'Unpack the hook and locale files',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem

              const zip = yield* onDisk(
                fs.readFile(`${step.work}/luna.zip`),
                'The download could not be read.',
              )

              const files = yield* readZip(zip, pluginPath).pipe(
                Effect.mapError((error) => failed(error.message)),
              )

              const unpacked = new Set(files.map((file) => file.path))

              const missing = [
                ...Object.keys(hookFiles),
                localeTools.ntleas.x86,
                localeTools.ntleas.x64,
                localeTools.localeRemulator,
              ].filter((file) => !unpacked.has(file))

              if (missing.length > 0) {
                return yield* failed(`The release no longer contains ${missing.join(', ')}.`)
              }

              yield* onDisk(writeFiles(step.folder, files), 'The files could not be written.')
            }),
          ),
      },
    ]

    return {
      release: {
        version: release.tag_name,
        publishedAt: release.published_at,
        downloadBytes: asset.size,
      },
      steps,
    }
  }).pipe(provided)

  const test = Effect.fn('LunaHook.test')(function* (folder: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    for (const [file, machine] of Object.entries(hookFiles)) {
      const bytes = yield* onDisk(fs.readFile(path.join(folder, file)), `${file} is missing.`)

      if (machineOf(bytes) !== machine) {
        return yield* failed(`${file} is not a valid ${bits(machine)}-bit Windows library.`)
      }
    }

    yield* runCommand(lunaHookHelper(resources, path), ['--plugin', folder, '--check'], {
      what: 'Loading LunaHook',
    })

    return 'LunaHook loads, and its hook and locale files are in place.'
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: 'luna-hook',
      name: 'Translation Overlay',
      description:
        'Reads text from running games by hooking them, and starts games in a Japanese locale.',
      project: 'LunaHook',
      license: 'GPL-3.0',
      sourceLabel: 'GitHub · HIllya51/LunaTranslator',
      sourceUrl: 'https://github.com/HIllya51/LunaTranslator',
      pinned:
        "Pinned: Wenbu calls LunaHook's C functions, which change between releases. Updates come with Wenbu once tested.",
      platforms: ['win32'],
    },
    supported,
    resolve,
    test,
    release: Effect.void,
  }

  return definition
})
