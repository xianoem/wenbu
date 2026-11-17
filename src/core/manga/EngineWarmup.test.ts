import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Option, Ref, Stream, SubscriptionRef } from 'effect'
import type { MangaEngine } from '../plugins/Plugins'
import { warmOnEngineChange } from './EngineWarmup'

const native = (nvidia: Option.Option<string>): Option.Option<MangaEngine> =>
  Option.some({ engine: 'manga-engine', folder: 'C:/plugins/manga-engine', nvidia })

const python: Option.Option<MangaEngine> = Option.some({
  engine: 'manga-image-translator',
  folder: 'C:/plugins/mit',
  nvidia: Option.none(),
})

describe('warmOnEngineChange', () => {
  it.live('warms the native engine when its NVIDIA pack arrives, not at start-up', () =>
    Effect.gen(function* () {
      const engine = yield* SubscriptionRef.make(native(Option.some('C:/plugins/nvidia')))
      const warmed = yield* Ref.make<ReadonlyArray<string>>([])

      const fiber = yield* warmOnEngineChange(
        {
          state: Stream.map(SubscriptionRef.changes(engine), () => ({
            plugins: [],
            checking: false,
          })),
          mangaEngine: SubscriptionRef.get(engine),
        },
        {
          warm: (worker) => Ref.update(warmed, (all) => [...all, worker.engine]),
        },
      ).pipe(Effect.forkChild)

      const settle = Effect.sleep('50 millis')

      yield* settle
      yield* SubscriptionRef.set(engine, native(Option.none()))
      yield* settle
      yield* SubscriptionRef.set(engine, native(Option.some('C:/plugins/nvidia')))
      yield* settle
      yield* SubscriptionRef.set(engine, native(Option.some('C:/plugins/nvidia')))
      yield* settle
      yield* SubscriptionRef.set(engine, python)
      yield* settle

      yield* Fiber.interrupt(fiber)

      expect(yield* Ref.get(warmed)).toEqual(['manga-engine'])
    }),
  )
})
