import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { encode } from 'fast-png'
import {
  ConfigProvider,
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
import { GameCandidate } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { type GamePicture, PicturesError, PicturesRpc } from '#contract/Pictures'
import { InGameTextStore } from '../ingametext/InGameTextStore'
import { Games } from '../library/Games'
import { GameConnector } from '../livecontrols/GameConnector'
import type { GameRuntime, RuntimeArgument } from '../livecontrols/GameRuntime'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { ImageOcr } from './ImageOcr'
import { PictureCleaner } from './PictureCleaner'
import { PicturesRpcLive } from './Pictures'
import { PictureStore } from './PictureStore'

interface World {
  readonly pictures: Map<string, string>
  readonly prompts: Array<{ readonly prompt: string; readonly images: number }>
  readonly cleaned: Array<string>
  readonly ocrCalls: Array<string>
  reply: string
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const fakeRuntime = (world: World) =>
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
      setPictures: ([pictures]) => {
        world.pictures.clear()

        // SAFETY: Pictures sends setPictures one list of [picture, file] string pairs.
        for (const pair of (pictures ?? []) as ReadonlyArray<ReadonlyArray<string>>) {
          world.pictures.set(pair[0] ?? '', pair[1] ?? '')
        }

        return world.pictures.size
      },
    }

    const call = (command: string, args: ReadonlyArray<RuntimeArgument> = []) => {
      const run = commands[command]

      return run === undefined
        ? Effect.fail(new LiveControlsError({ reason: 'invalid', message: command }))
        : Effect.sync(() => run(args))
    }

    return { call, lost: Deferred.await(lost) } satisfies GameRuntime
  })

const OcrFake = (world: World) =>
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
                  text: '性経験の テータ',
                  words: [],
                  box: { centerX: 0.5, centerY: 0.25, width: 0.5, height: 0.25 },
                },
                {
                  text: '自',
                  words: [],
                  box: { centerX: 0.5, centerY: 0.75, width: 0.1, height: 0.25 },
                },
              ],
            },
          ],
        }
      }),
  })

const LlmFake = (world: World) =>
  Layer.succeed(LlmClient)({
    model: () => Effect.die('Not used by Picture Review.'),
    describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Seeing', images: true }),
    complete: (request) =>
      Effect.sync(() => {
        world.prompts.push({ prompt: request.prompt, images: request.images?.length ?? 0 })

        return {
          text: world.reply,
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: 0,
        }
      }),
  })

const CleanerFake = (world: World) =>
  Layer.effect(
    PictureCleaner,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      return PictureCleaner.of({
        ready: Effect.succeed(true),
        clean: (source, output, boxes) =>
          Effect.gen(function* () {
            world.cleaned.push(
              `${path.basename(source)}:${boxes.map((box) => box.join(',')).join(';')}`,
            )

            yield* fs.makeDirectory(path.dirname(output), { recursive: true })
            yield* fs.copyFile(source, output)

            return boxes.map(() => ({
              fill: [255, 255, 255] as const,
              outline: [0, 0, 0] as const,
            }))
          }).pipe(Effect.mapError(() => new PicturesError({ reason: 'failed', message: 'copy' }))),
      })
    }),
  )

const png = (width: number, height: number) =>
  encode({ width, height, data: new Uint8Array(width * height * 4).fill(200), channels: 4 })

const mvGame = Effect.fn(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const pictures = path.join(root, 'game', 'www', 'img', 'pictures')
  const image = png(64, 32)

  yield* fs.makeDirectory(pictures, { recursive: true })
  yield* fs.writeFile(path.join(pictures, 'status_a.png'), image)

  yield* fs.writeFile(
    path.join(pictures, 'status_b.rpgmvp'),
    new Uint8Array([...new Uint8Array(32).fill(7), ...image.subarray(16)]),
  )

  yield* fs.writeFile(path.join(pictures, 'tiny.png'), png(8, 8))

  return path.join(root, 'game')
})

const eventually = <A>(check: Effect.Effect<A, string>) =>
  check.pipe(Effect.retry({ schedule: Schedule.spaced('10 millis'), times: 300 }), Effect.orDie)

const expectThat = (condition: () => boolean) =>
  eventually(Effect.suspend(() => (condition() ? Effect.void : Effect.fail('not yet'))))

