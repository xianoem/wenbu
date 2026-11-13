import { type Crypto, Effect, FileSystem, Path, Stream } from 'effect'
import type { HttpClient } from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { type Plugin, PluginError, type PluginRelease } from '#contract/Plugins'
import type { ArchiveFile } from './Archives'

export type PluginMeta = Pick<
  Plugin,
  | 'id'
  | 'name'
  | 'description'
  | 'project'
  | 'license'
  | 'sourceLabel'
  | 'sourceUrl'
  | 'pinned'
  | 'platforms'
>

export interface StepContext {
  readonly folder: string
  readonly work: string
  readonly progress: (done: number, total: number | undefined) => Effect.Effect<void>
  readonly detail: (text: string) => Effect.Effect<void>
}

export interface InstallStepDefinition {
  readonly label: string
  readonly run: (context: StepContext) => Effect.Effect<void, PluginError>
}

export interface Resolved {
  readonly release: PluginRelease
  readonly steps: ReadonlyArray<InstallStepDefinition>
  readonly installBytes?: number
}

export interface PluginDefinition {
  readonly meta: PluginMeta
  readonly supported: boolean
  readonly resolve: Effect.Effect<Resolved, PluginError>
  readonly test: (folder: string) => Effect.Effect<string, PluginError>
  readonly release: Effect.Effect<void>
}

export type PluginServices =
  | Crypto.Crypto
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner

export const servicesProvider = Effect.map(
  Effect.context<PluginServices>(),
  (context) =>
    <A, E>(effect: Effect.Effect<A, E, PluginServices>) =>
      Effect.provideContext(effect, context),
)

export const failed = (message: string) => new PluginError({ reason: 'failed', message })

export const platformKey = `${process.platform}-${process.arch}`

export const writeFiles = Effect.fn('writeFiles')(function* (
  folder: string,
  files: ReadonlyArray<ArchiveFile>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  for (const file of files) {
    const target = path.join(folder, file.path)

    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFile(target, file.data)
  }
})

export const runCommand = Effect.fn('runCommand')(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly env?: Record<string, string>; readonly what: string },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          ...(options.env === undefined ? {} : { env: options.env, extendEnv: true }),
        }),
      )

      const output = yield* handle.all.pipe(Stream.decodeText, Stream.mkString)
      const exitCode = yield* handle.exitCode

      if (exitCode !== 0) {
        const tail = output.trim().split('\n').slice(-3).join(' ').trim()

        return yield* failed(
          tail === '' ? `${options.what} failed.` : `${options.what} failed: ${tail}`,
        )
      }

      return output
    }),
  ).pipe(
    Effect.catchTag('PlatformError', () =>
      Effect.fail(failed(`${options.what} could not be started.`)),
    ),
  )
})

export const onDisk = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
  Effect.mapError(effect, () => failed(message))
