import {
  Config,
  Context,
  DateTime,
  Effect,
  FiberMap,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  type InstallStep,
  InstalledPlugin,
  type Plugin,
  PluginError,
  type PluginId,
  type PluginInstall,
  PluginRelease,
  PluginsRpc,
  type PluginsState,
  type PluginTest,
} from '#contract/Plugins'
import type { SpaceShortfall } from '#contract/Storage'
import { DiskSpace, folderSize } from '../platform/DiskSpace'
import * as SettingsStore from '../platform/SettingsStore'
import { makeLunaHook } from './definitions/LunaHook'
import { makeMangaImageTranslator } from './definitions/MangaImageTranslator'
import { makeSpeechModels } from './definitions/SpeechModels'
import { makeScreenAi } from './definitions/ScreenAi'
import type { PluginDefinition } from './PluginDefinition'

const Installed = Schema.Struct({ ...InstalledPlugin.fields, folder: Schema.String })

type Installed = typeof Installed.Type

const Stored = Schema.Struct({
  installed: Schema.Record(Schema.String, Installed),
  latest: Schema.Record(Schema.String, PluginRelease),
  checkedAt: Schema.optional(Schema.String),
})

type Stored = typeof Stored.Type

interface Live {
  readonly stored: Stored
  readonly installs: ReadonlyMap<string, PluginInstall>
  readonly checkErrors: ReadonlyMap<string, string>
  readonly checking: boolean
}

const now = Effect.map(DateTime.now, DateTime.formatIso)

const busy = () =>
  new PluginError({ reason: 'busy', message: 'This plugin is already being installed.' })

const notInstalled = () =>
  new PluginError({ reason: 'unavailable', message: 'This plugin is not installed.' })

const checkInterval = 6 * 60 * 60 * 1000

export class Plugins extends Context.Service<
  Plugins,
  {
    readonly state: Stream.Stream<PluginsState>
    readonly installedFolder: (id: PluginId) => Effect.Effect<Option.Option<string>>
    readonly check: Effect.Effect<void>
    readonly install: (id: PluginId) => Effect.Effect<void, PluginError>
    readonly cancel: (id: PluginId) => Effect.Effect<void>
    readonly remove: (id: PluginId) => Effect.Effect<void, PluginError>
    readonly test: (id: PluginId) => Effect.Effect<void, PluginError>
  }