const setup = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-pictures-' })
  const folderPath = yield* mvGame(root)

  const world: World = {
    pictures: new Map(),
    prompts: [],
    cleaned: [],
    ocrCalls: [],
    reply: '{"1": {"source": "性経験のデータ", "translation": "Sexual experience data"}}',
  }

  const connector = Layer.succeed(GameConnector)({
    prepare: () => Effect.succeed({ args: [], connect: () => fakeRuntime(world) }),
    attach: () => Effect.succeed({ args: [], connect: () => fakeRuntime(world) }),
    isRunning: () => Effect.succeed(true),
    recover: () => Effect.void,
  })

  const layer = PicturesRpcLive.pipe(
    Layer.provideMerge(
      LiveControls.layerWith({ installEvery: '5 millis', installAttempts: 5, poll: '50 millis' }),
    ),
    Layer.provide(connector),
    Layer.provide([OcrFake(world), LlmFake(world), CleanerFake(world)]),
    Layer.provideMerge([PictureStore.layer, InGameTextStore.layer, Games.layer]),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ WENBU_DATA_DIR: root }))),
    Layer.provideMerge(NodeServices.layer),
  )

  const services = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(PicturesRpc).pipe(Effect.provide(services))
  const live = Context.get(services, LiveControls)
  const kv = Context.get(services, KeyValueStore.KeyValueStore)

  yield* kv.set(
    'game-translation',
    yield* Effect.orDie(
      encodeJson({ ...defaultTranslationSettings, presetId: 'fast', targetLanguage: 'English' }),
    ),
  )

  const game = yield* Context.get(services, Games).add(
    GameCandidate.make({
      title: 'Yuri',
      folderPath,
      executablePath: `${folderPath}\\Game.exe`,
      engine: 'rpg-maker-mv',
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

  const found = Effect.gen(function* () {
    yield* client.findPictureText({ gameId: game.id })

    yield* client.watchPictures({ gameId: game.id }).pipe(
      Stream.filter((summary) => summary.scan === undefined && summary.scanned === 3),
      Stream.runHead,
    )

    return yield* client.listPictures({ gameId: game.id })
  })

  const listed = (picture: string) =>
    Effect.flatMap(client.listPictures({ gameId: game.id }), (pictures) =>
      Effect.succeed(pictures.find((candidate) => candidate.picture === picture)),
    )

  return { world, client, game, connect, found, listed }
})

const translationsOf = (picture: GamePicture | undefined) =>
  picture?.lines.map((line) => [line.source, line.translation])

describe('Pictures', () => {
  it.live('finds text in pictures without translating them, and groups the variants', () =>
    Effect.gen(function* () {
      const { world, client, game, found } = yield* setup()
      const pictures = yield* found

      expect(
        pictures.map((picture) => [picture.picture, picture.variants, picture.status]),
      ).toEqual([
        ['pictures/status_a', 2, 'to-review'],
        ['pictures/status_b', 2, 'to-review'],
      ])

      expect(pictures[0]?.lines).toEqual([
        {
          id: 1,
          x: 16,
          y: 4,
          w: 32,
          h: 8,
          ocr: '性経験のテータ',
          source: '性経験のテータ',
          keep: false,
        },
      ])

      expect(world.ocrCalls).toEqual(['64x32', '64x32'])
      expect(world.prompts).toEqual([])

      const summary = yield* client.watchPictures({ gameId: game.id }).pipe(
        Stream.runHead,
        Effect.map((head) => Option.getOrThrow(head)),
      )

      expect(summary).toMatchObject({
        scanned: 3,
        withText: 2,
        approved: 0,
        kept: 0,
        canClean: true,
      })

      yield* client.findPictureText({ gameId: game.id })
      yield* Effect.sleep('50 millis')

      expect(world.ocrCalls).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('translates with the picture attached, and fixes OCR mistakes in every variant', () =>
    Effect.gen(function* () {
      const { world, client, game, found, listed } = yield* setup()

      yield* found
      yield* client.translatePictures({ gameId: game.id, pictures: ['pictures/status_a'] })

      yield* eventually(
        Effect.flatMap(listed('pictures/status_b'), (picture) =>
          picture?.lines[0]?.translation === undefined ? Effect.fail('not yet') : Effect.void,
        ),
      )

      expect(world.prompts).toHaveLength(1)
      expect(world.prompts[0]?.images).toBe(1)
      expect(world.prompts[0]?.prompt).toContain('性経験のテータ')

      for (const picture of ['pictures/status_a', 'pictures/status_b']) {
        expect(translationsOf(yield* listed(picture))).toEqual([
          ['性経験のデータ', 'Sexual experience data'],
        ])
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('cleans, approves and draws a picture in the game until a line changes', () =>
    Effect.gen(function* () {
      const { world, client, game, connect, found, listed } = yield* setup()

      yield* found
      yield* connect

      const cleaned = yield* client.cleanPicture({ gameId: game.id, picture: 'pictures/status_a' })

      expect(cleaned.cleaned).toBeDefined()
      expect(cleaned.lines[0]).toMatchObject({ fill: [255, 255, 255], outline: [0, 0, 0] })
      expect(world.cleaned).toEqual(['status_a.png:16,4,48,12'])

      yield* client.cleanPicture({ gameId: game.id, picture: 'pictures/status_a' })

      expect(world.cleaned).toHaveLength(1)

      const approved = yield* client.approvePicture({
        gameId: game.id,
        picture: 'pictures/status_a',
        image: png(64, 32),
      })

      expect(approved.status).toBe('approved')
      yield* expectThat(() => world.pictures.get('pictures/status_a') === approved.translated)

      const kept = yield* client.savePictureLine({
        gameId: game.id,
        picture: 'pictures/status_a',
        line: 1,
        keep: true,
      })

      expect([kept.status, kept.cleaned, kept.translated]).toEqual([
        'to-review',
        undefined,
        undefined,
      ])

      yield* expectThat(() => world.pictures.size === 0)

      const original = yield* client.setPictureStatus({
        gameId: game.id,
        picture: 'pictures/status_b',
        status: 'kept',
      })

      expect(original.status).toBe('kept')
      expect((yield* listed('pictures/status_b'))?.status).toBe('kept')

      const refused = yield* client
        .approvePicture({ gameId: game.id, picture: 'pictures/status_a', image: new Uint8Array(3) })
        .pipe(Effect.flip)

      expect(refused.message).toBe('The translated picture is not a PNG.')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('adds a line OCR reads in a drawn box, and removes it again', () =>
    Effect.gen(function* () {
      const { world, client, game, found } = yield* setup()

      yield* found

      const added = yield* client.addPictureLine({
        gameId: game.id,
        picture: 'pictures/status_a',
        box: { x: 2, y: 20, w: 40, h: 10 },
        image: { width: 120, height: 30, pixels: new Uint8Array(120 * 30 * 4) },
      })

      expect(added.lines.map((line) => [line.id, line.source, line.x, line.w])).toEqual([
        [1, '性経験のテータ', 16, 32],
        [2, '性経験のテータ自', 2, 40],
      ])

      expect(world.ocrCalls.at(-1)).toBe('120x30')

      const removed = yield* client.removePictureLine({
        gameId: game.id,
        picture: 'pictures/status_a',
        line: 2,
      })

      expect(removed.lines.map((line) => line.id)).toEqual([1])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('letters a line at a chosen size or filling its box in every variant', () =>
    Effect.gen(function* () {
      const { client, game, found, listed } = yield* setup()

      yield* found

      yield* client.savePictureLine({
        gameId: game.id,
        picture: 'pictures/status_a',
        line: 1,
        size: 20,
      })

      expect((yield* listed('pictures/status_b'))?.lines[0]).toMatchObject({ size: 20 })

      const filled = yield* client.savePictureLine({
        gameId: game.id,
        picture: 'pictures/status_a',
        line: 1,
        size: null,
        fillBox: true,
      })

      expect(filled.lines[0]?.size).toBeUndefined()
      expect((yield* listed('pictures/status_b'))?.lines[0]).toMatchObject({ fillBox: true })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('takes an approved picture out of the game when a new translation changes it', () =>
    Effect.gen(function* () {
      const { world, client, game, connect, found, listed } = yield* setup()

      yield* found
      yield* connect

      const translated = (text: string) =>
        eventually(
          Effect.flatMap(listed('pictures/status_a'), (picture) =>
            picture?.lines[0]?.translation === text ? Effect.void : Effect.fail('not yet'),
          ),
        )

      yield* client.translatePictures({ gameId: game.id, pictures: ['pictures/status_a'] })
      yield* translated('Sexual experience data')
      yield* client.cleanPicture({ gameId: game.id, picture: 'pictures/status_a' })

      yield* client.approvePicture({
        gameId: game.id,
        picture: 'pictures/status_a',
        image: png(64, 32),
      })

      yield* expectThat(() => world.pictures.size === 1)

      world.reply = '{"1": {"source": "性経験のデータ", "translation": "Experience data"}}'

      yield* client.translatePictures({ gameId: game.id, pictures: ['pictures/status_a'] })
      yield* translated('Experience data')

      yield* expectThat(() => world.pictures.size === 0)

      expect((yield* listed('pictures/status_a'))?.status).toBe('to-review')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live(
    'keeps a line whose translation the user edited when the model reads it differently',
    () =>
      Effect.gen(function* () {
        const { client, game, found, listed } = yield* setup()

        yield* found

        yield* client.savePictureLine({
          gameId: game.id,
          picture: 'pictures/status_a',
          line: 1,
          translation: 'My data',
        })

        yield* client.translatePictures({ gameId: game.id, pictures: ['pictures/status_a'] })

        yield* eventually(
          Effect.flatMap(client.watchPictures({ gameId: game.id }).pipe(Stream.runHead), (head) =>
            Option.isSome(head) && head.value.translating === 0
              ? Effect.void
              : Effect.fail('not yet'),
          ),
        )

        expect(translationsOf(yield* listed('pictures/status_a'))).toEqual([
          ['性経験のテータ', 'My data'],
        ])
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('marks only the pictures it translates as translating', () =>
    Effect.gen(function* () {
      const { client, game, found } = yield* setup()

      yield* found

      yield* client.translatePictures({
        gameId: game.id,
        pictures: ['pictures/status_a', 'pictures/status_b', 'pictures/gone'],
      })

      yield* eventually(
        Effect.flatMap(client.listPictures({ gameId: game.id }), (pictures) =>
          pictures.every((picture) => picture.busy === undefined) &&
          pictures[0]?.lines[0]?.translation !== undefined
            ? Effect.void
            : Effect.fail('not yet'),
        ),
      )

      const summary = yield* client.watchPictures({ gameId: game.id }).pipe(
        Stream.runHead,
        Effect.map((head) => Option.getOrThrow(head)),
      )

      expect(summary.translating).toBe(0)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
