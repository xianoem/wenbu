import { Config, Effect, Option, Path, Schema } from 'effect'
import { engineExecutable, MangaRuntime } from '../../manga/MangaRuntime'
import { download } from '../Downloads'
import {
  failed,
  type InstallStepDefinition,
  type PluginDefinition,
  runCommand,
  servicesProvider,
} from '../PluginDefinition'
import models from './mangaEngineModels.json' with { type: 'json' }

const repository = 'https://github.com/xianoem/wenbu'

export const modelUrl = (release: string, name: string) =>
  `${repository}/releases/download/${release}/${name}`

const ReadyLine = Schema.fromJsonString(Schema.Struct({ event: Schema.Literal('ready') }))

const decodeReadyLine = Schema.decodeUnknownOption(ReadyLine)

/** Whether the engine's output holds its `ready` line, which it prints once its models are read. */
export const engineStarted = (output: string) =>
  output.split('\n').some((line) => Option.isSome(decodeReadyLine(line.trim())))

const totalBytes = models.files.reduce((total, file) => total + file.bytes, 0)

export const makeMangaEngine = Effect.gen(function* () {
  const provided = yield* servicesProvider
  const runtime = yield* MangaRuntime
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const path = yield* Path.Path
  const executable = engineExecutable(resources, path)

  const steps: ReadonlyArray<InstallStepDefinition> = [
    {
      label: 'Download models',
      run: (step) =>
        provided(
          Effect.gen(function* () {
            let before = 0

            for (const file of models.files) {
              const result = yield* download(
                modelUrl(models.release, file.name),
                path.join(step.folder, 'models', file.name),
                (done) => step.progress(before + done, totalBytes),
              )

              if (result.sha256 !== file.sha256) {
                return yield* failed(`${file.name} does not match the checksum Wenbu expects.`)
              }

              before += file.bytes
            }
          }),
        ),
    },
  ]

  const test = Effect.fn('MangaEngine.test')(function* (folder: string) {
    // The CPU is enough to show that the engine starts and reads its models.
    const output = yield* runCommand(executable, [], {
      env: { WENBU_MANGA_ENGINE_DIR: folder, WENBU_MANGA_BACKEND: 'cpu' },
      what: 'The manga engine',
    })

    return engineStarted(output)
      ? 'The engine started with its models.'
      : yield* failed('The manga engine did not start.')
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: 'manga-engine',
      name: 'Wenbu Manga Engine',
      description:
        "Finds, cleans and letters the text on manga pages with Wenbu's own engine. Wenbu translates it with your presets.",
      project: 'Wenbu',
      license: 'Apache-2.0 and GPL-3.0 models',
      sourceLabel: 'GitHub · xianoem/wenbu',
      sourceUrl: `${repository}/releases/tag/${models.release}`,
      pinned: 'Pinned: these models are the ones this version of Wenbu was checked with.',
      platforms: ['win32'],
    },
    supported: process.platform === 'win32' && process.arch === 'x64',
    resolve: Effect.succeed({
      release: {
        version: models.release.replace('manga-engine-models-', ''),
        downloadBytes: totalBytes,
      },
      steps,
      installBytes: totalBytes,
    }),
    test,
    release: runtime.stop,
  }

  return definition
})