>()('wenbu/core/plugins/Plugins') {
  static readonly layer = <R>(options: {
    readonly root: string
    readonly definitions: Effect.Effect<ReadonlyArray<PluginDefinition>, never, R>
  }) =>
    Layer.effect(
      Plugins,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const disk = yield* DiskSpace

        const store = SettingsStore.make(yield* KeyValueStore.KeyValueStore, Stored, {
          installed: {},
          latest: {},
        })

        const definitions = yield* options.definitions
        const fibers = yield* FiberMap.make<string>()
        const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>()

        const saved = yield* store
          .get('plugins')
          .pipe(Effect.orElseSucceed((): Stored => ({ installed: {}, latest: {} })))

        yield* Effect.logInfo('Installed plugins').pipe(
          Effect.annotateLogs({
            feature: 'plugins',
            ...Object.fromEntries(
              Object.entries(saved.installed).map(([id, installed]) => [id, installed.version]),
            ),
          }),
        )

        const live = yield* SubscriptionRef.make<Live>({
          stored: saved,
          installs: new Map(),
          checkErrors: new Map(),
          checking: false,
        })

        const persist = Effect.flatMap(SubscriptionRef.get(live), (current) =>
          Effect.ignore(store.set('plugins', current.stored)),
        )

        const updateStored = (change: (stored: Stored) => Stored) =>
          SubscriptionRef.update(live, (current) => ({
            ...current,
            stored: change(current.stored),
          })).pipe(Effect.andThen(persist))

        const updateInstall = (
          id: string,
          change: (install: PluginInstall | undefined) => PluginInstall | undefined,
        ) =>
          SubscriptionRef.update(live, (current) => {
            const installs = new Map(current.installs)
            const next = change(installs.get(id))

            if (next === undefined) {
              installs.delete(id)
            } else {
              installs.set(id, next)
            }

            return { ...current, installs }
          })

        const updateStep = (id: string, index: number, patch: Partial<InstallStep>) =>
          updateInstall(id, (install) =>
            install === undefined
              ? undefined
              : {
                  ...install,
                  steps: install.steps.map((step, at) =>
                    at === index ? { ...step, ...patch } : step,
                  ),
                },
          )

        const definitionOf = (id: string) =>
          definitions.find((definition) => definition.meta.id === id)

        const toPlugin = (current: Live, definition: PluginDefinition): Plugin => {
          const id = definition.meta.id
          const installed = current.stored.installed[id]
          const latest = current.stored.latest[id]
          const install = current.installs.get(id)
          const checkError = current.checkErrors.get(id)

          return {
            ...definition.meta,
            supported: definition.supported,
            ...(installed === undefined
              ? {}
              : {
                  installed: {
                    version: installed.version,
                    sizeBytes: installed.sizeBytes,
                    installedAt: installed.installedAt,
                    test: installed.test,
                  },
                }),
            ...(latest === undefined ? {} : { latest }),
            ...(install === undefined ? {} : { install }),
            ...(checkError === undefined ? {} : { checkError }),
          }
        }

        const state = SubscriptionRef.changes(live).pipe(
          Stream.map((current): PluginsState => ({
            plugins: definitions.map((definition) => toPlugin(current, definition)),
            checking: current.checking,
            ...(current.stored.checkedAt === undefined
              ? {}
              : { checkedAt: current.stored.checkedAt }),
          })),
        )

        const removeFolder = (folder: string) =>
          Effect.ignore(fs.remove(folder, { recursive: true }))

        const check = Effect.gen(function* () {
          yield* SubscriptionRef.update(live, (current) => ({ ...current, checking: true }))

          const results = yield* Effect.forEach(
            definitions.filter((definition) => definition.supported),
            (definition) =>
              definition.resolve.pipe(
                Effect.map(
                  (resolved) =>
                    [definition.meta.id, Option.some(resolved.release), undefined] as const,
                ),
                Effect.catch((error) =>
                  Effect.logWarning('Plugin update check failed').pipe(
                    Effect.annotateLogs({ plugin: definition.meta.id, error: error.message }),
                    Effect.as([definition.meta.id, Option.none(), error.message] as const),
                  ),
                ),
              ),
            { concurrency: 'unbounded' },
          )

          const checkedAt = yield* now

          yield* SubscriptionRef.update(live, (current) => ({
            ...current,
            checking: false,
            checkErrors: new Map(
              results.flatMap(([id, , error]) => (error === undefined ? [] : [[id, error]])),
            ),
            stored: {
              ...current.stored,
              checkedAt,
              latest: {
                ...current.stored.latest,
                ...Object.fromEntries(
                  results.flatMap(([id, release]) =>
                    Option.isSome(release) ? [[id, release.value]] : [],
                  ),
                ),
              },
            },
          }))

          yield* persist
        })

        const runInstall = Effect.fnUntraced(function* (definition: PluginDefinition) {
          const id = definition.meta.id
          const resolved = yield* definition.resolve
          const version = resolved.release.version
          const folder = path.join(options.root, id, version.replace(/[^\w.-]/g, '_'))
          const work = path.join(options.root, '.work', id)
          const steps = [...resolved.steps, { label: 'Test' }]

          yield* updateStored((stored) => ({
            ...stored,
            latest: { ...stored.latest, [id]: resolved.release },
          }))

          yield* updateInstall(id, () => ({
            version,
            running: true,
            steps: steps.map((step) => ({ label: step.label, status: 'pending' })),
          }))

          yield* disk.ensure(
            options.root,
            resolved.installBytes ?? 3 * (resolved.release.downloadBytes ?? 0),
          )

          const previous = (yield* SubscriptionRef.get(live)).stored.installed[id]

          if (previous?.folder === folder) {
            yield* updateStored(({ installed: { [id]: _replaced, ...rest }, ...stored }) => ({
              ...stored,
              installed: rest,
            }))
          }

          yield* definition.release
          yield* removeFolder(folder)
          yield* removeFolder(work)

          yield* Effect.mapError(
            Effect.all([
              fs.makeDirectory(folder, { recursive: true }),
              fs.makeDirectory(work, { recursive: true }),
            ]),
            () =>
              new PluginError({
                reason: 'failed',
                message: "Wenbu could not create the plugin's folder.",
              }),
          )

          const runStep = Effect.fnUntraced(function* <A>(
            index: number,
            effect: Effect.Effect<A, PluginError>,
          ) {
            yield* disk.ensure(options.root, 0)
            yield* updateStep(id, index, { status: 'running' })

            const result = yield* effect.pipe(
              Effect.tapError(() => updateStep(id, index, { status: 'failed' })),
            )

            yield* updateStep(id, index, { status: 'done' })

            return result
          })

          for (const [index, step] of resolved.steps.entries()) {
            yield* runStep(
              index,
              step.run({
                folder,
                work,
                progress: (done, total) =>
                  updateStep(id, index, { progress: { done, total: total ?? done } }),
                detail: (detail) => updateStep(id, index, { detail }),
              }),
            )
          }

          const testIndex = resolved.steps.length
          const message = yield* runStep(testIndex, definition.test(folder))

          yield* updateStep(id, testIndex, { detail: message })

          const installedAt = yield* now

          const sizeBytes = yield* folderSize(folder).pipe(
            Effect.provideContext(files),
            Effect.orElseSucceed(() => 0),
          )

          const replaced = (yield* SubscriptionRef.get(live)).stored.installed[id]

          yield* SubscriptionRef.update(live, (current) => {
            const installs = new Map(current.installs)

            installs.delete(id)

            return {
              ...current,
              installs,
              stored: {
                ...current.stored,
                installed: {
                  ...current.stored.installed,
                  [id]: {
                    version,
                    folder,
                    sizeBytes,
                    installedAt,
                    test: { passed: true, message, testedAt: installedAt },
                  },
                },
              },
            }
          })

          yield* persist

          if (replaced !== undefined && replaced.folder !== folder) {
            yield* removeFolder(replaced.folder)
          }

          yield* Effect.logInfo('Plugin installed').pipe(
            Effect.annotateLogs({
              plugin: id,
              version,
              replaced: replaced?.version,
              sizeMb: Math.round(sizeBytes / 1024 ** 2),
            }),
          )

          return folder
        })

        const install = Effect.fn('Plugins.install')(function* (id: PluginId) {
          const definition = definitionOf(id)

          if (definition === undefined || !definition.supported) {
            return yield* new PluginError({
              reason: 'unsupported',
              message: 'This plugin does not run on this computer.',
            })
          }

          if (yield* FiberMap.has(fibers, id)) {
            return yield* busy()
          }

          yield* updateInstall(id, () => ({ version: '', running: true, steps: [] }))

          const cleanup = Effect.gen(function* () {
            yield* definition.release

            const current = (yield* SubscriptionRef.get(live)).stored.installed[id]

            const folders = yield* Effect.orElseSucceed(
              fs.readDirectory(path.join(options.root, id)),
              () => [],
            )

            for (const folder of folders.map((name) => path.join(options.root, id, name))) {
              if (folder !== current?.folder) {
                yield* removeFolder(folder)
              }
            }
          })

          const failInstall = (error: { readonly message: string }, space?: SpaceShortfall) =>
            Effect.logWarning('Plugin install failed').pipe(
              Effect.annotateLogs({ plugin: id, error: error.message }),
              Effect.andThen(cleanup),
              Effect.andThen(
                updateInstall(id, (current) => ({
                  version: current?.version ?? '',
                  steps: current?.steps ?? [],
                  running: false,
                  error: error.message,
                  ...(space === undefined ? {} : { space }),
                })),
              ),
            )

          yield* FiberMap.run(
            fibers,
            id,
            runInstall(definition).pipe(
              Effect.catchTag('NotEnoughSpace', (error) => failInstall(error, error.shortfall)),
              Effect.catch((error) => failInstall(error)),
              Effect.onInterrupt(() =>
                cleanup.pipe(Effect.andThen(updateInstall(id, () => undefined))),
              ),
              Effect.ensuring(removeFolder(path.join(options.root, '.work', id))),
            ),
          )
        })

        const cancel = (id: PluginId) => FiberMap.remove(fibers, id)

        const remove = Effect.fn('Plugins.remove')(function* (id: PluginId) {
          const definition = definitionOf(id)
          const installed = (yield* SubscriptionRef.get(live)).stored.installed[id]

          if (definition === undefined || installed === undefined) {
            return yield* notInstalled()
          }

          yield* definition.release

          yield* Effect.mapError(
            fs.remove(installed.folder, { recursive: true }),
            () =>
              new PluginError({
                reason: 'failed',
                message: 'The files are in use. Close what uses them and try again.',
              }),
          )

          yield* updateStored(({ installed: { [id]: _removed, ...rest }, ...stored }) => ({
            ...stored,
            installed: rest,
          }))

          yield* updateInstall(id, () => undefined)

          yield* Effect.logInfo('Plugin removed').pipe(
            Effect.annotateLogs({ plugin: id, version: installed.version }),
          )
        })

        const test = Effect.fn('Plugins.test')(function* (id: PluginId) {
          const definition = definitionOf(id)
          const installed = (yield* SubscriptionRef.get(live)).stored.installed[id]

          if (definition === undefined || installed === undefined) {
            return yield* notInstalled()
          }

          const testedAt = yield* now

          const result: PluginTest = yield* definition.test(installed.folder).pipe(
            Effect.map((message) => ({ passed: true, message, testedAt })),
            Effect.catch((error) =>
              Effect.succeed({ passed: false, message: error.message, testedAt }),
            ),
          )

          yield* updateStored((stored) => ({
            ...stored,
            installed: { ...stored.installed, [id]: { ...installed, test: result } },
          }))

          yield* (result.passed ? Effect.logInfo : Effect.logWarning)('Plugin tested').pipe(
            Effect.annotateLogs({ plugin: id, passed: result.passed, detail: result.message }),
          )
        })

        const installedFolder = (id: PluginId) =>
          Effect.map(SubscriptionRef.get(live), (current) => {
            const installed = current.stored.installed[id]

            return installed?.test.passed === true ? Option.some(installed.folder) : Option.none()
          })

        const lastCheck =
          saved.checkedAt === undefined
            ? 0
            : DateTime.toEpochMillis(DateTime.makeUnsafe(saved.checkedAt))

        if ((yield* DateTime.now).epochMilliseconds - lastCheck > checkInterval) {
          yield* Effect.forkScoped(check)
        }

        return Plugins.of({ state, installedFolder, check, install, cancel, remove, test })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.gen(function* () {
      const dataDir = yield* Config.String('WENBU_DATA_DIR')
      const path = yield* Path.Path

      return Plugins.layer({
        root: path.join(dataDir, 'plugins'),
        definitions: Effect.orDie(
          Effect.all([makeScreenAi, makeLunaHook, makeMangaImageTranslator, makeSpeechModels]).pipe(
            Effect.map((definitions) => definitions.flat()),
          ),
        ),
      })
    }),
  )
}

export const PluginsRpcLive = PluginsRpc.toLayer(
  Effect.gen(function* () {
    const plugins = yield* Plugins

    return PluginsRpc.of({
      watchPlugins: () => plugins.state,
      checkPluginUpdates: () => plugins.check,
      installPlugin: ({ id }) => plugins.install(id),
      cancelPluginInstall: ({ id }) => plugins.cancel(id),
      removePlugin: ({ id }) => plugins.remove(id),
      testPlugin: ({ id }) => plugins.test(id),
    })
  }),
)
