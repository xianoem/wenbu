import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, Path, Ref, Stream } from 'effect'
import type { ProblemCount } from '#contract/Diagnostics'
import { parseLogText } from '#contract/LogText'
import { LogBook, type LogBookOptions } from './LogBook'

const logInto = <A, E>(
  options: Omit<LogBookOptions, 'folder'>,
  program: Effect.Effect<A, E, LogBook>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped()
    const folder = path.join(root, '2026-10-25T14-03-11')

    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          LogBook.logger.pipe(Layer.provideMerge(LogBook.layerWith({ ...options, folder }))),
        )

        yield* program.pipe(Effect.provideContext(context))
      }),
    )

    return parseLogText(yield* fs.readFileString(path.join(folder, 'core.log')))
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

const options = { run: 2, home: 'C:\\Users\\Ana' }

describe('LogBook', () => {
  it.effect('writes info and above, tagged with the core run', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.gen(function* () {
          yield* Effect.logInfo('Game launched').pipe(Effect.annotateLogs({ feature: 'library' }))
          yield* Effect.logWarning('Stored settings were unreadable')
        }),
      )

      assert.deepStrictEqual(
        entries.map((entry) => [
          entry.level,
          entry.process,
          entry.run,
          entry.feature,
          entry.message,
        ]),
        [
          ['info', 'core', 2, 'library', 'Game launched'],
          ['warn', 'core', 2, 'core', 'Stored settings were unreadable'],
        ],
      )
    }),
  )

  it.effect('keeps debug entries back until an error needs them', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.gen(function* () {
          yield* Effect.logDebug('Page rendered')
          yield* Effect.logInfo('Job started')
          yield* Effect.logDebug('Page inpainted')
          yield* Effect.logError('Worker exited')
          yield* Effect.logDebug('After the error')
        }),
      )

      assert.deepStrictEqual(
        entries.map((entry) => entry.message),
        ['Job started', 'Page rendered', 'Page inpainted', 'Worker exited'],
      )
    }),
  )

  it.effect('writes debug entries as they come while verbose', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.gen(function* () {
          const book = yield* LogBook

          yield* book.setVerbose(true)
          yield* Effect.logDebug('LLM request finished')
        }),
      )

      assert.deepStrictEqual(
        entries.map((entry) => entry.message),
        ['LLM request finished'],
      )
    }),
  )

  it.effect('hides private fields and the home folder', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.logInfo('Game added').pipe(
          Effect.annotateLogs({
            prompt: 'secret game text',
            folder: 'C:\\Users\\Ana\\Games\\Witch',
            count: 3,
          }),
        ),
      )

      assert.deepStrictEqual(entries[0]?.fields, {
        prompt: '<redacted>',
        folder: '%USERPROFILE%\\Games\\Witch',
        count: '3',
      })
    }),
  )

  it.effect('names the feature after the outermost span it knows', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.logInfo('Request finished').pipe(
          Effect.withSpan('LlmClient.translate'),
          Effect.withSpan('GameTranslation.start'),
        ),
      )

      assert.strictEqual(entries[0]?.feature, 'translation')
    }),
  )

  it.effect('names Live Subtitles and its speech models', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.all([
          Effect.logInfo('Subtitle line translated').pipe(
            Effect.withSpan('LlmClient.complete'),
            Effect.withSpan('LiveSubtitles.start'),
          ),
          Effect.logInfo('Settings saved').pipe(Effect.withSpan('SubtitlePreferences.save')),
          Effect.logInfo('Model tested').pipe(Effect.withSpan('SpeechModel.test')),
        ]),
      )

      assert.deepStrictEqual(
        entries.map((entry) => entry.feature),
        ['subtitles', 'subtitles', 'plugins'],
      )
    }),
  )

  it.effect('keeps only warnings and errors once the file is full', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        { ...options, maxBytes: 150 },
        Effect.gen(function* () {
          yield* Effect.logInfo('First line that fills most of the small file budget here')
          yield* Effect.logInfo('Second line that goes past the budget')
          yield* Effect.logInfo('Dropped')
          yield* Effect.logError('Still written')
        }),
      )

      assert.deepStrictEqual(
        entries.map((entry) => entry.message),
        [
          'First line that fills most of the small file budget here',
          'Second line that goes past the budget',
          'Log file is full; keeping only warnings and errors',
          'Still written',
        ],
      )
    }),
  )

  it.effect('keeps only warnings and errors while the drive is almost full', () =>
    Effect.gen(function* () {
      const entries = yield* logInto(
        options,
        Effect.gen(function* () {
          const book = yield* LogBook

          yield* Effect.logInfo('Before')
          yield* book.setLowSpace(true)
          yield* Effect.logInfo('Dropped')
          yield* Effect.logWarning('Drive is almost full')
          yield* book.setLowSpace(false)
          yield* Effect.logInfo('After')
        }),
      )

      assert.deepStrictEqual(
        entries.map((entry) => entry.message),
        ['Before', 'Drive is almost full', 'After'],
      )
    }),
  )

  it.effect('counts warnings and errors from every process since the launch started', () =>
    Effect.gen(function* () {
      const counted = yield* Ref.make<Option.Option<ProblemCount>>(Option.none())

      yield* logInto(
        options,
        Effect.gen(function* () {
          const book = yield* LogBook

          yield* Effect.logInfo('Game launched')
          yield* Effect.logWarning('Stored settings were unreadable')

          yield* Effect.logError('Overlay lost the game window').pipe(
            Effect.annotateLogs({ feature: 'overlay' }),
          )

          book.forward({
            at: 5,
            level: 'error',
            process: 'renderer',
            run: 0,
            feature: 'renderer',
            message: 'Cannot read properties of undefined',
            fields: {},
          })

          yield* Ref.set(counted, yield* Stream.runHead(yield* book.problems))
        }).pipe(Effect.scoped),
      )

      const count = Option.getOrUndefined(yield* Ref.get(counted))

      assert.strictEqual(count?.warnings, 1)
      assert.strictEqual(count?.errors, 2)

      assert.deepStrictEqual(count?.lastError, {
        at: 5,
        feature: 'renderer',
        message: 'Cannot read properties of undefined',
      })
    }),
  )
})
