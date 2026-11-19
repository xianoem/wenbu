import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Predicate, Ref, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { BackgroundRpc, defaultBackgroundSettings } from '#contract/Background'
import { Background, BackgroundRpcLive, NoticeRun } from './Background'

const TestLayer = BackgroundRpcLive.pipe(
  Layer.provideMerge(Background.layer),
  Layer.provide(KeyValueStore.layerSql()),
  Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
)

const firstActivity = Effect.fnUntraced(function* () {
  const client = yield* RpcTest.makeClient(BackgroundRpc)

  return yield* client.watchActivity().pipe(Stream.take(1), Stream.runCollect)
})

describe('Background', () => {
  it.effect('keeps Wenbu in the tray and asks on the first close by default', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(BackgroundRpc)
      const settings = yield* client.getBackgroundSettings()

      assert.deepStrictEqual(settings, defaultBackgroundSettings)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('remembers the answer to the first close', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(BackgroundRpc)

      yield* client.saveBackgroundSettings({
        ...defaultBackgroundSettings,
        closeAction: 'quit',
        closeAsked: true,
      })

      const settings = yield* client.getBackgroundSettings()

      assert.strictEqual(settings.closeAction, 'quit')
      assert.isTrue(settings.closeAsked)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('lists what every feature reports as running', () =>
    Effect.gen(function* () {
      const background = yield* Background

      yield* background.track('downloads', [
        { id: 'job-1', kind: 'download', title: 'Afterglow', done: 3, total: 10 },
      ])

      yield* background.track('overlay', [{ id: 'overlay', kind: 'overlay', title: 'Hoshizora' }])

      const [running] = yield* firstActivity()

      assert.deepStrictEqual(
        running?.map((item) => item.id),
        ['job-1', 'overlay'],
      )
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('drops a feature from the list once it reports nothing running', () =>
    Effect.gen(function* () {
      const background = yield* Background

      yield* background.track('downloads', [{ id: 'job-1', kind: 'download', title: 'Afterglow' }])
      yield* background.track('overlay', [{ id: 'overlay', kind: 'overlay', title: 'Hoshizora' }])
      yield* background.track('downloads', [])

      const [running] = yield* firstActivity()

      assert.deepStrictEqual(
        running?.map((item) => item.id),
        ['overlay'],
      )
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('sends a notification for a kind the user wants', () =>
    Effect.gen(function* () {
      const background = yield* Background
      const notices = yield* background.notices

      yield* background.notify({
        kind: 'downloads',
        title: 'Afterglow is downloaded',
        body: '41 pages',
        buttons: [],
      })

      const [shown] = yield* notices.pipe(Stream.take(1), Stream.runCollect)

      assert.strictEqual(shown?.title, 'Afterglow is downloaded')
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )

  it.effect('stays quiet for a kind the user turned off', () =>
    Effect.gen(function* () {
      const background = yield* Background
      const notices = yield* background.notices

      yield* background.saveSettings({
        ...defaultBackgroundSettings,
        notify: { ...defaultBackgroundSettings.notify, downloads: false },
      })

      yield* background.notify({ kind: 'downloads', title: 'Hidden', body: '', buttons: [] })
      yield* background.notify({ kind: 'runs', title: 'Shown', body: '', buttons: [] })

      const [shown] = yield* notices.pipe(Stream.take(1), Stream.runCollect)

      assert.strictEqual(shown?.title, 'Shown')
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )

  it.effect('runs the action behind the button the user pressed', () =>
    Effect.gen(function* () {
      const background = yield* Background
      const notices = yield* background.notices
      const pressed = yield* Ref.make<string | undefined>(undefined)

      yield* background.notify({
        kind: 'answer',
        title: 'Download this gallery?',
        body: '',
        buttons: [
          new NoticeRun({ label: 'Download', run: Ref.set(pressed, 'download') }),
          new NoticeRun({ label: 'Ignore', run: Ref.set(pressed, 'ignore') }),
        ],
      })

      const [shown] = yield* notices.pipe(Stream.take(1), Stream.runCollect)

      assert.isTrue(shown?.buttons.every((button) => Predicate.isTagged(button, 'NoticeReply')))

      yield* background.reply(shown?.id ?? '', 0)

      assert.strictEqual(yield* Ref.get(pressed), 'download')
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )
})
