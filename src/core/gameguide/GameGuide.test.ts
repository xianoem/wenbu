import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Path,
  Option,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import { LanguageModel, Prompt, type Response } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { GameGuideRpc } from '#contract/GameGuide'
import { defaultTranslationSettings } from '#contract/GameTranslation'
import { GameCandidate } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { Games } from '../library/Games'
import { GameConnector } from '../livecontrols/GameConnector'
import type { GameRuntime } from '../livecontrols/GameRuntime'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { GameData } from '../rpgmaker/GameData'
import { TranslationLines } from '../translation/TranslationLines'
import { GameGuideRpcLive } from './GameGuide'
import { GuideIndexStore } from './GuideIndexStore'

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const command = (code: number, parameters: ReadonlyArray<unknown>, indent = 0) => ({
  code,
  indent,
  parameters,
})

const page = (list: ReadonlyArray<unknown>, switchId?: number) => ({
  conditions: {
    switch1Valid: switchId !== undefined,
    switch1Id: switchId ?? 1,
    switch2Valid: false,
    variableValid: false,
    selfSwitchValid: false,
    itemValid: false,
    actorValid: false,
  },
  image: { characterName: 'People1', tileId: 0 },
  trigger: 0,
  list,
})

const gameFiles = {
  'System.json': {
    gameTitle: '月の森',
    switches: ['', 'Festival started'],
    variables: [''],
    elements: [],
  },
  'MapInfos.json': [
    null,
    { id: 1, name: 'Riverside', parentId: 0 },
    { id: 2, name: 'Shrine Path', parentId: 0 },
  ],
  'States.json': [null, { id: 1, name: '洗脳', message1: 'You are brainwashed.' }],
  'Items.json': [
    null,
    { id: 1, name: '月光花', description: 'A pale flower.', price: 60, itypeId: 1 },
  ],
  'Map001.json': {
    displayName: '',
    width: 10,
    height: 10,
    events: [
      null,
      { id: 1, name: 'Gate', x: 5, y: 9, pages: [page([command(201, [0, 2, 3, 7, 0, 0])])] },
      {
        id: 2,
        name: 'Herbalist',
        x: 2,
        y: 2,
        pages: [
          page([
            command(401, ['【Ona】月光花を持ってきて。']),
            command(101, ['', 0, 0, 2, 'Ona']),
            command(401, ['洗脳なんて怖いわ。']),
          ]),
        ],
      },
    ],
  },
  'Map002.json': {
    displayName: '',
    width: 10,
    height: 10,
    events: [
      null,
      {
        id: 1,
        name: 'Glinting flower',
        x: 4,
        y: 3,
        pages: [page([command(126, [1, 0, 0, 1]), command(123, ['A', 0])])],
      },
      {
        id: 2,
        name: 'Night stall',
        x: 6,
        y: 6,
        pages: [page([command(302, [0, 1, 0, 0, false])], 1)],
      },
    ],
  },
}

const guideState = {
  mapId: 1,
  mapName: '',
  x: 5,
  y: 8,
  inBattle: false,
  troopId: 0,
  enemies: [],
  switches: [],
  variables: [],
  selfSwitches: [],
  party: [],
  items: [],
  gold: 30,
  playtime: 60,
  events: [
    [1, 5, 9, 0],
    [2, 2, 2, 0],
  ],
  dialogue: [],
}

const fakeRuntime = Effect.gen(function* () {
  const lost = yield* Deferred.make<void>()

  const snapshot = {
    ready: true,
    gold: 30,
    maxGold: 9999,
    hpMode: 'none',
    fontSize: null,
    defaultFontSize: 24,
    speed: 1,
  }

  const commands: Record<string, () => unknown> = {
    install: () => ({ snapshot, unsupported: {} }),
    snapshot: () => snapshot,
    setTextOptions: () => null,
    takeText: () => [],
    guideState: () => guideState,
  }

  const call = (name: string) =>
    Effect.suspend(() => {
      const run = commands[name]

      return run === undefined
        ? Effect.fail(new LiveControlsError({ reason: 'invalid', message: name }))
        : Effect.succeed(run())
    })

  return { call, lost: Deferred.await(lost) } satisfies GameRuntime
})

const FactIds = Schema.Array(Schema.Struct({ id: Schema.String }))

const decodeResult = Schema.decodeUnknownOption(
  Schema.Union([FactIds, Schema.Record(Schema.String, Schema.Union([FactIds, Schema.Unknown]))]),
  { onExcessProperty: 'ignore' },
)

const isFactIds = Schema.is(FactIds)

const returnedIds = (prompt: Prompt.Prompt) =>
  prompt.content.flatMap((message) =>
    message.role === 'tool'
      ? message.content.flatMap((part) =>
          part.type === 'tool-result'
            ? Option.match(decodeResult(part.result), {
                onNone: () => [],
                onSome: (result) =>
                  (isFactIds(result) ? [result] : Object.values(result).filter(isFactIds))
                    .flat()
                    .map((fact) => fact.id),
              })
            : [],
        )
      : [],
  )

