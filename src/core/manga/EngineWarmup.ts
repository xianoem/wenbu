import { Effect, Option, Stream } from 'effect'
import type { Plugins } from '../plugins/Plugins'
import type { MangaRuntime, MangaWorker } from './MangaRuntime'

const warmable = (engine: Option.Option<MangaWorker>) =>
  Option.filter(
    engine,
    (worker) => worker.engine === 'manga-engine' && Option.isSome(worker.nvidia),
  )

const keyOf = (worker: Option.Option<MangaWorker>) =>
  Option.match(worker, {
    onNone: () => '',
    onSome: (value) => `${value.folder}|${Option.getOrElse(value.nvidia, () => '')}`,
  })

/**
 * Warms the native engine as soon as it can use the NVIDIA pack, so the first run does not wait for
 * it. The engine at start-up is left alone: launching it on every app start costs memory, and the
 * next run warms whatever is left.
 */
export const warmOnEngineChange = (
  plugins: Pick<Plugins['Service'], 'state' | 'mangaEngine'>,
  runtime: Pick<MangaRuntime['Service'], 'warm'>,
) =>
  plugins.state.pipe(
    Stream.mapEffect(() => Effect.map(plugins.mangaEngine, (engine) => warmable(engine))),
    Stream.changesWith((left, right) => keyOf(left) === keyOf(right)),
    Stream.drop(1),
    Stream.runForEach((worker) =>
      Option.match(worker, {
        onNone: () => Effect.void,
        onSome: (value) =>
          runtime
            .warm(value)
            .pipe(
              Effect.catchTag('MangaError', (error) =>
                Effect.logWarning('Manga engine could not start to warm up').pipe(
                  Effect.annotateLogs({ detail: error.message }),
                ),
              ),
            ),
      }),
    ),
  )
