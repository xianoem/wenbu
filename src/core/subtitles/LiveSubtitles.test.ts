import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Logger, Option, Path, Queue, Ref, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { type SubtitleLine, type SubtitleState, SubtitlesRpc } from '#contract/Subtitles'
import { type CompletionRequest, LlmClient, LlmClientError } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as Database from '../platform/Database'
import { manifestFile } from '../plugins/definitions/SpeechModel'
import { Plugins } from '../plugins/Plugins'
import { LiveSubtitles, SubtitlesRpcLive } from './LiveSubtitles'
import { SpeechEvent, SpeechHelper, type SpeechOptions } from './SpeechHelper'
import { defaultSubtitleSettings, SubtitlePreferences } from './SubtitlePreferences'

const said = (id: number, text: string, start: number, ms = 300) =>
  SpeechEvent.Utterance({ id, text, language: 'ja', start, end: start + 2, ms })

const setup = Effect.fn(function* (
  options: { readonly pluginInstalled?: boolean; readonly manifest?: string } = {},
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folder = yield* fs.makeTempDirectoryScoped()

  yield* fs.writeFileString(path.join(folder, manifestFile), options.manifest ?? '{"size":"0.6B"}')

  const events = yield* Ref.make<Option.Option<Queue.Queue<SpeechEvent>>>(Option.none())
  const started = yield* Ref.make<ReadonlyArray<SpeechOptions>>([])
  const requests = yield* Ref.make<ReadonlyArray<CompletionRequest>>([])

  const speech = Layer.succeed(SpeechHelper)({
    start: (speechOptions) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<SpeechEvent>()

        yield* Ref.set(events, Option.some(queue))
        yield* Ref.update(started, (all) => [...all, speechOptions])

        return {
          events: Stream.fromQueue(queue),
          setSource: () => Effect.void,
          setPaused: () => Effect.void,
        }
      }),
    sources: Effect.succeed({ outputs: [], apps: [], appCapture: true }),
  })

  const llm = Layer.succeed(LlmClient)({
    model: () => Effect.die('The Game Guide model is not used here.'),
    complete: (request) =>
      Ref.update(requests, (all) => [...all, request]).pipe(
        Effect.andThen(
          request.prompt.includes('通信')
            ? Effect.fail(new LlmClientError({ message: 'Timed out' }))
            : Effect.void,
        ),
        Effect.as({
          text: request.prompt.includes('失敗') ? '' : `EN:${request.prompt}`,
          usage: { inputTokens: 10, outputTokens: 5 },
          costUsd: 0.001,
        }),
      ),
    describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Fake' }),
  })

  const plugins = Layer.succeed(Plugins)({
    state: Stream.empty,
    installedFolder: () =>
      Effect.succeed(options.pluginInstalled === false ? Option.none() : Option.some(folder)),
    check: Effect.void,
    install: () => Effect.void,
    cancel: () => Effect.void,
    remove: () => Effect.void,
    test: () => Effect.void,
  })

  const layer = SubtitlesRpcLive.pipe(
    Layer.provideMerge(LiveSubtitles.layer),
    Layer.provideMerge(SubtitlePreferences.layer),
    Layer.provide(Layer.mergeAll(speech, llm, plugins)),
    Layer.provideMerge(PresetReferences.layer),
    Layer.provideMerge(KeyValueStore.layerSql({ table: 'settings' })),
    Layer.provideMerge(Database.layer(':memory:')),
  )

  const context = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(SubtitlesRpc).pipe(Effect.provideContext(context))

  const emit = (event: SpeechEvent) =>
    Effect.flatMap(Ref.get(events), (queue) =>
      Option.isSome(queue) ? Queue.offer(queue.value, event) : Effect.die('no session'),
    )

  const until = (done: (state: SubtitleState) => boolean) =>
    client
      .watchSubtitles()
      .pipe(
        Stream.filter(done),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('3 seconds'),
        Effect.orDie,
      )

  const backlogUntil = (done: (lines: ReadonlyArray<SubtitleLine>) => boolean) =>
    client
      .watchSubtitleBacklog()
      .pipe(
        Stream.filter(done),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('3 seconds'),
        Effect.orDie,
      )

  return { client, emit, until, backlogUntil, started, requests }
})

