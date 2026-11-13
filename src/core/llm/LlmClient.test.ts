import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Predicate, Redacted, Schema } from 'effect'
import { HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/http'
import { LlmConnection, LlmModel, LlmPreset } from '#contract/Llm'
import { LlmClient } from './LlmClient'
import type { PresetRuntime } from './LlmStore'
import type { UsageRecord } from './UsageLog'

const timestamps = { createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z' }

const runtimeFor = (options: {
  readonly provider: LlmConnection['provider']
  readonly model: LlmModel
  readonly reasoning: string
}): PresetRuntime => ({
  preset: LlmPreset.make({
    id: 'preset-1',
    name: 'Game dialogue',
    connectionId: 'connection-1',
    modelId: options.model.id,
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 4096,
    reasoning: options.reasoning,
    ...timestamps,
  }),
  connection: LlmConnection.make({
    id: 'connection-1',
    name: 'Provider',
    provider: options.provider,
    verification: 'verified',
    ...timestamps,
  }),
  apiKey: Redacted.make('sk-test'),
  model: options.model,
})

const deepseek = LlmModel.make({
  provider: 'deepseek',
  id: 'deepseek-flash',
  name: 'DeepSeek Flash',
  contextWindow: 1_000_000,
  maxOutputTokens: 300_000,
  inputModalities: ['text'],
  reasoning: { toggle: true, efforts: ['low', 'high', 'max'] },
  price: { input: 0.15, output: 0.6 },
})

const claude = LlmModel.make({
  provider: 'anthropic',
  id: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  inputModalities: ['text'],
  reasoning: { toggle: false, efforts: [], budget: { min: 1024 } },
  price: { input: 3, output: 15 },
})

const RequestBody = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

const capture = (
  respond: (request: HttpClientRequest.HttpClientRequest) => unknown,
  requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }>,
) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const text = Predicate.isTagged(request.body, 'Uint8Array')
          ? new TextDecoder().decode(request.body.body)
          : '{}'

        requests.push({
          url: request.url,
          body: yield* Effect.orDie(Schema.decodeEffect(RequestBody)(text)),
        })

        return HttpClientResponse.fromWeb(request, Response.json(respond(request)))
      }),
    ),
  )

const complete = (
  runtime: PresetRuntime,
  http: Layer.Layer<HttpClient.HttpClient>,
  recorded: Array<UsageRecord> = [],
) =>
  Effect.gen(function* () {
    const client = yield* LlmClient.make({
      presetRuntime: () => Effect.succeed(runtime),
      record: (usage) => Effect.sync(() => recorded.push(usage)),
    })

    return yield* client.complete({
      presetId: runtime.preset.id,
      system: 'Translate Japanese game text into English.',
      prompt: 'こんにちは',
      feature: 'rpg-translation',
      gameId: 'game-1',
    })
  }).pipe(Effect.provide(http))

const deepseekReply = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'deepseek-flash',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
}

describe('LlmClient', () => {
  it.effect('records each completion as LLM Usage for its feature and game', () =>
    Effect.gen(function* () {
      const recorded: Array<UsageRecord> = []

      yield* complete(
        runtimeFor({ provider: 'deepseek', model: deepseek, reasoning: 'high' }),
        capture(() => deepseekReply, []),
        recorded,
      )

      assert.lengthOf(recorded, 1)

      assert.deepInclude(recorded[0], {
        feature: 'rpg-translation',
        gameId: 'game-1',
        presetId: 'preset-1',
        presetName: 'Game dialogue',
        modelId: 'deepseek-flash',
        inputTokens: 1000,
        cachedTokens: 0,
        outputTokens: 500,
      })

      assert.closeTo(recorded[0]?.costUsd ?? 0, 0.00045, 1e-9)
    }),
  )

  it.effect('sends an OpenAI-compatible request and prices the usage', () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = []

      const completion = yield* complete(
        runtimeFor({ provider: 'deepseek', model: deepseek, reasoning: 'high' }),
        capture(
          () => ({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 1,
            model: 'deepseek-flash',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
          }),
          requests,
        ),
      )

      assert.strictEqual(completion.text, 'Hello')
      assert.strictEqual(requests[0]?.url, 'https://api.deepseek.com/chat/completions')

      const body = requests[0]?.body

      assert.strictEqual(body?.['model'], 'deepseek-flash')
      assert.strictEqual(body?.['temperature'], 0.7)
      assert.strictEqual(body?.['top_p'], 0.9)
      assert.strictEqual(body?.['max_tokens'], 4096)
      assert.strictEqual(body?.['reasoning_effort'], 'high')
      assert.deepStrictEqual(completion.usage, { inputTokens: 1000, outputTokens: 500 })
      assert.closeTo(completion.costUsd ?? 0, 0.00045, 1e-9)
    }),
  )

  it.effect('enables Anthropic thinking with a budget and leaves sampling to the model', () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = []

      const completion = yield* complete(
        runtimeFor({ provider: 'anthropic', model: claude, reasoning: 'thinking' }),
        capture(
          () => ({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'Hello', citations: null }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              cache_creation: null,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              input_tokens: 2000,
              output_tokens: 1000,
              service_tier: null,
            },
          }),
          requests,
        ),
      )

      assert.strictEqual(completion.text, 'Hello')
      assert.isTrue(requests[0]?.url.startsWith('https://api.anthropic.com/v1/messages'))

      const body = requests[0]?.body

      assert.deepStrictEqual(body?.['thinking'], { type: 'enabled', budget_tokens: 2048 })
      assert.notProperty(body, 'temperature')
      assert.strictEqual(body?.['max_tokens'], 4096)
      assert.closeTo(completion.costUsd ?? 0, 0.021, 1e-9)
    }),
  )
})
