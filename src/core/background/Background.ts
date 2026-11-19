import {
  Context,
  Data,
  Effect,
  Layer,
  Predicate,
  PubSub,
  Ref,
  type Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  type ActivityItem,
  type AppTarget,
  BackgroundRpc,
  BackgroundSettings,
  defaultBackgroundSettings,
  type NoticeKind,
} from '#contract/Background'
import { type NoticeButton, NoticeReply, ShowNotice } from '#contract/CoreMessages'
import * as SettingsStore from '../platform/SettingsStore'

export class NoticeRun extends Data.TaggedClass('NoticeRun')<{
  readonly label: string
  readonly run: Effect.Effect<void>
}> {}

export type NoticeAction = Exclude<NoticeButton, typeof NoticeReply.Type> | NoticeRun

export interface Notice {
  /** An answer to something the user just did, such as copying a link, shows whatever the settings say. */
  readonly kind: NoticeKind | 'answer'
  readonly title: string
  readonly body: string
  readonly target?: AppTarget
  readonly buttons: ReadonlyArray<NoticeAction>
}

const settingsKey = 'background'

// Windows keeps a few notifications in the Action Center; older answers have nowhere to go.
const keptReplies = 50

const allowed = (settings: BackgroundSettings, kind: Notice['kind']) =>
  kind === 'answer' || settings.notify[kind]

const toButton = (action: NoticeAction): NoticeButton =>
  Predicate.isTagged(action, 'NoticeRun') ? NoticeReply.make({ label: action.label }) : action

export class Background extends Context.Service<
  Background,
  {
    readonly settings: Effect.Effect<BackgroundSettings>
    readonly saveSettings: (settings: BackgroundSettings) => Effect.Effect<BackgroundSettings>
    readonly settingsChanges: Stream.Stream<BackgroundSettings>
    /** Replaces everything `source` reported before; an empty list means it is idle. */
    readonly track: (source: string, items: ReadonlyArray<ActivityItem>) => Effect.Effect<void>
    readonly activity: Stream.Stream<ReadonlyArray<ActivityItem>>
    readonly notify: (notice: Notice) => Effect.Effect<void>
    readonly notices: Effect.Effect<Stream.Stream<ShowNotice>, never, Scope.Scope>
    readonly reply: (id: string, button: number) => Effect.Effect<void>
  }
>()('wenbu/core/background/Background') {
  static readonly layer = Layer.effect(
    Background,
    Effect.gen(function* () {
      const store = SettingsStore.make(
        yield* KeyValueStore.KeyValueStore,
        BackgroundSettings,
        defaultBackgroundSettings,
      )

      const settings = yield* SubscriptionRef.make(yield* Effect.orDie(store.get(settingsKey)))

      const sources = yield* SubscriptionRef.make<ReadonlyMap<string, ReadonlyArray<ActivityItem>>>(
        new Map(),
      )

      const shown = yield* PubSub.unbounded<ShowNotice>()
      const replies = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<NoticeAction>>>(new Map())
      const counter = yield* Ref.make(0)

      const saveSettings = Effect.fn('Background.saveSettings')(function* (
        next: BackgroundSettings,
      ) {
        yield* Effect.orDie(store.set(settingsKey, next))
        yield* SubscriptionRef.set(settings, next)

        return next
      })

      const track = Effect.fnUntraced(function* (
        source: string,
        items: ReadonlyArray<ActivityItem>,
      ) {
        yield* SubscriptionRef.update(sources, (current) => {
          const next = new Map(current)

          if (items.length === 0) {
            next.delete(source)
          } else {
            next.set(source, items)
          }

          return next
        })
      })

      const remember = (id: string, buttons: ReadonlyArray<NoticeAction>) =>
        Ref.update(replies, (current) => {
          const next = new Map([...current, [id, buttons] as const])

          return next.size > keptReplies ? new Map([...next].slice(-keptReplies)) : next
        })

      const notify = Effect.fn('Background.notify')(function* (notice: Notice) {
        if (!allowed(yield* SubscriptionRef.get(settings), notice.kind)) {
          return
        }

        const id = `notice-${yield* Ref.updateAndGet(counter, (count) => count + 1)}`

        yield* remember(id, notice.buttons)

        yield* PubSub.publish(
          shown,
          ShowNotice.make({
            id,
            title: notice.title,
            body: notice.body,
            target: notice.target,
            buttons: notice.buttons.map((button) => toButton(button)),
          }),
        )
      })

      const reply = Effect.fn('Background.reply')(function* (id: string, button: number) {
        const action = (yield* Ref.get(replies)).get(id)?.[button]

        if (action instanceof NoticeRun) {
          yield* action.run
        }
      })

      return Background.of({
        settings: SubscriptionRef.get(settings),
        saveSettings,
        settingsChanges: SubscriptionRef.changes(settings),
        track,
        activity: SubscriptionRef.changes(sources).pipe(
          Stream.map((current) => [...current.values()].flat()),
        ),
        notify,
        notices: Effect.map(PubSub.subscribe(shown), (subscription) =>
          Stream.fromSubscription(subscription),
        ),
        reply,
      })
    }),
  )
}

export const BackgroundRpcLive = BackgroundRpc.toLayer(
  Effect.gen(function* () {
    const background = yield* Background

    return BackgroundRpc.of({
      getBackgroundSettings: () => background.settings,
      saveBackgroundSettings: (settings) => background.saveSettings(settings),
      watchActivity: () => background.activity,
    })
  }),
)
