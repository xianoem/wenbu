import { Effect, Stream } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import type { PluginId, PluginsState } from '#contract/Plugins'
import { Core } from '#lib/rpc'

export const pluginsAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchPlugins', undefined)
    }),
  ),
)

export const isPluginReady = (
  result: AsyncResult.AsyncResult<PluginsState, unknown>,
  id: PluginId,
) =>
  AsyncResult.isSuccess(result) &&
  result.value.plugins.some((plugin) => plugin.id === id && plugin.installed?.test.passed === true)

export const checkPluginUpdatesAtom = Core.mutation('checkPluginUpdates')

export const installPluginAtom = Core.mutation('installPlugin')

export const cancelPluginInstallAtom = Core.mutation('cancelPluginInstall')

export const removePluginAtom = Core.mutation('removePlugin')

export const testPluginAtom = Core.mutation('testPlugin')
