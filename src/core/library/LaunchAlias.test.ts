import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Context, Effect, FileSystem, Layer, Path, type Scope } from 'effect'
import { LaunchAlias, type LinkFolder, linkWithNode } from './LaunchAlias'

const setup = Effect.fn(function* (options: {
  readonly folderName: string
  readonly roots?: ReadonlyArray<string>
  readonly link?: LinkFolder
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-alias-' })
  const aliasRoot = path.join(root, 'launch')
  const folderPath = path.join(root, options.folderName)
  const executablePath = path.join(folderPath, 'bin', 'Game.exe')

  yield* fs.makeDirectory(path.dirname(executablePath), { recursive: true })
  yield* fs.writeFileString(executablePath, 'MZ')

  const services = yield* Layer.build(
    LaunchAlias.layerWith({
      roots: options.roots?.map((name) => path.join(root, name)) ?? [aliasRoot],
      link: options.link ?? linkWithNode,
    }),
  )

  const game = { id: 'game-1', folderPath, executablePath }

  return { aliases: Context.get(services, LaunchAlias), game, aliasRoot, fs, path, root }
})

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe('LaunchAlias', () => {
  it.live('starts a game with a plain path from its own folder', () =>
    run(
      Effect.gen(function* () {
        const { aliases, game, aliasRoot, fs } = yield* setup({ folderName: 'Aki' })

        expect(yield* aliases.prepare(game)).toEqual({
          folderPath: game.folderPath,
          executablePath: game.executablePath,
        })

        expect(yield* fs.exists(aliasRoot)).toBe(false)
      }),
    ),
  )

  it.live('starts a game whose path has Japanese characters through a plain alias', () =>
    run(
      Effect.gen(function* () {
        const { aliases, game, aliasRoot, fs, path } = yield* setup({ folderName: '壁の向こう～' })
        const paths = yield* aliases.prepare(game)

        expect(paths).toEqual({
          folderPath: path.join(aliasRoot, 'game-1'),
          executablePath: path.join(aliasRoot, 'game-1', 'bin', 'Game.exe'),
        })

        expect(yield* fs.readFileString(paths.executablePath)).toBe('MZ')
        expect(yield* aliases.prepare(game)).toEqual(paths)
      }),
    ),
  )

  it.live('points the alias at the game again after its folder moved, keeping the old files', () =>
    run(
      Effect.gen(function* () {
        const { aliases, game, fs, path, root } = yield* setup({ folderName: '壁の向こう' })

        yield* aliases.prepare(game)

        const movedFolder = path.join(root, '壁の向こう 2')
        const movedExecutable = path.join(movedFolder, 'Game.exe')

        yield* fs.makeDirectory(movedFolder)
        yield* fs.writeFileString(movedExecutable, 'moved')

        const paths = yield* aliases.prepare({
          id: game.id,
          folderPath: movedFolder,
          executablePath: movedExecutable,
        })

        expect(yield* fs.readFileString(paths.executablePath)).toBe('moved')
        expect(yield* fs.readFileString(game.executablePath)).toBe('MZ')
      }),
    ),
  )

  it.live("starts the game from its own folder when Windows can't link the alias", () =>
    run(
      Effect.gen(function* () {
        const { aliases, game } = yield* setup({
          folderName: '壁の向こう',
          link: () => Effect.fail(new Cause.UnknownError('network drive')),
        })

        expect(yield* aliases.prepare(game)).toEqual({
          folderPath: game.folderPath,
          executablePath: game.executablePath,
        })
      }),
    ),
  )

  it.live('skips alias folders that are not plain themselves', () =>
    run(
      Effect.gen(function* () {
        const { aliases, game, path, root } = yield* setup({
          folderName: '壁の向こう',
          roots: ['ユーザー', 'shared'],
        })

        expect((yield* aliases.prepare(game)).folderPath).toBe(path.join(root, 'shared', 'game-1'))
      }),
    ),
  )

  it.live("reports processes started through the alias under the game's own folder", () =>
    run(
      Effect.gen(function* () {
        const { aliases, game, path } = yield* setup({ folderName: '壁の向こう' })
        const paths = yield* aliases.prepare(game)

        const other = {
          pid: 2,
          parentPid: 1,
          name: 'explorer.exe',
          path: 'C:\\Windows\\explorer.exe',
        }

        const resolved = aliases.resolve(game, [
          { pid: 1, parentPid: 9, name: 'Game.exe', path: paths.executablePath.toUpperCase() },
          other,
        ])

        expect(resolved[0]?.path.toLowerCase()).toBe(game.executablePath.toLowerCase())
        expect(resolved[0]?.path.startsWith(`${game.folderPath}${path.sep}`)).toBe(true)
        expect(resolved[1]).toEqual(other)
      }),
    ),
  )
})
