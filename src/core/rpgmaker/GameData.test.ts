import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, expect, it, layer } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { DiskSpace, folderSize } from '../platform/DiskSpace'
import { GameData } from './GameData'
import { encodeRubyMarshal } from './RubyMarshal'

const TestLayer = GameData.layer.pipe(
  Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
  Layer.provideMerge(NodeServices.layer),
)

const map = (line: string) => ({
  displayName: '',
  events: [null, { pages: [{ list: [{ code: 401, parameters: [line] }] }] }],
})

const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4)

  bytes.writeUInt32LE(value >>> 0)

  return [...bytes]
}

const encrypt = (content: Uint8Array, fileKey: number) => {
  const output = Uint8Array.from(content)
  let key = fileKey

  for (let offset = 0; offset < output.length; offset += 4) {
    for (let index = 0; index < 4 && offset + index < output.length; index++) {
      output[offset + index]! ^= (key >>> (index * 8)) & 0xff
    }

    key = (Math.imul(key, 7) + 3) >>> 0
  }

  return output
}

const archiveOf = (entryPath: string, content: Uint8Array) => {
  const seed = 0x1c71c71c
  const key = (Math.imul(seed, 9) + 3) >>> 0
  const pathBytes = Buffer.from(entryPath)
  const dataOffset = 12 + 16 + pathBytes.length + 4

  return Uint8Array.from([
    ...Buffer.from('RGSSAD\0\x03', 'latin1'),
    ...uint32(seed),
    ...[dataOffset, content.length, 0, pathBytes.length].flatMap((value) => uint32(value ^ key)),
    ...pathBytes.map((byte, at) => byte ^ ((key >>> ((at % 4) * 8)) & 0xff)),
    ...uint32(0 ^ key),
    ...encrypt(content, 0),
  ])
}

const tempGame = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  return yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-game-' })
})

