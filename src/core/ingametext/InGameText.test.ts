import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { encode } from 'fast-png'
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { defaultInGameTextSettings, InGameTextRpc } from '#contract/InGameText'
import { type GameEngine, GameCandidate } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { Games } from '../library/Games'
import { GameConnector } from '../livecontrols/GameConnector'
import type { GameRuntime, RuntimeArgument } from '../livecontrols/GameRuntime'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { ImageOcr } from './ImageOcr'
import { budgetOf, makeInGameTextRpc, sceneName } from './InGameText'
import { InGameTextStore } from './InGameTextStore'

const menuTranslations: Readonly<Record<string, string>> = {
  アイテム: 'Item',
  メッセージ速度: 'Message speed',
  'HP {0}/{1}': 'HP {0}/{1}',
  黄昏の鎮魂歌: 'Twilight Requiem',
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const Items = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Struct({ text: Schema.String })),
)

const decodeItems = (prompt: string) =>
  Effect.orDie(Schema.decodeUnknownEffect(Items)(prompt.split('\n\n').at(-1) ?? '{}'))

interface FakeWorld {
  readonly calls: Array<string>
  readonly reports: Array<Record<string, unknown>>
  readonly dictionary: Map<string, string>
  readonly prompts: Array<string>
  readonly images: Map<string, unknown>
  readonly ocrCalls: Array<string>
}

const fakeRuntime = (world: FakeWorld) =>
  Effect.gen(function* () {
    const lost = yield* Deferred.make<void>()

    const snapshot = {
      ready: true,
      gold: 0,
      maxGold: 9999,
      hpMode: 'none',
      fontSize: null,
      defaultFontSize: 24,
      speed: 1,
    }

    const commands: Record<string, (args: ReadonlyArray<RuntimeArgument>) => unknown> = {
      install: () => ({ snapshot, unsupported: {} }),
      snapshot: () => snapshot,
      setTextOptions: () => null,
      takeText: () => world.reports.splice(0),
      addImages: ([images]) => {
        // SAFETY: InGameText sends addImages one list of [path, boxes] pairs.
        for (const image of (images ?? []) as ReadonlyArray<readonly [string, unknown]>) {
          world.images.set(image[0], image[1])
        }

        return world.images.size
      },
      addTexts: ([pairs]) => {
        // SAFETY: InGameText sends addTexts one list of [key, translation] string pairs.
        for (const pair of (pairs ?? []) as ReadonlyArray<ReadonlyArray<string>>) {
          world.dictionary.set(pair[0] ?? '', pair[1] ?? '')
        }

        return world.dictionary.size
      },
    }

    const call = (command: string, args: ReadonlyArray<RuntimeArgument> = []) =>
      Effect.gen(function* () {
        world.calls.push(`${command}(${yield* Effect.orDie(encodeJson(args))})`)

        const run = commands[command]

        if (run === undefined) {
          return yield* new LiveControlsError({ reason: 'invalid', message: command })
        }

        return run(args)
      })

    return { call, lost: Deferred.await(lost) } satisfies GameRuntime
  })

const LlmFake = (world: FakeWorld) =>
  Layer.succeed(LlmClient)({
    model: () => Effect.die('The Game Guide model is not used here.'),
    describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Fake' }),
    complete: (request) =>
      Effect.gen(function* () {
        const usage = { inputTokens: 1, outputTokens: 1 }

        world.prompts.push(request.prompt)

        if (request.prompt.includes('too wide')) {
          return { text: '"Msg speed"', usage, costUsd: 0 }
        }

        const items = yield* decodeItems(request.prompt)

        const reply = Object.fromEntries(
          Object.entries(items).map(([id, item]) => [id, menuTranslations[item.text] ?? 'Thing']),
        )

        return { text: yield* Effect.orDie(encodeJson(reply)), usage, costUsd: 0 }
      }),
  })

const OcrFake = (world: FakeWorld) =>
  Layer.succeed(ImageOcr)({
    recognize: (image) =>
      Effect.sync(() => {
        world.ocrCalls.push(`${image.width}x${image.height}`)

        return {
          image: { width: image.width, height: image.height },
          paragraphs: [
            {
              lines: [
                {
                  text: '黄昏の 鎮魂歌',
                  words: [],
                  box: { centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.5 },
                },
              ],
            },
          ],
        }
      }),
  })

