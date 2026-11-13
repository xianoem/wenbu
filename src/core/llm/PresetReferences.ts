import { Context, Effect, Layer, Ref } from 'effect'

export interface PresetReference {
  readonly area: string
  readonly uses: (presetIds: ReadonlySet<string>) => Effect.Effect<boolean>
  readonly clear: (presetIds: ReadonlySet<string>) => Effect.Effect<void>
}

export class PresetReferences extends Context.Service<
  PresetReferences,
  {
    readonly register: (reference: PresetReference) => Effect.Effect<void>
    readonly areasUsing: (presetIds: ReadonlySet<string>) => Effect.Effect<ReadonlyArray<string>>
    readonly clear: (presetIds: ReadonlySet<string>) => Effect.Effect<void>
  }
>()('wenbu/core/llm/PresetReferences') {
  static readonly layer = Layer.effect(
    PresetReferences,
    Effect.gen(function* () {
      const references = yield* Ref.make<ReadonlyArray<PresetReference>>([])

      const areasUsing = (presetIds: ReadonlySet<string>) =>
        Effect.flatMap(Ref.get(references), (all) =>
          Effect.filter(all, (reference) => reference.uses(presetIds)).pipe(
            Effect.map((using) => using.map((reference) => reference.area)),
          ),
        )

      return PresetReferences.of({
        register: (reference) => Ref.update(references, (all) => [...all, reference]),
        areasUsing,
        clear: (presetIds) =>
          Effect.flatMap(Ref.get(references), (all) =>
            Effect.forEach(all, (reference) => reference.clear(presetIds), { discard: true }),
          ),
      })
    }),
  )
}
