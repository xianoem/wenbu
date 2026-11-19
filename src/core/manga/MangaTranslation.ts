import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { MangaError } from '#contract/Manga'
import type { NotEnoughSpace } from '#contract/Storage'

export interface FolderTranslator {
  readonly ready: Effect.Effect<boolean>
  readonly translate: (folder: string) => Effect.Effect<void, MangaError | NotEnoughSpace>
}

/** Lets other features start a manga run, such as Downloads after a gallery arrives. */
export class MangaTranslation extends Context.Service<
  MangaTranslation,
  {
    readonly register: (translator: FolderTranslator) => Effect.Effect<void>
    readonly translator: Effect.Effect<Option.Option<FolderTranslator>>
  }
>()('wenbu/core/manga/MangaTranslation') {
  static readonly layer = Layer.effect(
    MangaTranslation,
    Effect.gen(function* () {
      const current = yield* Ref.make(Option.none<FolderTranslator>())

      return MangaTranslation.of({
        register: (translator) => Ref.set(current, Option.some(translator)),
        translator: Ref.get(current),
      })
    }),
  )
}