const setup = Effect.fn(function* (
  options: { readonly folderPath?: string; readonly engine?: GameEngine } = {},
) {
  const world: FakeWorld = {
    calls: [],
    reports: [],
    dictionary: new Map(),
    prompts: [],
    images: new Map(),
    ocrCalls: [],
  }

  const connector = Layer.succeed(GameConnector)({
    prepare: () => Effect.succeed({ args: [], connect: () => fakeRuntime(world) }),
    attach: () => Effect.succeed({ args: [], connect: () => fakeRuntime(world) }),
    isRunning: () => Effect.succeed(true),
    recover: () => Effect.void,
  })

  const layer = makeInGameTextRpc({ poll: '10 millis' }).pipe(
    Layer.provideMerge(
      LiveControls.layerWith({ installEvery: '5 millis', installAttempts: 5, poll: '50 millis' }),
    ),
    Layer.provide(connector),
    Layer.provideMerge(InGameTextStore.layer),
    Layer.provide(LlmFake(world)),
    Layer.provide(OcrFake(world)),
    Layer.provideMerge(Games.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
    Layer.provideMerge(NodeServices.layer),
  )

  const services = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(InGameTextRpc).pipe(Effect.provide(services))
  const live = Context.get(services, LiveControls)
  const games = Context.get(services, Games)
  const store = Context.get(services, InGameTextStore)
  const kv = Context.get(services, KeyValueStore.KeyValueStore)

  yield* kv.set(
    'game-translation',
    yield* Effect.orDie(
      encodeJson({ ...defaultTranslationSettings, presetId: 'fast', targetLanguage: 'English' }),
    ),
  )

  const game = yield* games.add(
    GameCandidate.make({
      title: 'Aki',
      folderPath: options.folderPath ?? 'C:\\Games\\Aki',
      executablePath: 'C:\\Games\\Aki\\Game.exe',
      engine: options.engine ?? 'rpg-maker-vx-ace',
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  const connect = Effect.gen(function* () {
    yield* live.attach(game.id, 10)

    yield* live.state.pipe(
      Stream.filter((state) => state.status === 'connected'),
      Stream.runHead,
    )
  })

  return { world, client, store, game, connect }
})

const eventually = <A>(check: Effect.Effect<A, string>) =>
  check.pipe(Effect.retry({ schedule: Schedule.spaced('10 millis'), times: 300 }), Effect.orDie)

const expectThat = (condition: () => boolean) =>
  eventually(Effect.suspend(() => (condition() ? Effect.void : Effect.fail('not yet'))))

const pngBytes = (width: number, height: number) =>
  encode({ width, height, data: new Uint8Array(width * height * 4).fill(200), channels: 4 })

const mvGame = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const pictures = path.join(root, 'www', 'img', 'pictures')
  const faces = path.join(root, 'www', 'img', 'faces')
  const png = pngBytes(32, 16)

  yield* fs.makeDirectory(pictures, { recursive: true })
  yield* fs.makeDirectory(faces, { recursive: true })
  yield* fs.writeFile(path.join(pictures, 'Title.png'), png)

  yield* fs.writeFile(
    path.join(pictures, 'cg01.rpgmvp'),
    new Uint8Array([...new Uint8Array(32).fill(7), ...png.subarray(16)]),
  )

  yield* fs.writeFile(path.join(faces, 'Hero.png'), png)

  return root
})

describe('InGameText', () => {
  it('names scenes and estimates how many characters fit', () => {
    expect([sceneName('Scene_Options'), sceneName('Scene_QuestLog'), sceneName('Window')]).toEqual([
      'Options',
      'Quest Log',
      'Window',
    ])

    expect([budgetOf(110, 20), budgetOf(0, 20), budgetOf(10, 20)]).toEqual([10, undefined, 3])
  })

  it.live('translates menu text the game draws and sends it back to the game', () =>
    Effect.gen(function* () {
      const { world, client, game, connect } = yield* setup()

      yield* client.saveInGameTextSettings({
        gameId: game.id,
        settings: { ...defaultInGameTextSettings, uiText: true },
      })

      yield* connect

      world.reports.push({
        key: 'アイテム',
        fit: 'missing',
        width: 110,
        size: 20,
        scene: 'Scene_Menu',
      })

      yield* expectThat(() => world.dictionary.get('アイテム') === 'Item')

      expect(world.prompts[0]).toContain('"max":10')

      const entries = yield* client.listInGameTexts({ gameId: game.id, filter: 'all', search: '' })

      expect(entries).toMatchObject([
        { key: 'アイテム', translatedText: 'Item', scene: 'Menu', allowedWidth: 110, fontSize: 20 },
      ])

      const summary = yield* client
        .watchInGameTextSummary({ gameId: game.id })
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(summary).toEqual({ strings: 1, tooLong: 0, images: { withText: 0, total: 0 } })
    }).pipe(Effect.scoped),
  )

  it.live('applies the settings and sends saved translations when the game connects', () =>
    Effect.gen(function* () {
      const { world, client, store, game, connect } = yield* setup()

      yield* store.saveTranslation({
        gameId: game.id,
        targetLanguage: 'English',
        origin: 'ui',
        key: 'セーブ',
        translatedText: 'Save',
      })

      yield* client.saveInGameTextSettings({
        gameId: game.id,
        settings: { ...defaultInGameTextSettings, uiText: true, wordWrap: true },
      })

      yield* connect
      yield* expectThat(() => world.dictionary.get('セーブ') === 'Save')

      expect(world.calls).toContain('setTextOptions([true,false,true,false,"cover","backquote"])')
    }).pipe(Effect.scoped),
  )

  it.live('leaves the game alone while menu translation is off', () =>
    Effect.gen(function* () {
      const { world, connect } = yield* setup()

      yield* connect

      world.reports.push({
        key: 'アイテム',
        fit: 'missing',
        width: 110,
        size: 20,
        scene: 'Scene_Menu',
      })

      yield* Effect.sleep('80 millis')

      expect(world.calls.some((call) => call.startsWith('takeText'))).toBe(false)
      expect(world.prompts).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.live('asks once for a shorter translation when one is still too long', () =>
    Effect.gen(function* () {
      const { world, client, game, connect } = yield* setup()

      yield* client.saveInGameTextSettings({
        gameId: game.id,
        settings: { ...defaultInGameTextSettings, uiText: true },
      })

      yield* connect

      world.reports.push({
        key: 'メッセージ速度',
        fit: 'missing',
        width: 90,
        size: 20,
        scene: 'Scene_Options',
      })

      yield* expectThat(() => world.dictionary.get('メッセージ速度') === 'Message speed')

      world.reports.push({
        key: 'メッセージ速度',
        fit: 'too-long',
        width: 90,
        size: 20,
        scene: 'Scene_Options',
      })

      yield* expectThat(() => world.dictionary.get('メッセージ速度') === 'Msg speed')

      world.reports.push({
        key: 'メッセージ速度',
        fit: 'too-long',
        width: 90,
        size: 20,
        scene: 'Scene_Options',
      })

      yield* Effect.sleep('80 millis')

      expect(world.prompts.filter((prompt) => prompt.includes('too wide'))).toHaveLength(1)

      const tooLong = yield* client.listInGameTexts({
        gameId: game.id,
        filter: 'too-long',
        search: '',
      })

      expect(tooLong).toMatchObject([{ key: 'メッセージ速度', translatedText: 'Msg speed' }])
    }).pipe(Effect.scoped),
  )

  it.live('reads and translates the text in pictures, then paints it in the running game', () =>
    Effect.gen(function* () {
      const folderPath = yield* mvGame()
      const { world, client, game, connect } = yield* setup({ folderPath, engine: 'rpg-maker-mv' })

      yield* client.saveInGameTextSettings({
        gameId: game.id,
        settings: { ...defaultInGameTextSettings, imageText: true },
      })

      yield* connect
      yield* client.scanGameImages({ gameId: game.id })
      yield* expectThat(() => world.images.size === 2)

      expect(world.images.get('pictures/title')).toEqual([[8, 4, 16, 8, 'Twilight Requiem']])
      expect([...world.images.keys()].toSorted()).toEqual(['pictures/cg01', 'pictures/title'])

      const summary = yield* client
        .watchInGameTextSummary({ gameId: game.id })
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow))

      expect(summary).toEqual({ strings: 1, tooLong: 0, images: { withText: 2, total: 2 } })

      const images = yield* client.listInGameTexts({
        gameId: game.id,
        filter: 'images',
        search: '',
      })

      expect(images).toMatchObject([
        {
          key: '黄昏の鎮魂歌',
          origin: 'image',
          translatedText: 'Twilight Requiem',
          allowedWidth: 16,
        },
      ])

      yield* client.scanGameImages({ gameId: game.id })
      yield* Effect.sleep('50 millis')

      expect(world.ocrCalls).toEqual(['32x16', '32x16'])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('sends an edit to the running game and keeps it from later translations', () =>
    Effect.gen(function* () {
      const { world, client, store, game, connect } = yield* setup()

      yield* store.saveTranslation({
        gameId: game.id,
        targetLanguage: 'English',
        origin: 'ui',
        key: 'アイテム',
        translatedText: 'Item',
      })

      yield* connect

      const edited = yield* client.saveInGameText({
        gameId: game.id,
        origin: 'ui',
        key: 'アイテム',
        translatedText: ' Items ',
      })

      expect(edited).toMatchObject({ translatedText: 'Items', edited: true })
      yield* expectThat(() => world.dictionary.get('アイテム') === 'Items')

      const missing = yield* client
        .saveInGameText({ gameId: game.id, origin: 'ui', key: 'ない', translatedText: 'No' })
        .pipe(Effect.flip)

      expect(missing.reason).toBe('not-found')
    }).pipe(Effect.scoped),
  )
})
