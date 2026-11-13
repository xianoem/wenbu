import { Config, Crypto, Effect, FileSystem, Option, Path, Schedule, Schema, Stream } from 'effect'
import { Hex } from 'effect/encoding'
import { PluginError } from '#contract/Plugins'
import { MangaRuntime, RunEvent } from '../../manga/MangaRuntime'
import { readZip } from '../Archives'
import { download } from '../Downloads'
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

const uv = {
  version: '0.11.11',
  url: 'https://github.com/astral-sh/uv/releases/download/0.11.11/uv-x86_64-pc-windows-msvc.zip',
  sha256: '2f75a0db2c3530b6b3c24434dc38137f61ff1f4e5f2d7b4ddc5bcd142cf58b65',
}

const pythonVersion = '3.11.15'

// Pinned: Wenbu's pipeline calls upstream's private methods.
export const upstream = {
  commit: '80f1bed59ddf8b05ec1edd791bad4b119e152925',
  publishedAt: '2025-06-18T15:18:57Z',
  sha256: '2d4ecc1436cc7bbdbc73f825d5a3b217d0ad804b688bf71d84485ac4c5204cd7',
}

const upstreamUrl = `https://github.com/zyddnys/manga-image-translator/archive/${upstream.commit}.zip`

const release = 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3'

export const models = [
  {
    file: 'detection/detect-20241225.ckpt',
    url: `${release}/detect-20241225.ckpt`,
    sha256: '67ce1c4ed4793860f038c71189ba9630a7756f7683b1ee5afb69ca0687dc502e',
  },
  {
    file: 'ocr/ocr_ar_48px.ckpt',
    url: `${release}/ocr_ar_48px.ckpt`,
    sha256: '29daa46d080818bb4ab239a518a88338cbccff8f901bef8c9db191a7cb97671d',
  },
  {
    file: 'ocr/alphabet-all-v7.txt',
    url: `${release}/alphabet-all-v7.txt`,
    sha256: 'f5722368146aa0fbcc9f4726866e4efc3203318ebb66c811d8cbbe915576538a',
  },
  {
    file: 'inpainting/lama_large_512px.ckpt',
    url: 'https://huggingface.co/dreMaz/AnimeMangaInpainting/resolve/main/lama_large_512px.ckpt',
    sha256: '11d30fbb3000fb2eceae318b75d9ced9229d99ae990a7f8b3ac35c8d31f2c935',
  },
] as const

export const TorchBackend = Schema.Literals(['cu128', 'cu126', 'cu118', 'cpu'])

export type TorchBackend = typeof TorchBackend.Type

export const PluginManifest = Schema.Struct({
  torchBackend: TorchBackend,
  gpu: Schema.optional(Schema.String),
  driver: Schema.optional(Schema.String),
})

export type PluginManifest = typeof PluginManifest.Type

export const manifestFile = 'wenbu-plugin.json'

const ManifestJson = Schema.fromJsonString(PluginManifest)

const cudaBuilds = [
  { backend: 'cu128', cuda: '12.8', windows: '570.65', linux: '570.26' },
  { backend: 'cu126', cuda: '12.6', windows: '560.76', linux: '560.28.03' },
  { backend: 'cu118', cuda: '11.8', windows: '520.06', linux: '520.61.05' },
] as const

const versionParts = (version: string) =>
  version
    .split(/\D+/)
    .filter((part) => part !== '')
    .map(Number)

const atLeast = (actual: string, minimum: string) => {
  const left = versionParts(actual)
  const right = versionParts(minimum)

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)

    if (difference !== 0) {
      return difference > 0
    }
  }

  return true
}

export interface TorchChoice {
  readonly manifest: PluginManifest
  readonly detail: string
}

export const chooseTorch = (
  nvidiaSmi: Option.Option<string>,
  platform: NodeJS.Platform,
): TorchChoice => {
  const line = Option.getOrElse(nvidiaSmi, () => '')
    .split('\n')
    .map((row) => row.trim())
    .find((row) => row !== '')

  const [gpu, driver] = (line ?? '').split(',').map((column) => column.trim())

  if (gpu === undefined || driver === undefined || driver === '') {
    return {
      manifest: { torchBackend: 'cpu' },
      detail: 'No NVIDIA GPU found, so pages run on the CPU (slow).',
    }
  }

  const build = cudaBuilds.find((candidate) =>
    atLeast(driver, platform === 'win32' ? candidate.windows : candidate.linux),
  )

  if (build === undefined) {
    return {
      manifest: { torchBackend: 'cpu', gpu, driver },
      detail: `${gpu}: driver ${driver} is too old for PyTorch's CUDA builds, so pages run on the CPU. Update the NVIDIA driver, then reinstall.`,
    }
  }

  return {
    manifest: { torchBackend: build.backend, gpu, driver },
    detail: `${gpu}, driver ${driver}: CUDA ${build.cuda} build`,
  }
}

