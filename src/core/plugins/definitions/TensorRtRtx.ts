import { Config, Effect, FileSystem, Option, Path, Schema } from 'effect'
import { engineExecutable, MangaRuntime } from '../../manga/MangaRuntime'
import { readZip } from '../Archives'
import { download } from '../Downloads'
import {
  failed,
  onDisk,
  type InstallStepDefinition,
  type PluginDefinition,
  runCommand,
  servicesProvider,
  writeFiles,
} from '../PluginDefinition'

const version = 'v0.5.0'
const release = `https://github.com/NVIDIA/TensorRT-RTX-EP-ABI/releases/tag/${version}`

/** NVIDIA's execution provider for ONNX Runtime, with TensorRT-RTX itself. */
const provider = {
  url: `https://github.com/NVIDIA/TensorRT-RTX-EP-ABI/releases/download/${version}/TensorRT-RTX-EP-ABI-${version}-cu12.zip`,
  bytes: 116_776_412,
  sha256: 'ef5df417eaa039bf2625b2285d9caab8afad3907e80d144da6443a1f73612ab1',
  folder: `TensorRT-RTX-EP-ABI-${version}-cu12/`,
}

/** The files taken from the CUDA runtime's wheel, and their names in the pack. */
const cudaRuntimeFiles: Readonly<Record<string, string>> = {
  'nvidia/cuda_runtime/bin/cudart64_12.dll': 'cudart64_12.dll',
  'nvidia_cuda_runtime_cu12-12.9.79.dist-info/licenses/License.txt': 'CUDA-LICENSE.txt',
}

/** The CUDA runtime the provider loads, from NVIDIA's own package on PyPI. */
const cudaRuntime = {
  url: 'https://files.pythonhosted.org/packages/59/df/e7c3a360be4f7b93cee39271b792669baeb3846c58a4df6dfcf187a7ffab/nvidia_cuda_runtime_cu12-12.9.79-py3-none-win_amd64.whl',
  bytes: 3_591_604,
  sha256: '8e018af8fa02363876860388bd10ccb89eb9ab8fb0aa749aaf58430a9f7c4891',
  files: cudaRuntimeFiles,
}

const Probe = Schema.fromJsonString(
  Schema.Struct({ backend: Schema.String, device: Schema.String }),
)

const decodeProbe = Schema.decodeUnknownOption(Probe)

/** What the engine's `--probe` reported: the backend and device it would use. */
export const probeOf = (output: string) =>
  Option.firstSomeOf(
    output
      .trim()
      .split('\n')
      .toReversed()
      .map((line) => decodeProbe(line.trim())),
  )

export const makeTensorRtRtx = Effect.gen(function* () {
  const provided = yield* servicesProvider
  const runtime = yield* MangaRuntime
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const path = yield* Path.Path
  const executable = engineExecutable(resources, path)
  const providerZip = (work: string) => path.join(work, 'provider.zip')
  const runtimeWheel = (work: string) => path.join(work, 'cuda-runtime.whl')

  const fetch = (source: { readonly url: string; readonly sha256: string }, file: string) =>
    Effect.fnUntraced(function* (step: Parameters<InstallStepDefinition['run']>[0]) {
      const result = yield* download(source.url, file, step.progress)

      if (result.sha256 !== source.sha256) {
        return yield* failed('The download does not match the checksum NVIDIA publishes.')
      }
    })

  const steps: ReadonlyArray<InstallStepDefinition> = [
    {
      label: 'Download TensorRT-RTX from NVIDIA',
      run: (step) => provided(fetch(provider, providerZip(step.work))(step)),
    },
    {
      label: 'Download the CUDA runtime from NVIDIA',
      run: (step) => provided(fetch(cudaRuntime, runtimeWheel(step.work))(step)),
    },
    {
      label: 'Unpack',
      run: (step) =>
        provided(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem

            const read = (file: string) =>
              onDisk(fs.readFile(file), 'The download could not be read.')

            const pack = yield* readZip(yield* read(providerZip(step.work)), (name) =>
              name.startsWith(provider.folder) ? name.slice(provider.folder.length) : undefined,
            ).pipe(Effect.mapError((error) => failed(error.message)))

            const cuda = yield* readZip(
              yield* read(runtimeWheel(step.work)),
              (name) => cudaRuntime.files[name],
            ).pipe(Effect.mapError((error) => failed(error.message)))

            yield* step.detail(`${pack.length + cuda.length} files`)

            yield* onDisk(
              writeFiles(step.folder, [...pack, ...cuda]),
              'The files could not be written.',
            )
          }),
        ),
    },
  ]

  const test = Effect.fn('TensorRtRtx.test')(function* (folder: string) {
    const output = yield* runCommand(executable, ['--probe'], {
      env: { WENBU_NVIDIA_PACK: folder, WENBU_MANGA_BACKEND: 'trt' },
      what: 'The manga engine',
    })

    const probe = probeOf(output)

    return Option.isSome(probe) && probe.value.backend === 'TensorRT-RTX'
      ? `TensorRT-RTX runs on the ${probe.value.device}.`
      : yield* failed('No NVIDIA RTX graphics card here can use TensorRT-RTX.')
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: 'tensorrt-rtx',
      name: 'NVIDIA TensorRT-RTX',
      description:
        'Makes the Wenbu Manga Engine about twice as fast on NVIDIA RTX graphics cards. Downloaded from NVIDIA.',
      project: 'NVIDIA TensorRT-RTX',
      license: 'NVIDIA software licence',
      sourceLabel: 'GitHub · NVIDIA/TensorRT-RTX-EP-ABI',
      sourceUrl: release,
      pinned:
        'Pinned: tested with this version of the Wenbu Manga Engine. Updates come with Wenbu once tested.',
      platforms: ['win32'],
    },
    supported: process.platform === 'win32' && process.arch === 'x64',
    resolve: Effect.succeed({
      release: { version, downloadBytes: provider.bytes + cudaRuntime.bytes },
      steps,
      installBytes: 3 * (provider.bytes + cudaRuntime.bytes),
    }),
    test,
    release: runtime.stop,
  }

  return definition
})
