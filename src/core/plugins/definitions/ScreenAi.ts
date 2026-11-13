import { Config, Effect, FileSystem, Option, Path, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { unzlibSync } from 'fflate'
import { PluginError } from '#contract/Plugins'
import { ocrText } from '../../detections/OcrText'
import { ScreenAiOcr } from '../../detections/ScreenAiOcr'
import { readZip } from '../Archives'
import { contentLength, download } from '../Downloads'
import {
  failed,
  onDisk,
  type InstallStepDefinition,
  type PluginDefinition,
  platformKey,
  servicesProvider,
  writeFiles,
} from '../PluginDefinition'

const server = 'https://chrome-infra-packages.appspot.com/prpc/cipd.Repository'

const packages: Record<string, string> = {
  'win32-x64': 'chromium/third_party/screen-ai/windows-amd64',
  'linux-x64': 'chromium/third_party/screen-ai/linux',
}

const Instance = Schema.Struct({ hashAlgo: Schema.Literal('SHA256'), hexDigest: Schema.String })

const Resolved = Schema.Struct({ instance: Instance })

const Described = Schema.Struct({
  instance: Schema.Struct({ registeredTs: Schema.String }),
  tags: Schema.optional(Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String }))),
})

const SignedUrl = Schema.Struct({ signedUrl: Schema.String })

const sampleSize = { width: 240, height: 64 }

const unavailable = (message: string) => new PluginError({ reason: 'unavailable', message })

export const makeScreenAi = Effect.gen(function* () {
  const provided = yield* servicesProvider
  const ocr = yield* ScreenAiOcr
  const resources = yield* Config.String('WENBU_RESOURCES_DIR')
  const packageName = packages[platformKey]

  const call = <S extends Schema.Top>(method: string, body: object, schema: S) =>
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const request = HttpClientRequest.post(`${server}/${method}`).pipe(
        HttpClientRequest.setHeader('Accept', 'application/json'),
        HttpClientRequest.bodyJsonUnsafe(body),
      )

      const text = yield* client.execute(request).pipe(
        Effect.flatMap((response) => response.text),
        Effect.mapError(() => unavailable("Google's package server could not be reached.")),
      )

      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
        text.replace(/^\)\]\}'\n/, ''),
      ).pipe(
        Effect.mapError(() =>
          unavailable("Google's package server sent an answer Wenbu could not read."),
        ),
      )
    })

  const resolve = Effect.gen(function* () {
    if (packageName === undefined) {
      return yield* new PluginError({
        reason: 'unsupported',
        message: 'Screen AI does not run on this computer.',
      })
    }

    const { instance } = yield* call(
      'ResolveVersion',
      { package: packageName, version: 'latest' },
      Resolved,
    )

    const described = yield* call(
      'DescribeInstance',
      { package: packageName, instance, describeTags: true },
      Described,
    )

    const { signedUrl } = yield* call(
      'GetInstanceURL',
      { package: packageName, instance },
      SignedUrl,
    )

    const version =
      described.tags?.find((tag) => tag.key === 'version')?.value ?? instance.hexDigest.slice(0, 12)

    const size = yield* contentLength(signedUrl)
    let sha256 = ''

    const steps: ReadonlyArray<InstallStepDefinition> = [
      {
        label: 'Download',
        run: (step) =>
          provided(download(signedUrl, `${step.work}/screen-ai.zip`, step.progress)).pipe(
            Effect.map((result) => {
              sha256 = result.sha256
            }),
          ),
      },
      {
        label: 'Check the download',
        run: () =>
          sha256 === instance.hexDigest
            ? Effect.void
            : Effect.fail(failed('The download does not match the checksum Google publishes.')),
      },
      {
        label: 'Unpack',
        run: (step) =>
          provided(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem

              const zip = yield* onDisk(
                fs.readFile(`${step.work}/screen-ai.zip`),
                'The download could not be read.',
              )

              const files = yield* readZip(zip, (name) =>
                name.startsWith('resources/') ? name.slice('resources/'.length) : undefined,
              ).pipe(Effect.mapError((error) => failed(error.message)))

              yield* step.detail(`${files.length} files`)
              yield* onDisk(writeFiles(step.folder, files), 'The files could not be written.')
            }),
          ),
      },
    ]

    return {
      release: {
        version,
        publishedAt: described.instance.registeredTs,
        ...Option.match(size, {
          onNone: () => ({}),
          onSome: (downloadBytes) => ({ downloadBytes }),
        }),
      },
      steps,
    }
  }).pipe(provided)

  const test = Effect.fn('ScreenAi.test')(function* (folder: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const sample = yield* onDisk(
      fs.readFile(path.join(resources, 'samples', 'ocr-sample-240x64.rgba.z')),
      "Wenbu's sample image is missing.",
    )

    const result = yield* ocr
      .recognize(folder, { ...sampleSize, pixels: unzlibSync(sample) })
      .pipe(Effect.mapError((error) => failed(error.message)))

    const text = ocrText(result)

    return text.includes('Wenbu')
      ? 'Read the sample image.'
      : yield* failed(
          text === ''
            ? 'Screen AI found no text in the sample image.'
            : `Screen AI read the sample image as “${text}”.`,
        )
  }, provided)

  const definition: PluginDefinition = {
    meta: {
      id: 'screen-ai',
      name: 'Detections',
      description: 'On-device text recognition from Chrome.',
      project: 'Chrome Screen AI',
      license: 'Google proprietary',
      sourceLabel: 'Google package server',
      sourceUrl: 'https://chrome-infra-packages.appspot.com/p/chromium/third_party/screen-ai',
      platforms: ['win32', 'linux'],
    },
    supported: packageName !== undefined,
    resolve,
    test,
    release: ocr.stop,
  }

  return definition
})