const usage = {
  inputTokens: { uncached: 100, total: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: undefined, reasoning: undefined },
}

const finish = (reason: 'tool-calls' | 'stop'): Response.PartEncoded => ({
  type: 'finish',
  reason,
  usage,
  response: undefined,
})

type Script = (step: number, prompt: Prompt.Prompt) => Response.PartEncoded

const citing = (ids: ReadonlyArray<string>) => (ids.length === 0 ? '' : ` [${ids.join(', ')}]`)

const findMoonpetal: Script = (step, prompt) => {
  if (step === 1) {
    return { type: 'tool-call', id: 'c1', name: 'find', params: { words: ['moonpetal'] } }
  }

  if (step === 2) {
    return { type: 'tool-call', id: 'c2', name: 'where_to_get', params: { kind: 'item', id: 1 } }
  }

  return {
    type: 'text',
    text: `Take the gate north to the Shrine Path and pick the glinting flower.${citing([...returnedIds(prompt), 'f999'])}`,
  }
}

const looseCalls: Script = (step, prompt) => {
  const calls: Record<number, Response.PartEncoded> = {
    1: {
      type: 'tool-call',
      id: 'c1',
      name: 'where_to_get',
      params: { kind: 'item', id: 'moonpetal' },
    },
    2: { type: 'tool-call', id: 'c2', name: 'map_contents', params: { mapId: null } },
    3: { type: 'tool-call', id: 'c3', name: 'map_contents', params: { mapId: 'Shrine Path' } },
  }

  return (
    calls[step] ?? {
      type: 'text',
      text: `Take the gate to the Shrine Path and pick the flower.${citing(returnedIds(prompt))}`,
    }
  )
}

const askAboutContent: Script = (step, prompt) =>
  step === 1
    ? {
        type: 'tool-call',
        id: 'c1',
        name: 'find',
        params: { words: ['brainwashing', '洗脳'] },
      }
    : {
        type: 'text',
        text: `Yes. The game has a Brainwashed state, and Ona talks about it.

- It is a status effect
- Ona mentions it in Riverside${citing(returnedIds(prompt))}`,
      }

const scriptedModel = (prompts: Array<Prompt.Prompt>, script: Script) =>
  LanguageModel.make({
    generateText: (options) =>
      Effect.sync((): Array<Response.PartEncoded> => {
        prompts.push(options.prompt)

        const part = script(prompts.length, options.prompt)

        return [part, finish(part.type === 'tool-call' ? 'tool-calls' : 'stop')]
      }),
    streamText: () => Stream.empty,
  })

const toolResults = (prompt: Prompt.Prompt) =>
  prompt.content.flatMap((message) =>
    message.role === 'tool'
      ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.result] : []))
      : [],
  )

