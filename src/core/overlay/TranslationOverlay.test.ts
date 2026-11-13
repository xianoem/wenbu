import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Layer, Option, Queue, Ref, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { GameCandidate, startLocaleOf } from '#contract/Library'
import {
  defaultOverlaySettings,
  OverlayError,
  type OverlaySettings,
  type OverlayState,
  TranslationOverlayRpc,
} from '#contract/TranslationOverlay'
import { GameLauncher, type GameExit } from '../library/GameLauncher'
import { LaunchAlias } from '../library/LaunchAlias'
import { Games } from '../library/Games'
import { type CompletionRequest, LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import { Plugins } from '../plugins/Plugins'
import { HostEvent, LunaHookHost } from './LunaHookHost'
import { OverlayPreferences } from './OverlayPreferences'
import { OverlayStore } from './OverlayStore'
import { TranslationOverlay, TranslationOverlayRpcLive } from './TranslationOverlay'

const dialogue = (pid: number) =>
  HostEvent.Thread({
    thread: `${pid}:dialogue`,
    pid,
    ctx: '4a10',
    ctx2: '0',
    code: 'HS8@0:Game.exe',
    name: 'TextOutA',
  })

const nameBox = (pid: number) =>
  HostEvent.Thread({
    thread: `${pid}:name`,
    pid,
    ctx: '9f00',
    ctx2: '0',
    code: 'HS8@0:Game.exe',
    name: 'TextOutA',
  })

const say = (thread: string, text: string) => HostEvent.Text({ thread, text })

const makeFakes = Effect.gen(function* () {
  const events = yield* Ref.make<Option.Option<Queue.Queue<HostEvent>>>(Option.none())
  const commands = yield* Ref.make<ReadonlyArray<string>>([])
  const requests = yield* Ref.make<ReadonlyArray<CompletionRequest>>([])
  const release = yield* Deferred.make<void>()
  const pluginInstalled = yield* Ref.make(true)
  const exited = yield* Deferred.make<GameExit>()

  const record = (command: string) => Ref.update(commands, (all) => [...all, command])

  const emit = (event: HostEvent) =>
    Effect.flatMap(Ref.get(events), (queue) =>
      Option.isSome(queue) ? Queue.offer(queue.value, event) : Effect.die('no session'),
    )

  const host = Layer.succeed(LunaHookHost)({
    start: () =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<HostEvent>()

        yield* Ref.set(events, Option.some(queue))
        yield* Effect.addFinalizer(() => record('quit'))

        return {
          events: Stream.fromQueue(queue),
          attach: (pid: number) =>
            pid === 666
              ? Effect.fail(
                  new OverlayError({
                    reason: 'elevated',
                    message: 'The game runs as administrator.',
                  }),
                )
              : record(`attach ${pid}`).pipe(
                  Effect.andThen(Queue.offer(queue, HostEvent.Connected({ pid }))),
                ),
          elevate: (pid: number) =>
            record(`elevate ${pid}`).pipe(
              Effect.andThen(Queue.offer(queue, HostEvent.Connected({ pid }))),
            ),
          detach: (pid: number) => record(`detach ${pid}`),
          insertHook: (pid: number, code: string) => record(`insertHook ${pid} ${code}`),
        }
      }),
    processes: Effect.succeed([
      { pid: 100, parentPid: 1, name: 'Game.exe', path: 'C:\\Games\\Aki\\Game.exe' },
      { pid: 300, parentPid: 1, name: 'Voice.exe', path: 'C:\\Launch\\aki\\Voice.exe' },
    ]),
  })

  const aliases = Layer.succeed(LaunchAlias)({
    prepare: () => Effect.die('The fake launcher starts no process.'),
    resolve: (game, processes) =>
      processes.map((process) =>
        process.path.startsWith('C:\\Launch\\aki\\')
          ? { ...process, path: process.path.replace('C:\\Launch\\aki', game.folderPath) }
          : process,
      ),
  })

  const llm = Layer.succeed(LlmClient)({
    model: () => Effect.die('The Game Guide model is not used here.'),
    complete: (request) =>
      Effect.gen(function* () {
        yield* Ref.update(requests, (all) => [...all, request])

        if (request.prompt.includes('ゆっくり')) {
          yield* Deferred.await(release)
        }

        const text =
          request.system?.includes('story summary') === true
            ? 'Aki (she/her) is the narrator.'
            : `EN:${request.prompt}`

        return { text, usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.01 }
      }),
    describe: () =>
      Effect.succeed({
        presetName: 'Dialogue',
        modelName: 'Fake 1',
        maxOutputTokens: 1000,
        contextWindow: 128_000,
      }),
  })

  const launcher = Layer.effect(
    GameLauncher,
    Effect.gen(function* () {
      const games = yield* Games

      return GameLauncher.of({
        launch: (id) =>
          Effect.map(games.get(id), (game) => ({
            game,
            locale: startLocaleOf(game, true),
            processId: 100,
            gameProcessId: Effect.succeed(Option.some(100)),
            exited: Deferred.await(exited),
          })),
      })
    }),
  )

  const plugins = Layer.succeed(Plugins)({
    state: Stream.empty,
    installedFolder: () =>
      Effect.map(Ref.get(pluginInstalled), (installed) =>
        installed ? Option.some('plugins/luna-hook') : Option.none(),
      ),
    check: Effect.void,
    install: () => Effect.void,
    cancel: () => Effect.void,
    remove: () => Effect.void,
    test: () => Effect.void,
  })

  return {
    host,
    llm,
    launcher,
    plugins,
    aliases,
    emit,
    commands,
    requests,
    release,
    pluginInstalled,
    exited,
  }
})

