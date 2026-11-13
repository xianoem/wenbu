import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Stream } from 'effect'
import { MangaRuntime, RunEvent } from './MangaRuntime'

const fakeWorker = fileURLToPath(new URL('./__fixtures__/fake-worker.mjs', import.meta.url))

const runtimeWith = (env: Record<string, string> = {}) =>
  MangaRuntime.layer(() => ({ command: process.execPath, args: [fakeWorker], env }), {
    idle: '1 minute',
  }).pipe(Layer.provide(NodeServices.layer))

const pages = [
  { source: 'in/1.jpg', output: 'out/1.jpg' },
  { source: 'in/2.jpg', output: 'out/2.jpg' },
]

const runAll = (
  reply: (
    texts: ReadonlyArray<string>,
  ) => { translations: ReadonlyArray<string> } | { error: string },
) =>
  Effect.gen(function* () {
    const runtime = yield* MangaRuntime
    const handle = yield* runtime.run('plugin', { options: {}, pages })

    return yield* handle.events.pipe(
      Stream.tap((event) =>
        RunEvent.$is('Translate')(event)
          ? handle.answer(event.id, reply(event.texts))
          : Effect.void,
      ),
      Stream.runCollect,
    )
  })

const kinds = [
  'LoadingModels',
  'ModelsLoaded',
  'PageStarted',
  'Stage',
  'Translate',
  'PageDone',
  'PageFailed',
  'Done',
  'Failed',
] as const

const tags = (events: ReadonlyArray<RunEvent>) =>
  events.map((event) => kinds.find((kind) => RunEvent.$is(kind)(event)))

describe('MangaRuntime', () => {
  it.effect('runs pages and asks Wenbu for each translation', () =>
    Effect.gen(function* () {
      const events = yield* runAll((texts) => ({
        translations: texts.map((text) => text.toUpperCase()),
      }))

      expect(tags(events)).toEqual([
        'LoadingModels',
        'ModelsLoaded',
        'PageStarted',
        'Stage',
        'Translate',
        'PageDone',
        'PageStarted',
        'Stage',
        'Translate',
        'PageDone',
        'Done',
      ])

      expect(events.at(-1)).toMatchObject({ cancelled: false, seconds: 1.5 })
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('reports a page whose translation failed', () =>
    Effect.gen(function* () {
      const events = yield* runAll(() => ({ error: 'The preset refused.' }))
      const failures = events.filter(RunEvent.$is('PageFailed'))

      expect(failures).toHaveLength(2)
      expect(failures[0]).toMatchObject({ message: 'The preset refused.' })
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('reuses the worker for the next run', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime
      const states: Array<string> = []

      yield* runtime.state.pipe(
        Stream.runForEach((state) => Effect.sync(() => states.push(state.status))),
        Effect.forkScoped,
      )

      yield* runAll((texts) => ({ translations: texts }))
      yield* runAll((texts) => ({ translations: texts }))

      expect(states.filter((status) => status === 'starting')).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(runtimeWith())),
  )

  it.effect('cancels a run', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime
      const handle = yield* runtime.run('plugin', { options: {}, pages })

      const events = yield* handle.events.pipe(
        Stream.tap((event) => (RunEvent.$is('Translate')(event) ? handle.cancel : Effect.void)),
        Stream.runCollect,
      )

      expect(events.at(-1)).toEqual(RunEvent.Done({ cancelled: true, seconds: undefined }))
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('fails the run with what the worker printed when it dies', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime
      const handle = yield* runtime.run('plugin', { options: { crash: true }, pages })
      const events = yield* Stream.runCollect(handle.events)

      expect(events.at(-1)).toEqual(
        RunEvent.Failed({ message: 'The manga worker stopped: CUDA error: out of memory' }),
      )
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('refuses a worker from another Wenbu version', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime
      const error = yield* Effect.flip(runtime.run('plugin', { options: {}, pages }))

      expect(error.message).toContain('another Wenbu version')
    }).pipe(Effect.provide(runtimeWith({ FAKE_PROTOCOL: '1' }))),
  )

  it.effect('runs an editor operation and returns its result', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime

      const result = yield* runtime.editor('plugin', {
        op: 'scan',
        options: {},
        source: 'in/1.jpg',
        mask: 'masks/1.png',
      })

      expect(result).toMatchObject({ width: 100, height: 200, blocks: [{ text: 'ねえ、' }, {}] })
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('fails an editor operation the worker could not do', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime

      const error = yield* Effect.flip(
        runtime
          .editor('plugin', { op: 'scan', options: {}, source: 'broken.jpg', mask: 'm.png' })
          .pipe(Effect.asVoid),
      )

      expect(error.message).toBe('The page could not be read.')
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.effect('waits for a running run before an editor operation', () =>
    Effect.gen(function* () {
      const runtime = yield* MangaRuntime
      const handle = yield* runtime.run('plugin', { options: {}, pages })

      const operation = yield* runtime
        .editor('plugin', { op: 'scan', options: {}, source: 'in/1.jpg', mask: 'm.png' })
        .pipe(Effect.forkScoped)

      const events = yield* handle.events.pipe(
        Stream.tap((event) =>
          RunEvent.$is('Translate')(event)
            ? Effect.andThen(
                Effect.sync(() => expect(operation.pollUnsafe()).toBeUndefined()),
                handle.answer(event.id, { translations: event.texts }),
              )
            : Effect.void,
        ),
        Stream.runCollect,
      )

      expect(tags(events).at(-1)).toBe('Done')
      expect(yield* Fiber.join(operation)).toMatchObject({ width: 100 })
    }).pipe(Effect.scoped, Effect.provide(runtimeWith())),
  )
})
