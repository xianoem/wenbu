import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Sink, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { GameCandidate } from '#contract/Library'
import type { PluginId } from '#contract/Plugins'
import { LunaHookHost } from '../overlay/LunaHookHost'
import type { RunningProcess } from '../overlay/GameProcesses'
import * as Database from '../platform/Database'
import { Plugins } from '../plugins/Plugins'
import { GameLauncher, LaunchHooks, type LaunchPlan, plainLaunch } from './GameLauncher'
import { Games } from './Games'
import { LaunchAlias, linkWithNode } from './LaunchAlias'

interface Spawned {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string | undefined
}

const lrConfig = `<?xml version="1.0" encoding="utf-8"?>
<LRConfig>
  <Profiles>
    <Profile Name="Run in Chinese" Guid="11111111-1111-1111-1111-111111111111">
      <Location>zh-CN</Location>
      <CodePage>936</CodePage>
    </Profile>
    <Profile Name="Run in Japanese" Guid="ee0a2d6e-ffc6-4d2a-9d31-d9ad0b8e2a0b">
      <Location>ja-JP</Location>
      <CodePage>932</CodePage>
    </Profile>
  </Profiles>
</LRConfig>`

const executable = (machine: number) => {
  const bytes = new Uint8Array(128)
  const view = new DataView(bytes.buffer)

  view.setUint16(0, 0x5a4d, true)
  view.setUint32(0x3c, 64, true)
  view.setUint32(64, 0x4550, true)
  view.setUint16(68, machine, true)

  return bytes
}

