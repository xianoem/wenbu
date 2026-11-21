import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { LanguageModel, type Prompt, type Response } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import {
  QuickDelta,
  QuickDone,
  type QuickEvent,
  QuickLanguage,
  QuickTranslateRpc,
} from '#contract/QuickTranslate'
import { LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import { QuickTranslate, QuickTranslateRpcLive, translationReader } from './QuickTranslate'

const usage = {
  inputTokens: { uncached: 100, total: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: undefined, reasoning: undefined },
}

const isDelta = Schema.is(QuickDelta)

const isLanguage = Schema.is(QuickLanguage)

const isDone = Schema.is(QuickDone)

const textOf = (events: ReadonlyArray<QuickEvent>) =>
  events.flatMap((event) => (isDelta(event) ? [event.text] : [])).join('')

const contentText = (message: Prompt.Message) =>
  Predicate.isString(message.content)
    ? message.content
    : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

const scriptedModel = (prompts: Array<Prompt.Prompt>, reply: string) =>
  LanguageModel.make({
    generateText: () => Effect.die('Not used.'),
    streamText: (options) => {
      prompts.push(options.prompt)

      const pieces = reply.match(/[\s\S]{1,5}/g) ?? []

      return Stream.fromIterable<Response.StreamPartEncoded>([
        ...pieces.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
        { type: 'finish' as const, reason: 'stop' as const, usage, response: undefined },
      ])
    },
  })

const setup = (reply: string) =>
  Effect.gen(function* () {
    const prompts: Array<Prompt.Prompt> = []

    const llm = Layer.succeed(LlmClient)({
      model: () =>
        Effect.succeed({
          modelName: 'Scripted',
          layer: Layer.effect(LanguageModel.LanguageModel, scriptedModel(prompts, reply)),
          spend: () => Effect.succeed(0.002),
        }),
      describe: () => Effect.succeed({ presetName: 'Fast', modelName: 'Scripted' }),
      complete: () => Effect.die('Not used.'),
    })

    const layer = QuickTranslateRpcLive.pipe(
      Layer.provideMerge(QuickTranslate.layer),
      Layer.provideMerge(PresetReferences.layer),
      Layer.provide(llm),
      Layer.provide(KeyValueStore.layerSql()),
      Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
    )

    return { prompts, layer }
  })

const withPreset = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(QuickTranslateRpc)

  yield* client.saveQuickTranslateSettings({ enabled: true, presetId: 'fast' })

  return client
})

describe('translationReader', () => {
  const read = (pieces: ReadonlyArray<string>) => {
    const reader = translationReader()

    return [...pieces.flatMap((piece) => reader.push(piece)), ...reader.end()]
  }

  it('reads the language line even when it arrives in pieces', () => {
    const events = read(['LANG', 'UAGE: Japa', 'nese\nI had the ', 'same problem.'])

    expect(events.filter(isLanguage)).toEqual([QuickLanguage.make({ name: 'Japanese' })])
    expect(textOf(events)).toBe('I had the same problem.')
  })

  it('keeps the whole reply when the model skips the language line', () => {
    const events = read(['I had the same problem.\n', 'Then it worked.'])

    expect(events.filter(isLanguage)).toEqual([])
    expect(textOf(events)).toBe('I had the same problem.\nThen it worked.')
  })

  it('drops blank lines before and after the language line', () => {
    const events = read(['\n\nLanguage: Korean\n\n', 'Hello there.'])

    expect(events.filter(isLanguage)).toEqual([QuickLanguage.make({ name: 'Korean' })])
    expect(textOf(events)).toBe('Hello there.')
  })

  it('stops waiting for a language line once the first line is long', () => {
    const reader = translationReader()

    const long =
      'A first line that runs far longer than any language name could ever be written out.'

    expect(textOf(reader.push(`${long} More`))).toBe(`${long} More`)
  })
})

