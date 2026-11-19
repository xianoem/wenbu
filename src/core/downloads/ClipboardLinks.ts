import { Context, Effect, Layer, Queue, Schema, Stream } from 'effect'
import { ClipboardLink } from '#contract/CoreMessages'

const isClipboardLink = Schema.is(ClipboardLink)

export class ClipboardLinks extends Context.Service<
  ClipboardLinks,
  { readonly links: Stream.Stream<ClipboardLink> }
>()('wenbu/core/downloads/ClipboardLinks') {
  static readonly fromQueue = (queue: Queue.Dequeue<ClipboardLink>) =>
    Layer.succeed(ClipboardLinks, ClipboardLinks.of({ links: Stream.fromQueue(queue) }))

  static readonly live = Layer.effect(
    ClipboardLinks,
    Effect.gen(function* () {
      const links = yield* Queue.unbounded<ClipboardLink>()

      const receive = (event: Electron.MessageEvent) => {
        if (isClipboardLink(event.data)) {
          Queue.offerUnsafe(links, event.data)
        }
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => process.parentPort.on('message', receive)),
        () => Effect.sync(() => process.parentPort.off('message', receive)),
      )

      return ClipboardLinks.of({ links: Stream.fromQueue(links) })
    }),
  )
}
