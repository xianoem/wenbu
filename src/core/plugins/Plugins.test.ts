import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, FileSystem, Layer, Option, Path, Schema, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { PluginError, type PluginsState } from '#contract/Plugins'
import { reserveBytes } from '#contract/Storage'
import { DiskSpace } from '../platform/DiskSpace'
import type { InstallStepDefinition, PluginDefinition } from './PluginDefinition'
import { Plugins } from './Plugins'

const meta = {
  id: 'luna-hook',
  name: 'LunaHook',
  description: 'Reads text from running games.',
  project: 'LunaHook',
  license: 'GPL-3.0',
  sourceLabel: 'GitHub · HIllya51/LunaTranslator',
  sourceUrl: 'https://github.com/HIllya51/LunaTranslator',
  platforms: ['win32'],
} as const

const fakePlugin = (options: {
  readonly version?: string
  readonly failAt?: string
  readonly testFails?: boolean
  readonly hold?: Deferred.Deferred<void>
}): Effect.Effect<PluginDefinition, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const version = options.version ?? 'v12.1.2.14'

    const step = (label: string): InstallStepDefinition => ({
      label,
      run: (context) =>
        Effect.gen(function* () {
          if (options.hold !== undefined && label === 'Download') {
            yield* Deferred.await(options.hold)
          }

          if (label === options.failAt) {
            return yield* new PluginError({ reason: 'failed', message: `${label} broke.` })
          }

          yield* context.progress(1, 1)
          yield* Effect.orDie(fs.writeFileString(path.join(context.folder, `${label}.txt`), label))
        }),
    })

    return {
      meta,
      supported: true,
      resolve: Effect.succeed({
        release: { version, publishedAt: '2026-10-17T14:19:14Z', downloadBytes: 9 },
        steps: [step('Download'), step('Unpack')],
      }),
      test: (folder) =>
        options.testFails === true
          ? Effect.fail(new PluginError({ reason: 'failed', message: 'It did not run.' }))
          : Effect.map(
              Effect.orDie(fs.exists(path.join(folder, 'Unpack.txt'))),
              () => 'Hook files are in place.',
            ),
      release: Effect.void,
    }
  })

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const setup = (
  definition: Parameters<typeof fakePlugin>[0],
  stored?: object,
  freeBytes = 100 * 1024 ** 3,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped()
    const store = yield* Layer.build(KeyValueStore.layerMemory)

    if (stored !== undefined) {
      yield* Context.get(store, KeyValueStore.KeyValueStore).set(
        'plugins',
        yield* encodeJson(stored),
      )
    }

    const layer = Plugins.layer({
      root,
      definitions: Effect.map(fakePlugin(definition), (plugin) => [plugin]),
    }).pipe(Layer.provide([Layer.succeedContext(store), DiskSpace.fixed(freeBytes)]))

    const plugins = Context.get(yield* Layer.build(layer), Plugins)

    const until = (done: (state: PluginsState) => boolean) =>
      plugins.state.pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow))

    return { fs, root, plugins, until }
  })

const first = (state: PluginsState) => state.plugins[0]

describe('Plugins', () => {
  it.live('installs into a versioned folder, tests it, and records what it found', () =>
    Effect.gen(function* () {
      const { fs, plugins, until } = yield* setup({})

      yield* plugins.install('luna-hook')

      const state = yield* until((current) => first(current)?.installed !== undefined)
      const plugin = first(state)

      expect(plugin?.installed?.version).toBe('v12.1.2.14')

      expect(plugin?.installed?.test).toMatchObject({
        passed: true,
        message: 'Hook files are in place.',
      })

      expect(plugin?.installed?.sizeBytes).toBe('DownloadUnpack'.length)
      expect(plugin?.install).toBeUndefined()

      const folder = yield* plugins.installedFolder('luna-hook')

      expect(Option.isSome(folder) && (yield* fs.exists(folder.value))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('keeps the failed step and its error, and removes what it wrote', () =>
    Effect.gen(function* () {
      const { fs, root, plugins, until } = yield* setup({ failAt: 'Unpack' })

      yield* plugins.install('luna-hook')

      const state = yield* until((current) => first(current)?.install?.running === false)
      const install = first(state)?.install

      expect(install?.error).toBe('Unpack broke.')
      expect(install?.steps.map((step) => step.status)).toEqual(['done', 'failed', 'pending'])
      expect(first(state)?.installed).toBeUndefined()
      expect(yield* fs.exists(`${root}/luna-hook/v12.1.2.14`)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('stops before writing anything when the drive is too full', () =>
    Effect.gen(function* () {
      const { fs, root, plugins, until } = yield* setup({}, undefined, reserveBytes + 10)

      yield* plugins.install('luna-hook')

      const state = yield* until((current) => first(current)?.install?.running === false)
      const install = first(state)?.install

      expect(install?.space).toMatchObject({ neededBytes: 27, freeBytes: reserveBytes + 10 })
      expect(install?.steps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending'])
      expect(yield* fs.exists(`${root}/luna-hook/v12.1.2.14`)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('does not count a copy that fails its test as installed', () =>
    Effect.gen(function* () {
      const { plugins, until } = yield* setup({ testFails: true })

      yield* plugins.install('luna-hook')

      const state = yield* until((current) => first(current)?.install?.running === false)

      expect(first(state)?.install?.error).toBe('It did not run.')
      expect(first(state)?.installed).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('cancels a running install without leaving files or an error', () =>
    Effect.gen(function* () {
      const hold = yield* Deferred.make<void>()
      const { fs, root, plugins, until } = yield* setup({ hold })

      yield* plugins.install('luna-hook')
      yield* until((current) => first(current)?.install?.steps[0]?.status === 'running')

      const busy = yield* Effect.flip(plugins.install('luna-hook'))

      yield* plugins.cancel('luna-hook')

      const state = yield* until((current) => first(current)?.install === undefined)

      expect(busy.reason).toBe('busy')
      expect(first(state)?.installed).toBeUndefined()
      expect(yield* fs.exists(`${root}/luna-hook/v12.1.2.14`)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('records the newest version on a check, and removes an installed copy', () =>
    Effect.gen(function* () {
      const { fs, plugins, until } = yield* setup({})

      yield* plugins.check

      const checked = yield* until(
        (current) => current.checkedAt !== undefined && !current.checking,
      )

      expect(first(checked)?.latest).toEqual({
        version: 'v12.1.2.14',
        publishedAt: '2026-10-17T14:19:14Z',
        downloadBytes: 9,
      })

      yield* plugins.install('luna-hook')
      yield* until((current) => first(current)?.installed !== undefined)

      const folder = Option.getOrThrow(yield* plugins.installedFolder('luna-hook'))

      yield* plugins.remove('luna-hook')

      const removed = yield* until((current) => first(current)?.installed === undefined)

      expect(first(removed)?.installed).toBeUndefined()
      expect(yield* fs.exists(folder)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('keeps the installed plugins when a saved release no longer fits', () =>
    Effect.gen(function* () {
      const installed = {
        version: 'v12.1.2.14',
        sizeBytes: 9,
        installedAt: '2026-10-17T14:19:14Z',
        test: {
          passed: true,
          message: 'Hook files are in place.',
          testedAt: '2026-10-17T14:19:20Z',
        },
      }

      const { plugins } = yield* setup(
        {},
        {
          installed: { 'luna-hook': { ...installed, folder: 'C:Pluginsluna-hook' } },
          latest: { 'luna-hook': { tag: 'v12.1.2.14' } },
        },
      )

      const state = yield* plugins.state.pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(first(state)?.installed).toEqual(installed)
      expect(first(state)?.latest).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