describe('QuickTranslate', () => {
  it.effect('streams the language, the translation and the cost', () =>
    Effect.gen(function* () {
      const { prompts, layer } = yield* setup('LANGUAGE: Japanese\nI had the same problem.')

      const events = yield* Effect.gen(function* () {
        const client = yield* withPreset

        return yield* Stream.runCollect(client.quickTranslate({ text: '  同じ症状でした。  ' }))
      }).pipe(Effect.provide(layer))

      expect(events.filter(isLanguage)).toEqual([QuickLanguage.make({ name: 'Japanese' })])
      expect(textOf(events)).toBe('I had the same problem.')

      expect(events.filter(isDone)).toEqual([
        QuickDone.make({ modelName: 'Scripted', costUsd: 0.002 }),
      ])

      const messages = prompts[0]?.content ?? []

      expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
      expect(messages[1] === undefined ? '' : contentText(messages[1])).toBe('同じ症状でした。')
    }),
  )

  it.effect('asks for a model before translating', () =>
    Effect.gen(function* () {
      const { layer } = yield* setup('LANGUAGE: Japanese\nHello.')

      const error = yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(QuickTranslateRpc)

        return yield* Effect.flip(Stream.runDrain(client.quickTranslate({ text: 'こんにちは' })))
      }).pipe(Effect.provide(layer))

      expect(error.reason).toBe('no-preset')
    }),
  )

  it.effect('refuses empty and very long selections', () =>
    Effect.gen(function* () {
      const { prompts, layer } = yield* setup('LANGUAGE: Japanese\nHello.')

      const errors = yield* Effect.gen(function* () {
        const client = yield* withPreset

        return yield* Effect.forEach(['   ', 'あ'.repeat(10_001)], (text) =>
          Effect.flip(Stream.runDrain(client.quickTranslate({ text }))),
        )
      }).pipe(Effect.provide(layer))

      expect(errors.map((error) => error.reason)).toEqual(['invalid', 'invalid'])
      expect(prompts).toEqual([])
    }),
  )

  it.effect('answers questions with the text, the translation and the conversation so far', () =>
    Effect.gen(function* () {
      const { prompts, layer } = yield* setup('\n\nIt sounds like they heard it from others.')

      const events = yield* Effect.gen(function* () {
        const client = yield* withPreset

        return yield* Stream.runCollect(
          client.quickAsk({
            text: '直ることが多いみたいです。',
            translation: 'It sounds like that usually fixes it.',
            history: [
              { role: 'user', text: 'Explain this text.' },
              { role: 'assistant', text: 'みたいです means “it sounds like”.' },
            ],
            question: 'Did they test it themselves?',
          }),
        )
      }).pipe(Effect.provide(layer))

      expect(textOf(events)).toBe('It sounds like they heard it from others.')
      expect(events.filter(isLanguage)).toEqual([])

      const messages = prompts[0]?.content ?? []

      expect(messages.map((message) => message.role)).toEqual([
        'system',
        'user',
        'assistant',
        'user',
      ])

      const system = messages[0] === undefined ? '' : contentText(messages[0])

      expect(system).toContain('直ることが多いみたいです。')
      expect(system).toContain('It sounds like that usually fixes it.')

      expect(messages[3] === undefined ? '' : contentText(messages[3])).toBe(
        'Did they test it themselves?',
      )
    }),
  )

  it.effect('forgets a preset that is deleted', () =>
    Effect.gen(function* () {
      const { layer } = yield* setup('')

      const settings = yield* Effect.gen(function* () {
        const client = yield* withPreset
        const references = yield* PresetReferences

        expect(yield* references.areasUsing(new Set(['fast']))).toEqual(['Quick Translate'])

        yield* references.clear(new Set(['fast']))

        return yield* client.getQuickTranslateSettings()
      }).pipe(Effect.provide(layer))

      expect(settings).toEqual({ enabled: true, presetId: '' })
    }),
  )
})
