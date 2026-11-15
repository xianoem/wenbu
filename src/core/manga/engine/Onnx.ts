import { createRequire } from 'node:module'
import { Clock, Config, Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import type { InferenceSession, Tensor } from 'onnxruntime-common'
import { MangaError } from '#contract/Manga'

type OrtModule = {
  readonly InferenceSession: typeof InferenceSession
  readonly Tensor: typeof Tensor
}

export type Session = InferenceSession

export type Device = 'DirectML' | 'CPU'

const failed = (message: string) => new MangaError({ reason: 'failed', message })

/** Picks the DirectML adapter that runs the probe model fastest, so a laptop uses its discrete GPU. */
const fastestAdapter = Effect.fnUntraced(function* (ort: OrtModule, probe: string) {
  let best: { readonly id: number; readonly millis: number } | undefined

  const input = new ort.Tensor('float32', new Float32Array(1024 * 1024), [1024, 1024])

  const time = Effect.fnUntraced(function* (deviceId: number) {
    const session = yield* Effect.tryPromise(() =>
      ort.InferenceSession.create(probe, {
        executionProviders: [{ name: 'dml', deviceId }],
        enableMemPattern: false,
      }),
    )

    yield* Effect.tryPromise(() => session.run({ x: input }))

    let millis = Number.POSITIVE_INFINITY

    for (let run = 0; run < 3; run += 1) {
      const started = yield* Clock.currentTimeMillis

      yield* Effect.tryPromise(() => session.run({ x: input }))

      millis = Math.min(millis, (yield* Clock.currentTimeMillis) - started)
    }

    yield* Effect.tryPromise(() => session.release())

    return millis
  })

  for (const id of [0, 1, 2, 3]) {
    const timed = yield* Effect.option(time(id))

    if (Option.isSome(timed) && (best === undefined || timed.value < best.millis)) {
      best = { id, millis: timed.value }
    }
  }

  return Option.fromNullishOr(best?.id)
})

export class Onnx extends Context.Service<
  Onnx,
  {
    readonly ort: OrtModule
    readonly device: Device
    readonly models: string
    readonly session: (
      file: string,
      dimensions?: Readonly<Record<string, number>>,
    ) => Effect.Effect<Session, MangaError>
  }
>()('wenbu/core/manga/engine/Onnx') {
  static readonly layer = Layer.effect(
    Onnx,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const folder = yield* Config.String('WENBU_MANGA_ENGINE_DIR').pipe(
        Config.orElse(() => Config.String('WENBU_MANGA_ENGINE_FOLDER')),
        Effect.mapError(() => failed('The manga engine was started without its folder.')),
      )

      const ort = yield* Effect.try({
        try: () =>
          // SAFETY: the plugin installs the pinned onnxruntime-node whose API OrtModule describes.
          createRequire(path.join(folder, 'runtime', 'package.json'))(
            'onnxruntime-node',
          ) as OrtModule,
        catch: (error) => failed(`ONNX Runtime could not be loaded: ${String(error)}`),
      })

      const models = path.join(folder, 'models')
      const probe = path.join(models, 'probe.onnx')
      const override = yield* Config.Int('WENBU_MANGA_ENGINE_DML_DEVICE').pipe(Config.option)

      const adapter = Option.isSome(override)
        ? override
        : yield* Effect.flatMap(fs.exists(probe), (exists) =>
            exists ? fastestAdapter(ort, probe) : Effect.succeedNone,
          ).pipe(Effect.orElseSucceed(() => Option.none<number>()))

      const device: Device = Option.isSome(adapter) ? 'DirectML' : 'CPU'

      const options = (): InferenceSession.SessionOptions =>
        Option.match(adapter, {
          onNone: () => ({ executionProviders: ['cpu'], graphOptimizationLevel: 'all' }),
          onSome: (deviceId) => ({
            executionProviders: [{ name: 'dml', deviceId }],
            graphOptimizationLevel: 'all',
            enableMemPattern: false,
          }),
        })

      const session = Effect.fn('Onnx.session')(function* (
        file: string,
        dimensions?: Readonly<Record<string, number>>,
      ) {
        return yield* Effect.tryPromise({
          try: () =>
            ort.InferenceSession.create(path.join(models, file), {
              ...options(),
              ...(dimensions === undefined ? {} : { freeDimensionOverrides: { ...dimensions } }),
            }),
          catch: (error) => failed(`The model ${file} could not be loaded: ${String(error)}`),
        })
      })

      return Onnx.of({ ort, device, models, session })
    }),
  )
}
