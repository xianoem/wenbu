import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { type Release, UpdateStatus, UpdatesRpc } from '#contract/Updates'
import { MainUpdater } from './MainUpdater'
import { updatesRpc } from './Updates'

const releases: ReadonlyArray<Release> = [
  {
    version: '0.3.0',
    date: '2026-11-13',
    changes: [
      { kind: 'new', area: 'novels', text: 'Novels with a reader' },
      { kind: 'fixed', area: 'overlay', text: 'Overlay keeps its position' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-01',
    changes: [{ kind: 'new', area: 'manga', text: 'Manga translation' }],
  },
  {
    version: '0.1.0',
    date: '2026-10-01',
    changes: [{ kind: 'new', area: 'library', text: 'Library' }],
  },
]

const ready = UpdateStatus.make({ state: 'ready', version: '0.4.0' })

const StoreLayer = KeyValueStore.layerSql().pipe(
  Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
)

const at = (version: string) =>
  updatesRpc({ version, releases }).pipe(Layer.provide(MainUpdater.fixed(ready)))

const whatsNewAt = (version: string) =>
  Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(UpdatesRpc)

    return yield* client.getWhatsNew()
  }).pipe(Effect.provide(at(version)))

describe('Updates', () => {
  it.effect('shows nothing new on a fresh install', () =>
    Effect.gen(function* () {
      const whatsNew = yield* whatsNewAt('0.3.0')

      assert.strictEqual(whatsNew.version, '0.3.0')
      assert.strictEqual(whatsNew.updatedFrom, undefined)
      assert.deepStrictEqual(whatsNew.newAreas, [])
      assert.strictEqual(whatsNew.releases.length, 3)
    }).pipe(Effect.provide(StoreLayer)),
  )

  it.effect('lists what is new across every version skipped by an update', () =>
    Effect.gen(function* () {
      yield* whatsNewAt('0.1.0')

      const whatsNew = yield* whatsNewAt('0.3.0 (dev)')

      assert.strictEqual(whatsNew.version, '0.3.0')
      assert.strictEqual(whatsNew.updatedFrom, '0.1.0')
      assert.deepStrictEqual(whatsNew.newAreas, ['novels', 'manga'])
    }).pipe(Effect.provide(StoreLayer)),
  )

  it.effect('stops announcing the update once it was seen, and keeps the new areas', () =>
    Effect.gen(function* () {
      yield* whatsNewAt('0.2.0')

      const seen = yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UpdatesRpc)

        yield* client.getWhatsNew()

        return yield* client.markWhatsNewSeen()
      }).pipe(Effect.provide(at('0.3.0')))

      assert.strictEqual(seen.updatedFrom, undefined)
      assert.deepStrictEqual(seen.newAreas, ['novels'])

      const later = yield* whatsNewAt('0.3.0')

      assert.strictEqual(later.updatedFrom, undefined)
      assert.deepStrictEqual(later.newAreas, ['novels'])
    }).pipe(Effect.provide(StoreLayer)),
  )

  it.effect('forgets a new area once the user opened it', () =>
    Effect.gen(function* () {
      yield* whatsNewAt('0.1.0')

      const whatsNew = yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UpdatesRpc)

        yield* client.getWhatsNew()

        return yield* client.markAreaSeen({ area: 'novels' })
      }).pipe(Effect.provide(at('0.3.0')))

      assert.deepStrictEqual(whatsNew.newAreas, ['manga'])
      assert.strictEqual(whatsNew.updatedFrom, '0.1.0')
    }).pipe(Effect.provide(StoreLayer)),
  )

  it.effect('announces nothing after a downgrade', () =>
    Effect.gen(function* () {
      yield* whatsNewAt('0.3.0')

      const whatsNew = yield* whatsNewAt('0.2.0')

      assert.strictEqual(whatsNew.updatedFrom, undefined)
      assert.deepStrictEqual(whatsNew.newAreas, [])

      assert.deepStrictEqual(
        whatsNew.releases.map((release) => release.version),
        ['0.2.0', '0.1.0'],
      )
    }).pipe(Effect.provide(StoreLayer)),
  )

  it.effect('relays the updater status from main', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(UpdatesRpc)
      const status = yield* client.watchUpdate().pipe(Stream.runHead)

      assert.deepStrictEqual(Option.getOrThrow(status), ready)
    }).pipe(Effect.provide(Layer.provide(at('0.3.0'), StoreLayer))),
  )
})