const sampleTranslation = (texts: ReadonlyArray<string>) => texts.map(() => 'Wenbu')

export const makeMangaImageTranslator = Effect.gen(function* () {
  const provided = yield* servicesProvider
  const runtime = yield* MangaRuntime
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const supported = platformKey === 'win32-x64'

  const resolve = Effect.gen(function* () {
    if (!supported) {
      return yield* new PluginError({
        reason: 'unsupported',
        message: 'Manga translation runs on 64-bit Windows only for now.',
      })
    }

    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const python = path.join(resources, 'python')
    const requirements = path.join(python, 'requirements.txt')

    const lock = yield* onDisk(fs.readFile(requirements), "Wenbu's package list is missing.")
    const lockHash = Hex.encode(yield* Effect.orDie(crypto.digest('SHA-256', lock)))
    let choice: TorchChoice | undefined

    const uvPath = (folder: string) => path.join(folder, 'uv', 'uv.exe')

    // Outside the install's work folder, so a retried install doesn't download PyTorch again.
    const uvCache = (folder: string) =>
      path.join(path.dirname(path.dirname(folder)), '.cache', 'uv')

    const uvEnv = (folder: string) => ({
      UV_PYTHON_INSTALL_DIR: path.join(folder, 'python'),
      UV_CACHE_DIR: uvCache(folder),
      UV_LINK_MODE: 'copy',
      UV_NO_PROGRESS: '1',
      UV_PYTHON_DOWNLOADS: 'automatic',
      UV_CONCURRENT_INSTALLS: '2',
    })

    const steps: ReadonlyArray<InstallStepDefinition> = [
      {
        label: 'Download uv',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const result = yield* download(uv.url, path.join(step.work, 'uv.zip'), step.progress)

              if (result.sha256 !== uv.sha256) {
                return yield* failed(
                  'The uv download does not match the checksum Astral publishes.',
                )
              }

              const zip = yield* onDisk(
                fs.readFile(path.join(step.work, 'uv.zip')),
                'The download could not be read.',
              )

              const files = yield* readZip(zip, (name) =>
                name === 'uv.exe' ? 'uv/uv.exe' : undefined,
              ).pipe(Effect.mapError((error) => failed(error.message)))

              if (files.length !== 1) {
                return yield* failed(`uv ${uv.version} no longer contains uv.exe.`)
              }

              yield* onDisk(writeFiles(step.folder, files), 'The files could not be written.')
            }),
          ),
      },
      {
        label: `Install Python ${pythonVersion}`,
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const env = uvEnv(step.folder)

              yield* runCommand(uvPath(step.folder), ['python', 'install', pythonVersion], {
                env,
                what: 'Installing Python',
              })

              yield* runCommand(
                uvPath(step.folder),
                [
                  'venv',
                  path.join(step.folder, 'env'),
                  '--python',
                  pythonVersion,
                  '--managed-python',
                ],
                { env, what: 'Creating the Python environment' },
              )
            }),
          ),
      },
      {
        label: 'Download manga-image-translator',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const archive = path.join(step.work, 'upstream.zip')
              const result = yield* download(upstreamUrl, archive, step.progress)

              if (result.sha256 !== upstream.sha256) {
                return yield* failed(
                  'The download does not match the version Wenbu was tested with.',
                )
              }

              const zip = yield* onDisk(fs.readFile(archive), 'The download could not be read.')
              const root = `manga-image-translator-${upstream.commit}/`

              const files = yield* readZip(zip, (name) => {
                if (!name.startsWith(root)) {
                  return undefined
                }

                const inner = name.slice(root.length)

                return inner.startsWith('manga_translator/') || inner === 'LICENSE'
                  ? `upstream/${inner}`
                  : undefined
              }).pipe(Effect.mapError((error) => failed(error.message)))

              yield* step.detail(`${files.length} files`)
              yield* onDisk(writeFiles(step.folder, files), 'The files could not be written.')
            }),
          ),
      },
      {
        label: 'Check the GPU',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const output = yield* runCommand(
                'nvidia-smi',
                ['--query-gpu=name,driver_version', '--format=csv,noheader'],
                { what: 'Reading the NVIDIA driver' },
              ).pipe(Effect.option)

              choice = chooseTorch(output, process.platform)

              const manifest = yield* Effect.orDie(
                Schema.encodeEffect(ManifestJson)(choice.manifest),
              )

              yield* onDisk(
                fs.writeFileString(path.join(step.folder, manifestFile), manifest),
                'The files could not be written.',
              )

              yield* step.detail(choice.detail)
            }),
          ),
      },
      {
        label: 'Install PyTorch and packages',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const backend = choice?.manifest.torchBackend ?? 'cpu'

              yield* step.detail(
                backend === 'cpu' ? 'CPU build, about 1 GB' : 'CUDA build, about 3 GB',
              )

              yield* runCommand(
                uvPath(step.folder),
                [
                  'pip',
                  'install',
                  '--python',
                  path.join(step.folder, 'env', 'Scripts', 'python.exe'),
                  '--requirements',
                  requirements,
                  '--find-links',
                  path.join(resources, 'native', platformKey, 'wheels'),
                  '--torch-backend',
                  backend,
                ],
                { env: uvEnv(step.folder), what: 'Installing the packages' },
              ).pipe(
                // Antivirus scanners briefly lock files uv has just unpacked.
                Effect.retry({ times: 8, schedule: Schedule.spaced('3 seconds') }),
              )

              yield* Effect.ignore(fs.remove(uvCache(step.folder), { recursive: true }))
            }),
          ),
      },
      {
        label: 'Download models',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              for (const [index, model] of models.entries()) {
                const target = path.join(step.folder, 'models', model.file)

                yield* step.detail(`${index + 1} of ${models.length}: ${path.basename(model.file)}`)

                yield* onDisk(
                  fs.makeDirectory(path.dirname(target), { recursive: true }),
                  'The files could not be written.',
                )

                const result = yield* download(model.url, target, step.progress)

                if (result.sha256 !== model.sha256) {
                  return yield* failed(
                    `${path.basename(model.file)} does not match the checksum upstream lists.`,
                  )
                }
              }
            }),
          ),
      },
    ]

    return {
      release: {
        version: `${upstream.commit.slice(0, 7)}-${lockHash.slice(0, 8)}`,
        publishedAt: upstream.publishedAt,
      },
      steps,
      installBytes: 10 * 1024 ** 3,
    }
  }).pipe(provided)

  const test = Effect.fn('MangaImageTranslator.test')(function* (folder: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const manifest = yield* onDisk(
      fs.readFileString(path.join(folder, manifestFile)),
      'The plugin is incomplete. Reinstall it.',
    ).pipe(
      Effect.flatMap((text) =>
        Effect.mapError(Schema.decodeUnknownEffect(ManifestJson)(text), () =>
          failed('The plugin is incomplete. Reinstall it.'),
        ),
      ),
    )

    const output = path.join(folder, 'test', 'manga-sample.png')

    yield* Effect.ignore(fs.remove(output))

    const handle = yield* runtime
      .run(folder, {
        options: {
          model_dir: path.join(folder, 'models'),
          font_dir: path.join(resources, 'fonts', 'Anime Ace'),
          use_gpu: manifest.torchBackend !== 'cpu',
        },
        pages: [{ source: path.join(resources, 'samples', 'manga-sample.png'), output }],
      })
      .pipe(Effect.mapError((error) => failed(error.message)))

    let regions = 0
    let device = 'cpu'
    let problem: string | undefined

    yield* handle.events.pipe(
      Stream.runForEach((event) =>
        RunEvent.$match(event, {
          Translate: ({ id, texts }) =>
            handle.answer(id, { translations: sampleTranslation(texts) }),
          ModelsLoaded: (loaded) => Effect.sync(() => (device = loaded.device)),
          PageDone: (done) => Effect.sync(() => (regions = done.regions)),
          PageFailed: ({ message }) => Effect.sync(() => (problem = message)),
          Failed: ({ message }) => Effect.sync(() => (problem = message)),
          LoadingModels: () => Effect.void,
          PageStarted: () => Effect.void,
          Stage: () => Effect.void,
          Done: () => Effect.void,
        }),
      ),
    )

    if (problem !== undefined) {
      return yield* failed(problem)
    }

    if (regions === 0 || !(yield* Effect.orElseSucceed(fs.exists(output), () => false))) {
      return yield* failed('The sample page came back without translated text.')
    }

    return `Translated the sample page on the ${device === 'cuda' ? `GPU (${manifest.gpu ?? 'NVIDIA'})` : 'CPU'}.`
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: 'manga-image-translator',
      name: 'Manga Translator',
      description:
        'Finds, cleans and letters the text on manga pages. Wenbu translates it with your presets.',
      project: 'manga-image-translator',
      license: 'GPL-3.0',
      sourceLabel: 'GitHub · zyddnys/manga-image-translator',
      sourceUrl: 'https://github.com/zyddnys/manga-image-translator',
      pinned:
        "Pinned: Wenbu's fast pipeline builds on this version's internals. Updates come with Wenbu once tested.",
      platforms: ['win32'],
    },
    supported,
    resolve,
    test,
    release: runtime.stop,
  }

  return definition
})

export const readManifest = Effect.fn('MangaImageTranslator.readManifest')(function* (
  folder: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  return yield* fs.readFileString(path.join(folder, manifestFile)).pipe(
    Effect.flatMap((text) => Schema.decodeUnknownEffect(ManifestJson)(text)),
    Effect.option,
  )
})