const setup = Effect.fn(function* (options: {
  readonly machine: number
  readonly plugin: boolean
  readonly plan?: LaunchPlan
  readonly folderName?: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const gameFolder = path.join(root, options.folderName ?? 'Aki')
  const aliasFolder = path.join(root, 'launch')
  const pluginFolder = path.join(root, 'luna-hook')
  const exe = path.join(gameFolder, 'Game.exe')

  yield* fs.makeDirectory(gameFolder, { recursive: true })

  yield* fs.makeDirectory(path.join(pluginFolder, 'locale', 'locale-remulator'), {
    recursive: true,
  })

  yield* fs.writeFile(exe, executable(options.machine))

  yield* fs.writeFileString(
    path.join(pluginFolder, 'locale', 'locale-remulator', 'LRConfig.xml'),
    lrConfig,
  )

  const spawned = yield* Ref.make<ReadonlyArray<Spawned>>([])
  const running = yield* Ref.make<ReadonlyArray<RunningProcess>>([])

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (ChildProcess.isStandardCommand(command)) {
        yield* Ref.update(spawned, (all) => [
          ...all,
          { command: command.command, args: command.args, cwd: command.options.cwd },
        ])
      }

      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(42),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    }),
  )

  const fakes = Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(spawner),
    Layer.succeed(Plugins)({
      state: Stream.empty,
      installedFolder: (id: PluginId) =>
        Effect.succeed(
          options.plugin && id === 'luna-hook' ? Option.some(pluginFolder) : Option.none(),
        ),
      check: Effect.void,
      install: () => Effect.void,
      cancel: () => Effect.void,
      remove: () => Effect.void,
      test: () => Effect.void,
    }),
    Layer.succeed(LunaHookHost)({
      start: () => Effect.die('not used'),
      processes: Ref.get(running),
    }),
    Layer.succeed(LaunchHooks)({ plan: () => Effect.succeed(options.plan ?? plainLaunch) }),
    LaunchAlias.layerWith({ roots: [aliasFolder], link: linkWithNode }),
  )

  const services = yield* Layer.build(
    GameLauncher.layerWith({ poll: '10 millis', searchFor: '300 millis' }).pipe(
      Layer.provideMerge(Games.layer),
      Layer.provide(fakes),
      Layer.provideMerge(Database.layer(':memory:')),
      Layer.provideMerge(NodeServices.layer),
    ),
  )

  const games = Context.get(services, Games)
  const launcher = Context.get(services, GameLauncher)

  const game = yield* games.add(
    GameCandidate.make({
      title: 'Aki',
      folderPath: gameFolder,
      executablePath: exe,
      engine: 'windows',
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  return { games, launcher, game, spawned, running, pluginFolder, exe, path, aliasFolder }
})

describe('GameLauncher', () => {
  it.live('starts a game as is by default and counts its play time', () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, exe, path } = yield* setup({
        machine: 0x8664,
        plugin: false,
      })

      const launch = yield* launcher.launch(game.id)

      yield* launch.exited

      expect(launch.processId).toBe(42)

      expect(yield* Ref.get(spawned)).toEqual([{ command: exe, args: [], cwd: path.dirname(exe) }])

      expect(yield* games.get(game.id)).toMatchObject({ launchCount: 1, playSeconds: 1 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('runs a 32-bit game through the x86 Ntleas', () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, pluginFolder, exe, path } = yield* setup({
        machine: 0x14c,
        plugin: true,
      })

      yield* games.setLocale(game.id, 'ntleas')
      yield* launcher.launch(game.id)

      expect(yield* Ref.get(spawned)).toEqual([
        {
          command: path.join(pluginFolder, 'locale', 'ntleas', 'x86', 'ntleas.exe'),
          args: [exe, 'C932', 'L1041', 'FMS PGothic', 'P4'],
          cwd: path.dirname(exe),
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('runs a 64-bit game through the x64 Ntleas', () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, pluginFolder, path } = yield* setup({
        machine: 0x8664,
        plugin: true,
      })

      yield* games.setLocale(game.id, 'ntleas')
      yield* launcher.launch(game.id)

      expect((yield* Ref.get(spawned))[0]?.command).toBe(
        path.join(pluginFolder, 'locale', 'ntleas', 'x64', 'ntleas.exe'),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live("runs a game through Locale Remulator's Japanese profile", () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, pluginFolder, exe, path } = yield* setup({
        machine: 0x14c,
        plugin: true,
      })

      yield* games.setLocale(game.id, 'locale-remulator')
      yield* launcher.launch(game.id)

      expect(yield* Ref.get(spawned)).toEqual([
        {
          command: path.join(pluginFolder, 'locale', 'locale-remulator', 'LRProc.exe'),
          args: ['ee0a2d6e-ffc6-4d2a-9d31-d9ad0b8e2a0b', exe],
          cwd: path.dirname(exe),
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('adds Live Game Controls arguments in every locale and reports the game process', () =>
    Effect.gen(function* () {
      const started = yield* Ref.make<ReadonlyArray<Option.Option<number>>>([])

      const plan: LaunchPlan = {
        args: ['--remote-debugging-port=9222'],
        started: (launch) =>
          Effect.flatMap(launch.gameProcessId, (id) => Ref.update(started, (all) => [...all, id])),
      }

      const { games, launcher, game, spawned, running, exe } = yield* setup({
        machine: 0x14c,
        plugin: true,
        plan,
      })

      yield* Ref.set(running, [{ pid: 500, parentPid: 42, name: 'Game.exe', path: exe }])

      for (const locale of ['system', 'ntleas', 'locale-remulator'] as const) {
        yield* games.setLocale(game.id, locale)
        yield* launcher.launch(game.id)
      }

      yield* Effect.sleep('100 millis')

      expect((yield* Ref.get(spawned)).map((entry) => entry.args)).toEqual([
        ['--remote-debugging-port=9222'],
        [exe, 'A--remote-debugging-port=9222', 'C932', 'L1041', 'FMS PGothic', 'P4'],
        ['ee0a2d6e-ffc6-4d2a-9d31-d9ad0b8e2a0b', exe, '--remote-debugging-port=9222'],
      ])

      expect(yield* Ref.get(started)).toEqual([Option.some(42), Option.some(500), Option.some(500)])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('starts a game in a Japanese folder through its plain alias', () =>
    Effect.gen(function* () {
      const { launcher, game, spawned, path, aliasFolder } = yield* setup({
        machine: 0x14c,
        plugin: false,
        folderName: '壁の向こうの妻',
      })

      yield* launcher.launch(game.id)

      const alias = path.join(aliasFolder, game.id)

      expect(yield* Ref.get(spawned)).toEqual([
        { command: path.join(alias, 'Game.exe'), args: [], cwd: alias },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('finds the game a locale tool started through the alias', () =>
    Effect.gen(function* () {
      const started = yield* Ref.make<ReadonlyArray<Option.Option<number>>>([])

      const plan: LaunchPlan = {
        args: [],
        started: (launch) =>
          Effect.flatMap(launch.gameProcessId, (id) => Ref.update(started, (all) => [...all, id])),
      }

      const { games, launcher, game, spawned, running, path, aliasFolder } = yield* setup({
        machine: 0x14c,
        plugin: true,
        plan,
        folderName: '壁の向こうの妻',
      })

      const aliasExe = path.join(aliasFolder, game.id, 'Game.exe')

      yield* Ref.set(running, [{ pid: 500, parentPid: 42, name: 'Game.exe', path: aliasExe }])
      yield* games.setLocale(game.id, 'ntleas')
      yield* launcher.launch(game.id)
      yield* Effect.sleep('100 millis')

      expect((yield* Ref.get(spawned))[0]?.args[0]).toBe(aliasExe)
      expect(yield* Ref.get(started)).toEqual([Option.some(500)])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('starts a game built for Japanese Windows through Ntleas on Automatic', () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, pluginFolder, path } = yield* setup({
        machine: 0x14c,
        plugin: true,
      })

      expect(game.locale).toBe('auto')

      yield* games.setNeedsJapaneseLocale(game.id, true)

      const launch = yield* launcher.launch(game.id)

      expect(launch.locale).toBe('ntleas')

      expect((yield* Ref.get(spawned))[0]?.command).toBe(
        path.join(pluginFolder, 'locale', 'ntleas', 'x86', 'ntleas.exe'),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('starts that game as it is on Automatic while LunaHook is not installed', () =>
    Effect.gen(function* () {
      const { games, launcher, game, spawned, exe } = yield* setup({
        machine: 0x14c,
        plugin: false,
      })

      yield* games.setNeedsJapaneseLocale(game.id, true)

      const launch = yield* launcher.launch(game.id)

      expect(launch.locale).toBe('system')
      expect((yield* Ref.get(spawned))[0]?.command).toBe(exe)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('asks for LunaHook before starting a game in a Japanese locale', () =>
    Effect.gen(function* () {
      const { games, launcher, game } = yield* setup({ machine: 0x14c, plugin: false })

      yield* games.setLocale(game.id, 'ntleas')

      const error = yield* Effect.flip(launcher.launch(game.id))

      expect(error.reason).toBe('not-ready')

      expect(error.message).toBe(
        'Install LunaHook in Settings → Plugins to start games in a Japanese locale.',
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live("counts play time on the game's own process, not the short-lived locale tool", () =>
    Effect.gen(function* () {
      const { games, launcher, game, running, exe } = yield* setup({
        machine: 0x14c,
        plugin: true,
      })

      yield* Ref.set(running, [
        { pid: 42, parentPid: 1, name: 'ntleas.exe', path: 'C:\\tools\\ntleas.exe' },
        { pid: 500, parentPid: 42, name: 'Game.exe', path: exe },
      ])

      yield* games.setLocale(game.id, 'ntleas')

      const launch = yield* launcher.launch(game.id)

      yield* Effect.sleep('100 millis')

      expect((yield* games.get(game.id)).playSeconds).toBe(0)

      yield* Ref.set(running, [])
      yield* launch.exited

      expect(yield* games.get(game.id)).toMatchObject({ launchCount: 1, playSeconds: 1 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
