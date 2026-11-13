import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { Appearance, AppearanceRpc } from '#contract/Appearance'
import { AppearanceLive } from './Appearance'

const TestLayer = AppearanceLive.pipe(
  Layer.provideMerge(KeyValueStore.layerSql()),
  Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
)

describe('Appearance', () => {
  it.effect('defaults to the system theme', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AppearanceRpc)
      const appearance = yield* client.getAppearance()

      assert.strictEqual(appearance.theme, 'system')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('persists the chosen theme', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AppearanceRpc)

      yield* client.setAppearance(Appearance.make({ theme: 'dark' }))

      const appearance = yield* client.getAppearance()

      assert.strictEqual(appearance.theme, 'dark')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('falls back to the system theme when the saved one no longer exists', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AppearanceRpc)
      const store = yield* KeyValueStore.KeyValueStore

      yield* store.set('appearance', '{"theme":"sepia"}')

      const appearance = yield* client.getAppearance()

      assert.strictEqual(appearance.theme, 'system')
    }).pipe(Effect.provide(TestLayer)),
  )
})