const setup = Effect.fn(function* (script: Script = findMoonpetal) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folderPath = yield* fs.makeTempDirectoryScoped({ prefix: 'wenbu-guide-' })

  for (const [name, data] of Object.entries(gameFiles)) {
    yield* fs.makeDirectory(path.join(folderPath, 'www', 'data'), { recursive: true })

    yield* fs.writeFileString(
      path.join(folderPath, 'www', 'data', name),
      yield* Effect.orDie(encodeJson(data)),
    )
  }

  const prompts: Array<Prompt.Prompt> = []

  const llm = Layer.succeed(LlmClient)({
    model: () =>
      Effect.succeed({
        modelName: 'Scripted',
        layer: Layer.effect(LanguageModel.LanguageModel, scriptedModel(prompts, script)),
        spend: (spent) => Effect.succeed((spent.inputTokens + spent.outputTokens) / 1_000_000),
      }),
    describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Scripted' }),
    complete: () => Effect.die('Not used by the Game Guide.'),
  })

  const connector = Layer.succeed(GameConnector)({
    prepare: () => Effect.succeed({ args: [], connect: () => fakeRuntime }),
    attach: () => Effect.succeed({ args: [], connect: () => fakeRuntime }),
    isRunning: () => Effect.succeed(true),
    recover: () => Effect.void,
  })

  const layer = GameGuideRpcLive.pipe(
    Layer.provideMerge(
      LiveControls.layerWith({ installEvery: '5 millis', installAttempts: 5, poll: '50 millis' }),
    ),
    Layer.provide(connector),
    Layer.provide(llm),
    Layer.provideMerge(
      Layer.mergeAll(GuideIndexStore.layer, TranslationLines.layer, GameData.layer),
    ),
    Layer.provideMerge(Games.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
    Layer.provideMerge(NodeServices.layer),
  )

  const services = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(GameGuideRpc).pipe(Effect.provide(services))
  const live = Context.get(services, LiveControls)
  const games = Context.get(services, Games)
  const kv = Context.get(services, KeyValueStore.KeyValueStore)
  const sql = Context.get(services, SqlClient.SqlClient)

  yield* kv.set(
    'game-translation',
    yield* Effect.orDie(
      encodeJson({ ...defaultTranslationSettings, presetId: 'fast', targetLanguage: 'English' }),
    ),
  )

  const game = yield* games.add(
    GameCandidate.make({
      title: 'Moon Forest',
      folderPath,
      executablePath: path.join(folderPath, 'Game.exe'),
      engine: 'rpg-maker-mv',
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  yield* sql`
    INSERT INTO translation_lines (game_id, entry_id, file, pointer, context, source_text, translated_text, updated_at)
    VALUES (${game.id}, 'Items.json::/1/name', 'Items.json', '/1/name', '', '月光花', 'Moonpetal', '2026-10-28')
  `

  yield* live.attach(game.id, 10)

  yield* client.watchGuideIndex().pipe(
    Stream.filter((state) => state.status === 'ready'),
    Stream.runHead,
    Effect.timeout('10 seconds'),
  )

  return { client, prompts }
})

const eventually = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.retry({ schedule: Schedule.spaced('20 millis'), times: 100 }))

describe('Game Guide', () => {
  it.effect('reads the game, then says what is around the player and what to do next', () =>
    Effect.gen(function* () {
      const { client } = yield* setup()
      const here = yield* eventually(client.guideHere())

      expect(here).toMatchObject({ mapId: 1, mapName: 'Riverside', x: 5, y: 8 })
      expect(here.around.map((fact) => fact.summary)).toEqual(['Leads to Shrine Path', 'Ona'])
      expect(here.around[1]?.text).toBe('【Ona】月光花を持ってきて。')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('finds an item by its translated name, with where to get it and what it waits on', () =>
    Effect.gen(function* () {
      const { client } = yield* setup()
      const found = yield* eventually(client.findInGame({ query: 'moonpetal' }))

      expect(found.subjects).toHaveLength(1)
      expect(found.subjects[0]?.subject).toEqual({ kind: 'item', id: 1, name: 'Moonpetal' })

      expect(
        found.subjects[0]?.facts.map((fact) => [fact.summary, fact.place?.mapName, fact.status]),
      ).toEqual([
        ['Gives Moonpetal ×1', 'Shrine Path', 'open'],
        ['Sells Moonpetal for 60 G', 'Shrine Path', 'later'],
      ])

      expect(found.subjects[0]?.facts[1]?.gate).toEqual([
        { text: '"Festival started" is on', holds: false },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('answers from the facts its tools found, never ones they did not', () =>
    Effect.gen(function* () {
      const { client, prompts } = yield* setup()

      const events = yield* eventually(
        client.askGuide({ question: 'Where do I find a Moonpetal?' }).pipe(Stream.runCollect),
      )

      expect(events.flatMap((event) => (event.type === 'step' ? [event.label] : []))).toEqual([
        'Searching the game',
        'Finding where to get it',
      ])

      const answer = events.flatMap((event) => (event.type === 'answer' ? [event.answer] : []))[0]

      expect(answer).toMatchObject({
        question: 'Where do I find a Moonpetal?',
        text: 'Take the gate north to the Shrine Path and pick the glinting flower.',
        modelName: 'Scripted',
      })

      expect(answer?.facts.map((fact) => fact.summary)).toEqual([
        'Gives Moonpetal ×1',
        'Sells Moonpetal for 60 G',
      ])

      expect(answer?.sketch).toMatchObject({
        mapId: 2,
        target: { x: 4, y: 3 },
        route: ['Riverside', 'Shrine Path'],
      })

      expect(prompts).toHaveLength(3)

      expect(yield* client.guideConversation()).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('lets the model correct a call Wenbu could not read, and reads loose ones', () =>
    Effect.gen(function* () {
      const { client, prompts } = yield* setup(looseCalls)

      const events = yield* eventually(
        client.askGuide({ question: 'What do I do next?' }).pipe(Stream.runCollect),
      )

      const answer = events.flatMap((event) => (event.type === 'answer' ? [event.answer] : []))[0]

      expect(prompts).toHaveLength(4)
      expect(answer?.text).toBe('Take the gate to the Shrine Path and pick the flower.')

      expect(answer?.facts.map((fact) => fact.summary)).toEqual([
        'Leads to Shrine Path',
        'Ona',
        'Gives Moonpetal ×1',
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect('answers what a game contains from the names and dialogue in its own language', () =>
    Effect.gen(function* () {
      const { client, prompts } = yield* setup(askAboutContent)

      const events = yield* eventually(
        client
          .askGuide({ question: 'Does this game contain brainwashing?' })
          .pipe(Stream.runCollect),
      )

      const answer = events.flatMap((event) => (event.type === 'answer' ? [event.answer] : []))[0]

      expect(toolResults(prompts[1] ?? Prompt.make([]))).toMatchObject([
        { states: ['#1 洗脳: You are brainwashed.'] },
      ])

      expect(answer?.text).toBe(
        'Yes. The game has a Brainwashed state, and Ona talks about it.\n\n- It is a status effect\n- Ona mentions it in Riverside',
      )

      expect(answer?.facts.map((fact) => [fact.kind, fact.place?.mapName])).toEqual([
        ['dialogue', 'Riverside'],
      ])

      expect(answer?.sketch).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