layer(TestLayer)('GameData', (it) => {
  it.effect('saves, restores and discards the originals of an MV game', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-mv' as const }
      const mapPath = path.join(folderPath, 'www', 'data', 'Map001.json')

      yield* fs.makeDirectory(path.dirname(mapPath), { recursive: true })
      yield* data.writeData(mapPath, map('こんにちは'))

      assert.isFalse(yield* data.hasOriginals(game))
      expect(yield* data.saveOriginals(game)).toBe('saved')
      expect(yield* data.saveOriginals(game)).toBe('kept')
      assert.isTrue(yield* data.hasOriginals(game))

      yield* data.writeData(mapPath, map('Hello'))

      expect((yield* data.locations(game)).map((location) => location.value)).toEqual(['', 'Hello'])
      assert.isTrue(yield* data.restoreOriginals(game))

      expect((yield* data.locations(game)).map((location) => location.value)).toEqual([
        '',
        'こんにちは',
      ])

      yield* data.discardOriginals(game)

      assert.isFalse(yield* data.hasOriginals(game))
      assert.isFalse(yield* data.restoreOriginals(game))
    }).pipe(Effect.scoped),
  )

  it.effect('counts the copy of the originals only until it is saved', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-mv' as const }
      const mapPath = path.join(folderPath, 'www', 'data', 'Map001.json')

      yield* fs.makeDirectory(path.dirname(mapPath), { recursive: true })
      yield* data.writeData(mapPath, map('こんにちは'))

      const dataBytes = yield* folderSize(path.dirname(mapPath))

      expect(yield* data.spaceToTranslate(game)).toBe(dataBytes + Math.ceil(dataBytes / 4))

      yield* data.saveOriginals(game)

      expect(yield* data.spaceToTranslate(game)).toBe(Math.ceil(dataBytes / 4))
    }).pipe(Effect.scoped),
  )

  it.effect('adopts the oldest backup the old Wenbu made', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-mz' as const }

      for (const [folder, line] of [
        ['data', 'Translated'],
        ['data.wenbu-backup-2026-01-01T00-00-00-000Z', '原文'],
        ['data.wenbu-backup-2026-02-01T00-00-00-000Z', 'Translated'],
      ] as const) {
        yield* fs.makeDirectory(path.join(folderPath, folder))
        yield* data.writeData(path.join(folderPath, folder, 'Map001.json'), map(line))
      }

      assert.isTrue(yield* data.hasOriginals(game))
      assert.isTrue(yield* data.restoreOriginals(game))
      expect((yield* data.locations(game)).map((location) => location.value)).toEqual(['', '原文'])
    }).pipe(Effect.scoped),
  )

  it.effect('reads a packed VX Ace game, unpacks it and packs it back', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-vx-ace' as const }
      const archivePath = path.join(folderPath, 'Game.rgss3a')
      const vxMap = { __rubyClass: 'RPG::Map', display_name: '', events: map('やあ').events }

      yield* fs.writeFile(archivePath, archiveOf('Data\\Map001.rvdata2', encodeRubyMarshal(vxMap)))

      expect((yield* data.locations(game)).map((location) => location.value)).toEqual(['', 'やあ'])
      expect(yield* data.saveOriginals(game)).toBe('unpacked')
      assert.isFalse(yield* fs.exists(archivePath))
      assert.isTrue(yield* fs.exists(path.join(folderPath, 'Data', 'Map001.rvdata2')))
      assert.isTrue(yield* data.hasOriginals(game))

      assert.isTrue(yield* data.restoreOriginals(game))
      assert.isTrue(yield* fs.exists(archivePath))
      assert.isFalse(yield* fs.exists(path.join(folderPath, 'Data', 'Map001.rvdata2')))
    }).pipe(Effect.scoped),
  )

  it.effect('hashes the data files and the saved originals', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-mv' as const }
      const dataPath = path.join(folderPath, 'www', 'data')

      yield* fs.makeDirectory(dataPath, { recursive: true })
      yield* data.writeData(path.join(dataPath, 'Map001.json'), map('原文'))
      yield* data.writeData(path.join(dataPath, 'Map002.json'), map('二番'))
      yield* data.saveOriginals(game)

      const saved = yield* data.originalHashes(game)

      yield* data.writeData(path.join(dataPath, 'Map001.json'), map('新しい原文'))

      const current = yield* data.dataHashes(game)

      expect([...saved.keys()]).toEqual(['Map001.json', 'Map002.json'])
      expect(current.get('Map001.json')).not.toBe(saved.get('Map001.json'))
      expect(current.get('Map002.json')).toBe(saved.get('Map002.json'))
    }).pipe(Effect.scoped),
  )

  it.effect('keeps loose data files that patch a packed VX Ace game as originals', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-vx-ace' as const }
      const archivePath = path.join(folderPath, 'Game.rgss3a')
      const patched = path.join(folderPath, 'Data', 'Map001.rvdata2')

      const vxMap = (line: string) => ({
        __rubyClass: 'RPG::Map',
        display_name: '',
        events: map(line).events,
      })

      yield* fs.writeFile(
        archivePath,
        archiveOf('Data\\Map001.rvdata2', encodeRubyMarshal(vxMap('やあ'))),
      )

      yield* fs.makeDirectory(path.dirname(patched), { recursive: true })
      yield* data.writeData(patched, vxMap('修正版'))

      const saved = yield* data.saveOriginals(game)
      const originals = (yield* data.originalLocations(game)).map((location) => location.value)

      yield* data.writeData(patched, vxMap('Translated'))
      yield* data.restoreOriginals(game)

      expect(saved).toBe('unpacked')
      expect(originals).toEqual(['', '修正版'])
      assert.isTrue(yield* fs.exists(archivePath))

      expect(
        (yield* data.locations({ ...game, engine: 'rpg-maker-vx-ace' })).map(
          (location) => location.value,
        ),
      ).toEqual(['', 'やあ'])

      expect(yield* data.readData(patched)).toMatchObject({ events: vxMap('修正版').events })
    }).pipe(Effect.scoped),
  )

  it.effect('notices a new Game.rgss3a beside the one set aside, without touching it', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const game = { folderPath, engine: 'rpg-maker-vx-ace' as const }
      const archivePath = path.join(folderPath, 'Game.rgss3a')

      const vxMap = (line: string) => ({
        __rubyClass: 'RPG::Map',
        display_name: '',
        events: map(line).events,
      })

      yield* fs.writeFile(
        archivePath,
        archiveOf('Data\\Map001.rvdata2', encodeRubyMarshal(vxMap('やあ'))),
      )

      yield* data.saveOriginals(game)

      assert.isFalse(yield* data.hasNewArchive(game))

      const updated = archiveOf('Data\\Map001.rvdata2', encodeRubyMarshal(vxMap('こんばんは')))

      yield* fs.writeFile(archivePath, updated)

      assert.isTrue(yield* data.hasNewArchive(game))
      assert.isTrue(yield* fs.exists(path.join(folderPath, 'Data', 'Map001.rvdata2')))
      assert.isTrue(Buffer.from(yield* fs.readFile(archivePath)).equals(Buffer.from(updated)))
    }).pipe(Effect.scoped),
  )
})

describe('GameData errors', () => {
  it.effect('names the file that could not be decoded', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const data = yield* GameData
      const folderPath = yield* tempGame
      const broken = path.join(folderPath, 'Map002.json')

      yield* fs.writeFileString(broken, '{ not json')

      const error = yield* Effect.flip(data.readData(broken))

      expect(error.message).toBe('Map002.json is not valid JSON.')
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  )
})
