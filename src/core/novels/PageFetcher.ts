import { Context, Crypto, Deferred, Effect, Layer, Schema } from 'effect'
import { PageFetch, PageFetched } from '#contract/CoreMessages'
import { NovelsError } from '#contract/Novels'

const isPageFetched = Schema.is(PageFetched)

export const Interactive = Context.Reference<boolean>('wenbu/core/novels/Interactive', {
  defaultValue: () => true,
})

export interface FetchedPage {
  readonly status: number
  readonly url: string
  readonly body: string
}

export class PageFetcher extends Context.Service<
  PageFetcher,
  { readonly get: (url: string) => Effect.Effect<FetchedPage, NovelsError> }
>()('wenbu/core/novels/PageFetcher') {
  static readonly live = Layer.effect(
    PageFetcher,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const waiting = new Map<string, Deferred.Deferred<PageFetched>>()

      const receive = (event: Electron.MessageEvent) => {
        if (!isPageFetched(event.data)) {
          return
        }

        const deferred = waiting.get(event.data.id)

        if (deferred !== undefined) {
          waiting.delete(event.data.id)
          Deferred.doneUnsafe(deferred, Effect.succeed(event.data))
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => process.parentPort.on('message', receive)),
        () => Effect.sync(() => process.parentPort.off('message', receive)),
      )

      const get = Effect.fn('PageFetcher.get')(function* (url: string) {
        const id = yield* Effect.orDie(crypto.randomUUIDv7())
        const deferred = yield* Deferred.make<PageFetched>()
        const interactive = yield* Interactive

        waiting.set(id, deferred)
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
        process.parentPort.postMessage(PageFetch.make({ id, url, interactive }))

        const page = yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: '3 minutes',
            orElse: () =>
              Effect.fail(
                new NovelsError({
                  reason: 'site',
                  message: `${new URL(url).hostname} did not answer.`,
                }),
              ),
          }),
          Effect.ensuring(Effect.sync(() => waiting.delete(id))),
        )

        if (page.problem !== undefined) {
          return yield* new NovelsError({ reason: 'site', message: page.problem })
        }

        return { status: page.status, url: page.url, body: page.body }
      })

      return PageFetcher.of({ get })
    }),
  )
}
