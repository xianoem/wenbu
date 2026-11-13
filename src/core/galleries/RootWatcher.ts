// Effect's FileSystem.watch drops the events Windows sends when its buffer overflows.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { watch } from 'node:fs'
import { Context, Effect, Layer, Option, Queue, Stream } from 'effect'

export class RootWatcher extends Context.Service<
  RootWatcher,
  { readonly watch: (root: string) => Stream.Stream<Option.Option<string>> }
>()('wenbu/core/galleries/RootWatcher') {
  static readonly live = Layer.succeed(RootWatcher)({
    watch: (root) =>
      Stream.callback<Option.Option<string>>((queue) =>
        Effect.acquireRelease(
          Effect.try(() =>
            watch(root, { recursive: true }, (_event, name) => {
              Queue.offerUnsafe(queue, Option.fromNullishOr(name))
            }),
          ).pipe(
            Effect.tap((watcher) =>
              Effect.sync(() => watcher.on('error', () => Queue.endUnsafe(queue))),
            ),
            Effect.option,
            Effect.tap((watcher) =>
              Option.isNone(watcher) ? Effect.sync(() => Queue.endUnsafe(queue)) : Effect.void,
            ),
          ),
          (watcher) => Effect.sync(() => Option.map(watcher, (open) => open.close())),
        ),
      ),
  })
}
