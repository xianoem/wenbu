import { Config, Context, Effect, type FileSystem, Layer, Option, type Path, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { defaultMangaSettings, MangaSettings } from '#contract/Manga'
import { PicturesError, Rgb } from '#contract/Pictures'
import { mangaSettingsKey } from '../manga/Manga'
import { workerOptions } from '../manga/MangaOptions'
import { MangaRuntime } from '../manga/MangaRuntime'
import * as SettingsStore from '../platform/SettingsStore'
import { Plugins } from '../plugins/Plugins'

export type Box = readonly [number, number, number, number]

export interface LineColours {
  readonly fill: Rgb
  readonly outline: Rgb | undefined
}

const Cleaned = Schema.Struct({
  lines: Schema.Array(Schema.Struct({ fill: Rgb, outline: Schema.NullOr(Rgb) })),
})

const decodeCleaned = Schema.decodeUnknownEffect(Cleaned)

const notInstalled = () =>
  new PicturesError({
    reason: 'not-ready',
    message: 'Install a manga engine on the Plugins page to clean pictures.',
  })

export class PictureCleaner extends Context.Service<
  PictureCleaner,
  {
    readonly ready: Effect.Effect<boolean>
    readonly clean: (
      source: string,
      output: string,
      boxes: ReadonlyArray<Box>,
    ) => Effect.Effect<ReadonlyArray<LineColours>, PicturesError>
  }
>()('wenbu/core/pictures/PictureCleaner') {
  static readonly layer = Layer.effect(
    PictureCleaner,
    Effect.gen(function* () {
      const plugins = yield* Plugins
      const runtime = yield* MangaRuntime
      const resources = yield* Config.String('WENBU_RESOURCES_DIR')
      const dataDir = yield* Config.String('WENBU_DATA_DIR')
      const files = yield* Effect.context<Path.Path | FileSystem.FileSystem>()

      const mangaSettings = SettingsStore.make(
        yield* KeyValueStore.KeyValueStore,
        MangaSettings,
        defaultMangaSettings,
      )

      const clean = Effect.fn('PictureCleaner.clean')(function* (
        source: string,
        output: string,
        boxes: ReadonlyArray<Box>,
      ) {
        const engine = yield* plugins.mangaEngine

        if (Option.isNone(engine)) {
          return yield* notInstalled()
        }

        const settings = yield* Effect.orDie(mangaSettings.get(mangaSettingsKey))

        const screenAi = yield* plugins.installedFolder('screen-ai')

        const options = yield* workerOptions(settings, engine.value.folder, {
          resources,
          dataDir,
          screenAi,
        }).pipe(Effect.provideContext(files), Effect.orDie)

        const result = yield* runtime
          .editor(engine.value, {
            op: 'picture',
            options: { ...options, output_format: 'png' },
            source,
            output,
            blocks: boxes.map((box) => ({ box: [box[0], box[1], box[2], box[3]] })),
          })
          .pipe(
            Effect.mapError(
              (error) => new PicturesError({ reason: 'failed', message: error.message }),
            ),
          )

        const cleaned = yield* decodeCleaned(result).pipe(
          Effect.mapError(
            () =>
              new PicturesError({
                reason: 'failed',
                message: 'The manga engine answered with something Wenbu could not read.',
              }),
          ),
        )

        return cleaned.lines.map((line): LineColours => ({
          fill: line.fill,
          outline: line.outline ?? undefined,
        }))
      })

      return PictureCleaner.of({
        ready: Effect.map(plugins.mangaEngine, (engine) => Option.isSome(engine)),
        clean,
      })
    }),
  )
}