describe('LiveSubtitles', () => {
  it.live('asks for a preset before it starts', () =>
    Effect.gen(function* () {
      const { client } = yield* setup()
      const error = yield* Effect.flip(client.startSubtitles())

      expect(error.reason).toBe('no-preset')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('asks for the plugin when Qwen3-ASR is not installed', () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ pluginInstalled: false })

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })

      const error = yield* Effect.flip(client.startSubtitles())

      expect(error.reason).toBe('no-plugin')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('turns what is heard into translated lines', () =>
    Effect.gen(function* () {
      const { client, emit, until, backlogUntil, started } = yield* setup()

      yield* client.saveSubtitleSettings({
        ...defaultSubtitleSettings,
        presetId: 'preset-1',
        sensitivity: 'high',
      })

      yield* client.startSubtitles()
      yield* emit(SpeechEvent.ModelLoaded({ device: 'RTX 3070', seconds: 2 }))
      yield* emit(SpeechEvent.Listening())
      yield* until((state) => state.status === 'listening' && state.device === 'RTX 3070')
      yield* emit(SpeechEvent.Partial({ id: 1, text: 'ねえ' }))
      yield* until((state) => state.partial === 'ねえ')
      yield* emit(said(1, 'ねえ、本当なの？', 0))

      const lines = yield* backlogUntil((all) => all[0]?.status === 'translated')

      expect(lines.map((line) => [line.original, line.translation])).toEqual([
        ['ねえ、本当なの？', 'EN:ねえ、本当なの？'],
      ])

      const state = yield* until((value) => value.tokens > 0)

      expect(state.partial).toBeUndefined()
      expect(state.recent.map((line) => line.id)).toEqual([lines[0]?.id])
      expect((yield* Ref.get(started))[0]?.threshold).toBe(0.35)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('joins an unfinished sentence with the utterance that completes it', () =>
    Effect.gen(function* () {
      const { client, emit, backlogUntil, requests } = yield* setup()

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
      yield* client.startSubtitles()
      yield* emit(said(1, 'だったら、どうして', 0))
      yield* emit(said(2, '今まで黙っていたの？', 2.5))

      const lines = yield* backlogUntil((all) => all[0]?.status === 'translated')

      expect(lines.map((line) => line.original)).toEqual(['だったら、どうして今まで黙っていたの？'])
      expect(lines[0]?.start).toBe(0)

      expect((yield* Ref.get(requests)).map((request) => request.prompt)).toEqual([
        'だったら、どうして今まで黙っていたの？',
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('sends the previous lines as context', () =>
    Effect.gen(function* () {
      const { client, emit, backlogUntil, requests } = yield* setup()

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
      yield* client.startSubtitles()
      yield* emit(said(1, '一つ目。', 0))
      yield* backlogUntil((all) => all[0]?.status === 'translated')
      yield* emit(said(2, '二つ目。', 3))
      yield* backlogUntil((all) => all[1]?.status === 'translated')

      const last = (yield* Ref.get(requests)).at(-1)

      expect(last?.history).toEqual([
        { role: 'user', text: '一つ目。' },
        { role: 'assistant', text: 'EN:一つ目。' },
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('keeps the overlay style in step with the settings', () =>
    Effect.gen(function* () {
      const { client, until } = yield* setup()

      yield* client.saveSubtitleSettings({
        ...defaultSubtitleSettings,
        presetId: 'preset-1',
        overlayMode: 'translation',
      })

      yield* until((state) => state.overlayMode === 'translation')
      yield* client.setSubtitleTextSize({ textSize: 3 })
      yield* until((state) => state.textSize === 3)

      const saved = yield* client.getSubtitleSettings()

      expect([saved.textSize, saved.overlayMode, saved.presetId]).toEqual([
        3,
        'translation',
        'preset-1',
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('stops when capture fails and keeps the backlog until the next start', () =>
    Effect.gen(function* () {
      const { client, emit, until, backlogUntil } = yield* setup()

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
      yield* client.startSubtitles()
      yield* emit(said(1, 'こんにちは。', 0))
      yield* backlogUntil((all) => all.length === 1)
      yield* emit(SpeechEvent.CaptureFailed({ message: 'The app closed.' }))

      const failed = yield* until((state) => state.status === 'failed')

      expect(failed.message).toBe('The app closed.')
      expect((yield* backlogUntil(() => true)).length).toBe(1)

      yield* client.startSubtitles()

      expect(yield* backlogUntil((all) => all.length === 0)).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('says when recognition runs slowly, and stops saying it once it catches up', () =>
    Effect.gen(function* () {
      const { client, emit, until } = yield* setup()

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
      yield* client.startSubtitles()
      yield* emit(said(1, '一。', 0, 1100))
      yield* emit(said(2, '二。', 2, 900))
      yield* until((state) => state.slowRecognition === true)
      yield* emit(said(3, '三。', 4, 200))
      yield* emit(said(4, '四。', 6, 250))
      yield* until((state) => state.slowRecognition !== true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('starts the model chosen in the settings and names it', () =>
    Effect.gen(function* () {
      const { client, emit, until, started } = yield* setup({ manifest: '{"size":"Q8_0"}' })

      yield* client.saveSubtitleSettings({
        ...defaultSubtitleSettings,
        presetId: 'preset-1',
        model: 'sensevoice-small',
      })

      yield* client.startSubtitles()
      yield* emit(SpeechEvent.ModelLoaded({ device: 'RTX 3070', seconds: 1 }))

      const state = yield* until((value) => value.device === 'RTX 3070')

      expect(state.model).toBe('SenseVoice Small')
      expect((yield* Ref.get(started))[0]?.model).toMatch(/SenseVoiceSmall-Q8_0\.gguf$/)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('tidies the spaces a model puts between Japanese words', () =>
    Effect.gen(function* () {
      const { client, emit, backlogUntil } = yield* setup()

      yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
      yield* client.startSubtitles()
      yield* emit(said(1, '嘘 を つく 理由 なんて ないよ。', 0))

      const lines = yield* backlogUntil((all) => all.length > 0)

      expect(lines[0]?.original).toBe('嘘をつく理由なんてないよ。')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('asks for the chosen model when its plugin is not installed', () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ pluginInstalled: false })

      yield* client.saveSubtitleSettings({
        ...defaultSubtitleSettings,
        presetId: 'preset-1',
        model: 'whisper-large-v3-turbo',
      })

      const error = yield* Effect.flip(client.startSubtitles())

      expect(error.message).toContain('Whisper large-v3 turbo')
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.live('logs how a session goes, without the words heard', () =>
    Effect.gen(function* () {
      const logged: Array<readonly [string, string]> = []

      const logger = Logger.make(({ logLevel, message }) => {
        logged.push([logLevel, String(Array.isArray(message) ? message[0] : message)])
      })

      yield* Effect.gen(function* () {
        const { client, emit, backlogUntil } = yield* setup()

        yield* client.saveSubtitleSettings({ ...defaultSubtitleSettings, presetId: 'preset-1' })
        yield* client.startSubtitles()
        yield* emit(SpeechEvent.ModelLoaded({ device: 'RTX 3070', seconds: 2 }))
        yield* emit(said(1, '通信が切れた。', 0))
        yield* backlogUntil((all) => all[0]?.status === 'failed')
        yield* client.stopSubtitles()
      }).pipe(Effect.provide(Logger.layer([logger])))

      expect(logged).toEqual(
        expect.arrayContaining([
          ['Info', 'Live Subtitles started'],
          ['Info', 'Speech model loaded'],
          ['Warn', 'Subtitle line not translated'],
          ['Info', 'Live Subtitles stopped'],
        ]),
      )

      expect(logged.some(([, message]) => message.includes('通信'))).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
