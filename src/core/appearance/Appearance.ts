import { Effect, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { Appearance, AppearanceRpc } from '#contract/Appearance'
import * as SettingsStore from '../platform/SettingsStore'

const defaultAppearance = Appearance.make({ theme: 'system' })

export const AppearanceLive = AppearanceRpc.toLayer(
  Effect.gen(function* () {
    const store = SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      Schema.Struct(Appearance.fields),
      defaultAppearance,
    )

    return AppearanceRpc.of({
      getAppearance: Effect.fn('Appearance.get')(function* () {
        return Appearance.make(yield* Effect.orDie(store.get('appearance')))
      }),
      setAppearance: Effect.fn('Appearance.set')(function* (appearance) {
        yield* Effect.orDie(store.set('appearance', appearance))

        return appearance
      }),
    })
  }),
)
