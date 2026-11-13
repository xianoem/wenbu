import { Config, Effect, FileSystem, Option, Path, Schema } from 'effect'
import { PluginError } from '#contract/Plugins'
import { type SpeechModelId, speechModels } from '#contract/Subtitles'
import { download } from '../Downloads'
import {
  failed,
  onDisk,
  type InstallStepDefinition,
  type PluginDefinition,
  platformKey,
  runCommand,
  servicesProvider,
} from '../PluginDefinition'

export const speechHelper = (resources: string, path: Path.Path) =>
  path.join(resources, 'native', platformKey, 'wenbu-speech.exe')

export const huggingFace = (repo: string, revision: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${revision}/${file}`

export interface ModelFile {
  readonly file: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

export const voiceDetector: ModelFile = {
  file: 'silero-vad-v6.2-F32.gguf',
  url: huggingFace(
    'handy-computer/silero-vad-v6.2-gguf',
    'a9b2d61c20ae4ddf3644edb34969e8185a485448',
    'silero-vad-v6.2-F32.gguf',
  ),
  sha256: '0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6',
  bytes: 1_241_056,
}

export const SpeechManifest = Schema.Struct({
  size: Schema.String,
  gpu: Schema.optional(Schema.String),
})

export type SpeechManifest = typeof SpeechManifest.Type

export const manifestFile = 'wenbu-plugin.json'

const ManifestJson = Schema.fromJsonString(SpeechManifest)

const ComputeDevice = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  type: Schema.Literals(['gpu', 'integrated', 'cpu', 'accelerator']),
  memory: Schema.Finite,
})

export type ComputeDevice = typeof ComputeDevice.Type

const DeviceList = Schema.fromJsonString(Schema.Struct({ devices: Schema.Array(ComputeDevice) }))

export const largest = (devices: ReadonlyArray<ComputeDevice>, type: ComputeDevice['type']) =>
  devices
    .filter((device) => device.type === type)
    .toSorted((left, right) => right.memory - left.memory)
    .at(0)

export const bestGpu = (devices: ReadonlyArray<ComputeDevice>) =>
  largest(devices, 'gpu') ?? largest(devices, 'integrated')

export const oneFile =
  (size: string) =>
  (devices: ReadonlyArray<ComputeDevice>): SpeechManifest => {
    const gpu = bestGpu(devices)

    return gpu === undefined ? { size } : { size, gpu: gpu.name }
  }

export interface SpeechModelSpec {
  readonly id: SpeechModelId
  readonly version: string
  readonly description: string
  readonly license: string
  readonly sourceLabel: string
  readonly sourceUrl: string
  readonly sizes: Readonly<Record<string, ModelFile>>
  readonly choose: (devices: ReadonlyArray<ComputeDevice>) => SpeechManifest
}

export const installedName = (spec: SpeechModelSpec, manifest: SpeechManifest) => {
  const name = speechModels[spec.id].name

  return Object.keys(spec.sizes).length > 1 ? `${name} ${manifest.size}` : name
}

export const modelPaths = (
  folder: string,
  spec: SpeechModelSpec,
  manifest: SpeechManifest,
  path: Path.Path,
) => {
  const model = spec.sizes[manifest.size]

  if (model === undefined) {
    return Option.none()
  }

  return Option.some({
    model: path.join(folder, 'models', model.file),
    vad: path.join(folder, 'models', voiceDetector.file),
  })
}

const silenceWav = () => {
  const samples = 16_000
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)

  const text = (at: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)))

  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)

  return bytes
}

const ModelLoaded = Schema.fromJsonString(
  Schema.Struct({
    event: Schema.Literal('model-loaded'),
    device: Schema.String,
    seconds: Schema.Finite,
  }),
)

export const makeSpeechModel = Effect.fn('SpeechModel.make')(function* (spec: SpeechModelSpec) {
  const provided = yield* servicesProvider
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const supported = platformKey === 'win32-x64'
  const name = speechModels[spec.id].name
  const files = Object.values(spec.sizes)
  const biggest = Math.max(...files.map((model) => model.bytes))

  const readDevices = Effect.gen(function* () {
    const path = yield* Path.Path

    const output = yield* runCommand(speechHelper(resources, path), ['--devices'], {
      what: 'Reading the GPUs',
    })

    return yield* Schema.decodeUnknownEffect(DeviceList)(output.trim()).pipe(
      Effect.map((list) => list.devices),
      Effect.mapError(() => failed("Wenbu's speech helper sent an answer it could not read.")),
    )
  })

  const resolve = Effect.gen(function* () {
    if (!supported) {
      return yield* new PluginError({
        reason: 'unsupported',
        message: 'Live Subtitles runs on 64-bit Windows only for now.',
      })
    }

    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let manifest = spec.choose([])

    const fetchModel = (step: Parameters<InstallStepDefinition['run']>[0], model: ModelFile) =>
      provided(
        Effect.gen(function* () {
          const target = path.join(step.folder, 'models', model.file)

          yield* onDisk(
            fs.makeDirectory(path.dirname(target), { recursive: true }),
            'The files could not be written.',
          )

          const result = yield* download(model.url, target, step.progress)

          if (result.sha256 !== model.sha256) {
            return yield* failed(`${model.file} does not match the version Wenbu was tested with.`)
          }
        }),
      )

    const steps: ReadonlyArray<InstallStepDefinition> = [
      {
        label: 'Check the GPU',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              manifest = spec.choose(yield* readDevices)

              const json = yield* Effect.orDie(Schema.encodeEffect(ManifestJson)(manifest))

              yield* onDisk(
                fs.writeFileString(path.join(step.folder, manifestFile), json),
                'The files could not be written.',
              )

              yield* step.detail(
                manifest.gpu === undefined
                  ? `No GPU found, so ${installedName(spec, manifest)} runs on the CPU.`
                  : `${manifest.gpu}: ${installedName(spec, manifest)}`,
              )
            }),
          ),
      },
      { label: 'Download the voice detector', run: (step) => fetchModel(step, voiceDetector) },
      {
        label: `Download ${name}`,
        run: (step) => {
          const model = spec.sizes[manifest.size]

          if (model === undefined) {
            return failed(`${name} has no ${manifest.size} file.`)
          }

          return Effect.andThen(
            step.detail(`${manifest.size}, ${Math.round(model.bytes / 1e6)} MB`),
            fetchModel(step, model),
          )
        },
      },
    ]

    return {
      release: {
        version: spec.version,
        downloadBytes: biggest,
      },
      steps,
      installBytes: biggest * 2,
    }
  }).pipe(provided)

  const test = Effect.fn('SpeechModel.test')(function* (folder: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const installed = yield* readManifest(folder).pipe(
      Effect.map((manifest) =>
        Option.flatMap(manifest, (value) =>
          Option.map(modelPaths(folder, spec, value, path), (paths) => ({
            manifest: value,
            paths,
          })),
        ),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failed('The plugin is incomplete. Reinstall it.')),
          onSome: Effect.succeed,
        }),
      ),
    )

    const sample = path.join(folder, 'test', 'silence.wav')

    yield* onDisk(
      fs.makeDirectory(path.dirname(sample), { recursive: true }),
      'The test file could not be written.',
    )

    yield* onDisk(fs.writeFile(sample, silenceWav()), 'The test file could not be written.')

    const output = yield* runCommand(
      speechHelper(resources, path),
      ['--input', sample, '--model', installed.paths.model, '--vad', installed.paths.vad],
      { what: `Running ${name}` },
    )

    const loaded = output
      .split('\n')
      .map((line) => Schema.decodeUnknownOption(ModelLoaded)(line.trim()))
      .find(Option.isSome)

    if (loaded === undefined || !output.includes('"event":"done"')) {
      return yield* failed(`${name} did not finish its test run.`)
    }

    return `${installedName(spec, installed.manifest)} loaded on ${loaded.value.device} in ${loaded.value.seconds.toFixed(1)} s.`
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: spec.id,
      name,
      description: spec.description,
      project: 'transcribe.cpp',
      license: spec.license,
      sourceLabel: spec.sourceLabel,
      sourceUrl: spec.sourceUrl,
      pinned:
        "Pinned: Wenbu's speech runtime (transcribe.cpp) was tested with these model files. Updates come with Wenbu.",
      platforms: ['win32'],
    },
    supported,
    resolve,
    test,
    release: Effect.void,
  }

  return definition
})

export const readManifest = Effect.fn('SpeechModel.readManifest')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  return yield* fs.readFileString(path.join(folder, manifestFile)).pipe(
    Effect.flatMap((text) => Schema.decodeUnknownEffect(ManifestJson)(text)),
    Effect.option,
  )
})
