import { assert, describe, it } from '@effect/vitest'
import { DateTime, Effect, Layer, Option } from 'effect'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { KeyValueStore } from 'effect/persistence'
import { LlmModel } from '#contract/Llm'
import { CachedCatalog, ModelCatalog, type ModelsDev, toLlmModels } from './ModelCatalog'

const modelsDev = {
  deepseek: {
    models: {
      'deepseek-flash': {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash',
        reasoning: true,
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1_048_576, output: 393_216 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
      },
      broken: { id: 'broken', name: 'Missing limits' },
    },
  },
  anthropic: {
    models: {
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        reasoning: true,
        reasoning_options: [{ type: 'budget_tokens', min: 1024 }],
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200_000, output: 64_000 },
        cost: { input: 3, output: 15 },
      },
    },
  },
  openai: {
    models: {
      'text-embedding-3-small': {
        id: 'text-embedding-3-small',
        name: 'Embedding',
        type: 'embedding',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 8191, output: 1536 },
      },
      'gpt-image-1': {
        id: 'gpt-image-1',
        name: 'GPT Image',
        modalities: { input: ['text'], output: ['image'] },
        limit: { context: 0, output: 0 },
      },
    },
  },
  mistral: {
    models: {
      'mistral-large': {
        id: 'mistral-large',
        name: 'Mistral Large',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 128_000, output: 8_000 },
      },
    },
  },
}

const snapshot = [
  LlmModel.make({
    provider: 'openai',
    id: 'gpt-snapshot',
    name: 'Snapshot model',
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    inputModalities: ['text'],
  }),
]

const respondWith = (body: ModelsDev) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body))),
    ),
  )

const unreachable = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, description: 'offline' }),
      }),
    ),
  ),
)

const catalogWith = (http: Layer.Layer<HttpClient.HttpClient>) =>
  Layer.effect(ModelCatalog, ModelCatalog.make({ snapshot })).pipe(
    Layer.provide(http),
    Layer.provideMerge(KeyValueStore.layerMemory),
  )

describe('toLlmModels', () => {
  it('keeps text models of supported providers and skips the rest', () => {
    const models = toLlmModels(modelsDev)

    assert.deepStrictEqual(
      models.map((model) => `${model.provider}/${model.id}`),
      ['anthropic/claude-sonnet-4-5', 'deepseek/deepseek-flash'],
    )
  })

  it('reads reasoning options, limits and prices', () => {
    const [claude, deepseek] = toLlmModels(modelsDev)

    assert.deepStrictEqual(deepseek?.reasoning, { toggle: true, efforts: ['low', 'high', 'max'] })
    assert.deepStrictEqual(deepseek?.price, { input: 0.15, output: 0.6, cacheRead: 0.003 })
    assert.strictEqual(deepseek?.maxOutputTokens, 393_216)
    assert.deepStrictEqual(claude?.reasoning, { toggle: false, efforts: [], budget: { min: 1024 } })
  })
})

describe('ModelCatalog', () => {
  it.effect('starts from the bundled snapshot', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog

      assert.deepStrictEqual(
        (yield* catalog.models).map((model) => model.id),
        ['gpt-snapshot'],
      )
    }).pipe(Effect.provide(catalogWith(unreachable))),
  )

  it.effect('refresh replaces the catalog and caches it', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog

      yield* catalog.refresh

      assert.deepStrictEqual(
        (yield* catalog.models).map((model) => model.id),
        ['claude-sonnet-4-5', 'deepseek-flash'],
      )

      const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, CachedCatalog)
      const cached = yield* store.get('model-catalog')

      assert.isTrue(Option.isSome(cached))
    }).pipe(Effect.provide(catalogWith(respondWith(modelsDev)))),
  )

  it.effect('keeps the current catalog when refresh fails', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog

      yield* catalog.refresh

      assert.deepStrictEqual(
        (yield* catalog.models).map((model) => model.id),
        ['gpt-snapshot'],
      )
    }).pipe(Effect.provide(catalogWith(unreachable))),
  )

  it.effect('serves a fresh cache instead of the snapshot', () =>
    Effect.gen(function* () {
      const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, CachedCatalog)
      const cachedModels = toLlmModels(modelsDev)

      yield* store.set('model-catalog', { fetchedAt: yield* DateTime.now, models: cachedModels })

      const catalog = yield* ModelCatalog.make({ snapshot })

      assert.strictEqual((yield* catalog.models).length, cachedModels.length)

      const found = yield* catalog.find('anthropic', 'claude-sonnet-4-5')

      assert.strictEqual(found?.name, 'Claude Sonnet 4.5')
    }).pipe(Effect.provide(Layer.merge(KeyValueStore.layerMemory, unreachable))),
  )
})
