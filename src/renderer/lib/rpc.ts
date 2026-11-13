import { RegistryContext } from '@effect/atom-react'
import * as BrowserWorker from '@effect/platform-browser/BrowserWorker'
import { useCallback, useContext } from 'react'
import { Effect, Layer } from 'effect'
import { AtomRegistry, AtomRpc } from 'effect/reactivity'
import { type Rpc, RpcClient, type RpcGroup } from 'effect/rpc'
import { WenbuRpc } from '#contract/WenbuRpc'
import { bridgeChannels } from '#contract/Bridge'

const requestCorePort = Effect.callback<MessagePort>((resume) => {
  const receive = (event: MessageEvent) => {
    const port = event.ports[0]

    if (event.source !== window || event.data !== bridgeChannels.corePort || port === undefined) {
      return
    }

    window.removeEventListener('message', receive)
    resume(Effect.succeed(port))
  }

  window.addEventListener('message', receive)
  window.postMessage(bridgeChannels.requestCorePort, '*')

  return Effect.sync(() => window.removeEventListener('message', receive))
})

const CorePortLive = Layer.unwrap(
  Effect.map(requestCorePort, (port) => BrowserWorker.layer(() => port)),
)

export class Core extends AtomRpc.Service<Core>()('Core', {
  group: WenbuRpc,
  // One port carries every request; the default of one at a time lets a long stream block the rest.
  protocol: RpcClient.layerProtocolWorker({ size: 1, concurrency: 1_000 }).pipe(
    Layer.provide(CorePortLive),
  ),
}) {}

type Rpcs = RpcGroup.Rpcs<typeof WenbuRpc>

export type PayloadOf<Tag extends Rpc.Tag<Rpcs>> = Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Tag>>

/** `Core.mutation` interrupts the call before it, which loses edits made in a loop; this does not. */
export const concurrentMutation = <P, A, E>(
  call: (client: Core['Service'], payload: P) => Effect.Effect<A, E>,
) =>
  Core.runtime.fn(
    Effect.fnUntraced(function* ({ payload }: { readonly payload: P }) {
      return yield* call(yield* Core, payload)
    }),
    { concurrent: true },
  )

/** A mutation atom resolves with whichever call finished last, so calls that overlap need this. */
export function useCoreCall() {
  const registry = useContext(RegistryContext)

  return useCallback(
    <A, E>(call: (client: Core['Service']) => Effect.Effect<A, E>) =>
      Effect.runPromiseExit(
        AtomRegistry.getResult(registry, Core.runtime).pipe(
          Effect.flatMap((context) =>
            Effect.gen(function* () {
              return yield* call(yield* Core)
            }).pipe(Effect.provide(context)),
          ),
        ),
      ),
    [registry],
  )
}