const setup = Effect.fn(function* (settings: Partial<OverlaySettings> = {}) {
  const fakes = yield* makeFakes

  const layer = TranslationOverlayRpcLive.pipe(
    Layer.provideMerge(
      TranslationOverlay.layerWith({
        debounce: '5 millis',
        poll: '10 millis',
        searchFor: '50 millis',
        crashWithin: '15 seconds',
        hooksEvery: '10 millis',
      }),
    ),
    Layer.provideMerge(Layer.mergeAll(OverlayStore.layer, OverlayPreferences.layer)),
    Layer.provideMerge(fakes.launcher),
    Layer.provideMerge(Games.layer),
    Layer.provide(Layer.mergeAll(fakes.host, fakes.llm, fakes.plugins, fakes.aliases)),
    Layer.provideMerge(PresetReferences.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
    Layer.provideMerge(DiskSpace.fixed(100 * 1024 ** 3)),
    Layer.provideMerge(NodeServices.layer),
  )

  const context = yield* Layer.build(layer)

  const client = yield* RpcTest.makeClient(TranslationOverlayRpc).pipe(
    Effect.provideContext(context),
  )

  const games = Context.get(context, Games)
  const store = Context.get(context, OverlayStore)
  const overlay = Context.get(context, TranslationOverlay)

  const game = yield* games.add(
    GameCandidate.make({
      title: 'Aki',
      folderPath: 'C:\\Games\\Aki',
      executablePath: 'C:\\Games\\Aki\\Game.exe',
      engine: 'windows',
      sizeBytes: 1,
      translation: 'original',
    }),
  )

  yield* client.saveOverlaySettings({
    ...defaultOverlaySettings,
    presetId: 'preset-1',
    ...settings,
  })

  const until = (done: (state: OverlayState) => boolean) =>
    client
      .watchOverlay()
      .pipe(
        Stream.filter(done),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('3 seconds'),
        Effect.orDie,
      )

  const translated = (text: string) => until((state) => state.translatedText === text)

  return { ...fakes, client, game, games, store, overlay, until, translated }
})

describe('TranslationOverlay', () => {
  it.live('attaches to a running game and translates the best hook once it is clear', () =>
    Effect.gen(function* () {
      const { client, game, emit, commands, translated } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', 'こんにちは、元気ですか？'))

      const state = yield* translated('EN:こんにちは、元気ですか？')

      expect(state).toMatchObject({
        gameTitle: 'Aki',
        processIds: [100],
        sourceText: 'こんにちは、元気ですか？',
        cacheHit: false,
        selectedHook: { id: '100:dialogue', code: 'HS8@0:Game.exe' },
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01, modelName: 'Fake 1' },
      })

      expect(yield* Ref.get(commands)).toEqual(['attach 100'])
    }).pipe(Effect.scoped),
  )

  it.live('picks the saved hook by code and context over a busier thread', () =>
    Effect.gen(function* () {
      const { client, game, store, emit, translated } = yield* setup()

      yield* store.saveHook(game.id, {
        code: 'HS8@0:Game.exe',
        name: 'TextOutA',
        ctx: '9f00',
        ctx2: '0',
        inserted: false,
        savedAt: '2026-10-23T00:00:00Z',
      })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(nameBox(100))
      yield* emit(say('100:dialogue', 'こんにちは、元気ですか？'))
      yield* emit(say('100:name', 'アキ'))

      const state = yield* translated('EN:アキ')

      expect(state.selectedHook?.id).toBe('100:name')
    }).pipe(Effect.scoped),
  )

  it.live('re-inserts hook codes the user added by hand when the game connects', () =>
    Effect.gen(function* () {
      const { client, game, store, commands, until } = yield* setup()

      yield* store.saveHook(game.id, {
        code: 'HS-1C@0:Game.exe',
        name: 'Manual',
        ctx: '0',
        ctx2: '0',
        inserted: true,
        savedAt: '2026-10-23T00:00:00Z',
      })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* until((state) => state.processIds.includes(100))
      yield* Effect.sleep('20 millis')

      expect(yield* Ref.get(commands)).toEqual(['attach 100', 'insertHook 100 HS-1C@0:Game.exe'])
    }).pipe(Effect.scoped),
  )

  it.live('serves a cached line without calling the model', () =>
    Effect.gen(function* () {
      const { client, game, store, emit, requests, until } = yield* setup()

      yield* store.cache(
        { gameId: game.id, targetLanguage: 'English', sourceText: 'こんにちは、元気ですか？' },
        'Hello, how are you?',
      )

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', 'こんにちは、元気ですか？'))

      const state = yield* until((current) => current.cacheHit)

      expect(state.translatedText).toBe('Hello, how are you?')
      expect(yield* Ref.get(requests)).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.live('cancels the request in flight when a new line arrives', () =>
    Effect.gen(function* () {
      const { client, game, emit, requests, translated } = yield* setup({ onNewLine: 'cancel' })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', 'ゆっくり話してください。'))
      yield* Effect.sleep('50 millis')
      yield* emit(say('100:dialogue', '次の台詞です、よろしく。'))

      yield* translated('EN:次の台詞です、よろしく。')

      expect((yield* Ref.get(requests)).map((request) => request.prompt)).toEqual([
        'ゆっくり話してください。',
        '次の台詞です、よろしく。',
      ])
    }).pipe(Effect.scoped),
  )

  it.live('finishes the request in flight, then translates only the newest line', () =>
    Effect.gen(function* () {
      const { client, game, emit, requests, release, translated, store } = yield* setup({
        onNewLine: 'finish',
      })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', 'ゆっくり話してください。'))
      yield* Effect.sleep('50 millis')
      yield* emit(say('100:dialogue', '二番目の台詞です。'))
      yield* Effect.sleep('30 millis')
      yield* emit(say('100:dialogue', '三番目の台詞です。'))
      yield* Effect.sleep('30 millis')
      yield* Deferred.succeed(release, undefined)

      yield* translated('EN:三番目の台詞です。')

      expect((yield* Ref.get(requests)).map((request) => request.prompt)).toEqual([
        'ゆっくり話してください。',
        '三番目の台詞です。',
      ])

      expect(
        yield* store.cached({
          gameId: game.id,
          targetLanguage: 'English',
          sourceText: 'ゆっくり話してください。',
        }),
      ).toEqual(Option.some('EN:ゆっくり話してください。'))
    }).pipe(Effect.scoped),
  )

  it.live('sends recent lines as history when context is on', () =>
    Effect.gen(function* () {
      const { client, game, emit, requests, translated } = yield* setup({
        context: { mode: 'recent', lines: 1, maxTokens: 2000, summaryEvery: 25 },
      })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', '一番目の台詞です。'))
      yield* translated('EN:一番目の台詞です。')
      yield* emit(say('100:dialogue', '二番目の台詞です。'))
      yield* translated('EN:二番目の台詞です。')
      yield* emit(say('100:dialogue', '三番目の台詞です。'))
      yield* translated('EN:三番目の台詞です。')

      expect((yield* Ref.get(requests))[2]?.history).toEqual([
        { role: 'user', text: '二番目の台詞です。' },
        { role: 'assistant', text: 'EN:二番目の台詞です。' },
      ])
    }).pipe(Effect.scoped),
  )

  it.live('refreshes the story summary in the background and keeps it for the next session', () =>
    Effect.gen(function* () {
      const { client, game, emit, requests, translated } = yield* setup({
        context: { mode: 'summary', lines: 3, maxTokens: 2000, summaryEvery: 2 },
      })

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', '一番目の台詞です。'))
      yield* translated('EN:一番目の台詞です。')
      yield* emit(say('100:dialogue', '二番目の台詞です。'))
      yield* translated('EN:二番目の台詞です。')
      yield* Effect.sleep('50 millis')

      const story = yield* client.getOverlayGame({ gameId: game.id })

      expect(story.story?.summary).toBe('Aki (she/her) is the narrator.')

      yield* emit(say('100:dialogue', '三番目の台詞です。'))
      yield* translated('EN:三番目の台詞です。')

      const last = (yield* Ref.get(requests)).at(-1)

      expect(last?.system).toContain('Aki (she/her) is the narrator.')

      yield* client.resetStory({ gameId: game.id })

      expect((yield* client.getOverlayGame({ gameId: game.id })).story).toBeUndefined()
    }).pipe(Effect.scoped),
  )

  it.live('ignores lines while paused and retranslates the last line on retry', () =>
    Effect.gen(function* () {
      const { client, game, emit, requests, translated, until } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(say('100:dialogue', '一番目の台詞です。'))
      yield* translated('EN:一番目の台詞です。')

      yield* client.setOverlayPaused({ paused: true })
      yield* until((state) => state.paused)
      yield* emit(say('100:dialogue', '二番目の台詞です。'))
      yield* Effect.sleep('50 millis')

      expect(yield* Ref.get(requests)).toHaveLength(1)

      yield* client.retryTranslation()
      yield* Effect.sleep('50 millis')

      expect((yield* Ref.get(requests)).map((request) => request.prompt)).toEqual([
        '一番目の台詞です。',
        '一番目の台詞です。',
      ])
    }).pipe(Effect.scoped),
  )

  it.live('saves the hook the user picks', () =>
    Effect.gen(function* () {
      const { client, game, emit, store, translated } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* emit(dialogue(100))
      yield* emit(nameBox(100))
      yield* emit(say('100:dialogue', 'こんにちは、元気ですか？'))
      yield* translated('EN:こんにちは、元気ですか？')
      yield* emit(say('100:name', 'アキ'))

      const hooks = yield* client.watchOverlayHooks().pipe(
        Stream.filter((all) => all.length === 2 && all.every((hook) => hook.samples.length > 0)),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      )

      expect(hooks[0]?.id).toBe('100:dialogue')

      yield* client.selectHook({ hookId: '100:name' })
      yield* translated('EN:アキ')

      expect(yield* store.savedHook(game.id)).toMatchObject(
        Option.some({ code: 'HS8@0:Game.exe', ctx: '9f00', inserted: false, sample: 'アキ' }),
      )
    }).pipe(Effect.scoped),
  )

  it.live("finds and attaches to processes started through the game's launch alias", () =>
    Effect.gen(function* () {
      const { client, game, commands, until } = yield* setup()
      const found = yield* client.findGameProcesses({ gameId: game.id })

      expect(found.map((match) => [match.processId, match.executablePath])).toEqual([
        [100, 'C:\\Games\\Aki\\Game.exe'],
        [300, 'C:\\Games\\Aki\\Voice.exe'],
      ])

      yield* client.launchWithOverlay({ gameId: game.id })
      yield* until((state) => state.processIds.includes(300))

      expect(yield* Ref.get(commands)).toContain('attach 300')
    }).pipe(Effect.scoped),
  )

  it.live('ends the session when the game exits', () =>
    Effect.gen(function* () {
      const { client, game, emit, commands, until } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* until((state) => state.processIds.includes(100))
      yield* emit(HostEvent.Disconnected({ pid: 100 }))

      const state = yield* until((current) => current.status === 'stopped')

      expect(state.message).toBe('Aki exited.')
      expect(state.sessionId).toBeUndefined()
      yield* Effect.sleep('20 millis')
      expect(yield* Ref.get(commands)).toContain('quit')
    }).pipe(Effect.scoped),
  )

  it.live('names the locale tool a game did not start with', () =>
    Effect.gen(function* () {
      const { client, game, games, exited, until } = yield* setup()

      yield* games.setLocale(game.id, 'locale-remulator')
      yield* client.launchWithOverlay({ gameId: game.id })
      yield* Deferred.succeed(exited, { seconds: 20, found: false })

      const state = yield* until((current) => current.status === 'failed')

      expect(state.message).toBe(
        'Aki closed right after starting with Locale Remulator. Try another locale.',
      )

      expect(state.offer).toBeUndefined()
    }).pipe(Effect.scoped),
  )

  it.live('offers a Japanese locale when the game closes right after launch', () =>
    Effect.gen(function* () {
      const { client, game, exited, until } = yield* setup()

      yield* client.launchWithOverlay({ gameId: game.id })
      yield* Deferred.succeed(exited, { seconds: 2, found: true })

      const state = yield* until((current) => current.offer !== undefined)

      expect(state).toMatchObject({
        status: 'failed',
        message: 'Aki closed right after starting. Some games only run on a Japanese system.',
        offer: { kind: 'locale', locale: 'ntleas' },
      })
    }).pipe(Effect.scoped),
  )

  it.live('offers to attach as administrator', () =>
    Effect.gen(function* () {
      const { client, game, commands, until } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 666 })

      const state = yield* until((current) => current.offer !== undefined)

      expect(state.offer).toEqual({ kind: 'elevated', processId: 666 })

      yield* client.attachOverlayElevated({ processId: 666 })
      yield* until((current) => current.processIds.includes(666))

      expect(yield* Ref.get(commands)).toEqual(['elevate 666'])
    }).pipe(Effect.scoped),
  )

  it.live('asks for LunaHook when the plugin is missing', () =>
    Effect.gen(function* () {
      const { client, game, pluginInstalled } = yield* setup()

      yield* Ref.set(pluginInstalled, false)

      const error = yield* Effect.flip(client.attachOverlay({ gameId: game.id, processId: 100 }))

      expect(error.reason).toBe('not-ready')
    }).pipe(Effect.scoped),
  )

  it.live('passes Detections text to a visible session', () =>
    Effect.gen(function* () {
      const { client, game, overlay, until, translated } = yield* setup()

      yield* client.attachOverlay({ gameId: game.id, processId: 100 })
      yield* until((state) => state.processIds.includes(100))
      yield* overlay.submitText('画像の文章です。')

      yield* translated('EN:画像の文章です。')
    }).pipe(Effect.scoped),
  )
})
