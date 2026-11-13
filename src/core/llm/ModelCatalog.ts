import { Context, DateTime, Duration, Effect, Layer, Option, Ref, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { KeyValueStore } from 'effect/persistence'
import { LlmModel, type LlmProvider, type ModelPrice, type ModelReasoning } from '#contract/Llm'
import snapshotJson from './modelCatalogSnapshot.json' with { type: 'json' }

export const modelsDevUrl = 'https://models.dev/api.json'

const catalogProviders = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshotai',
] as const satisfies ReadonlyArray<LlmProvider>

const refreshAfter = Duration.days(1)

const cacheKey = 'model-catalog'

export const ModelsDev = Schema.Record(Schema.String, Schema.Unknown)

export type ModelsDev = typeof ModelsDev.Type

const ModelsDevProvider = Schema.Struct({ models: Schema.Record(Schema.String, Schema.Unknown) })

const ReasoningOption = Schema.Struct({
  type: Schema.String,
  values: Schema.optional(Schema.Array(Schema.String)),
  min: Schema.optional(Schema.Finite),
  max: Schema.optional(Schema.Finite),
})

const ModelsDevModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  reasoning: Schema.optional(Schema.Boolean),
  reasoning_options: Schema.optional(Schema.NullOr(Schema.Array(ReasoningOption))),
  modalities: Schema.Struct({
    input: Schema.Array(Schema.String),
    output: Schema.Array(Schema.String),
  }),
  limit: Schema.Struct({ context: Schema.Finite, output: Schema.Finite }),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.Finite),
      output: Schema.optional(Schema.Finite),
      cache_read: Schema.optional(Schema.Finite),
    }),
  ),
  status: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
})

type ModelsDevModel = typeof ModelsDevModel.Type

const decodeProvider = Schema.decodeUnknownOption(ModelsDevProvider)

const decodeModel = Schema.decodeUnknownOption(ModelsDevModel)

export const CachedCatalog = Schema.Struct({
  fetchedAt: Schema.DateTimeUtc,
  models: Schema.Array(LlmModel),
})

const toReasoning = (model: ModelsDevModel): ModelReasoning | undefined => {
  if (model.reasoning !== true) {
    return undefined
  }

  const options = model.reasoning_options ?? []
  const budget = options.find((option) => option.type === 'budget_tokens')

  const reasoning = {
    toggle: options.some((option) => option.type === 'toggle'),
    efforts: options.flatMap((option) => (option.type === 'effort' ? (option.values ?? []) : [])),
  }

  if (budget === undefined) {
    return reasoning
  }

  const min = Math.round(budget.min ?? 1024)

  return {
    ...reasoning,
    budget: budget.max === undefined ? { min } : { min, max: Math.round(budget.max) },
  }
}

const toPrice = (model: ModelsDevModel): ModelPrice | undefined => {
  const cost = model.cost

  if (cost?.input === undefined || cost.output === undefined) {
    return undefined
  }

  const price = { input: cost.input, output: cost.output }

  return cost.cache_read === undefined ? price : { ...price, cacheRead: cost.cache_read }
}

const mediaOutputs = new Set(['audio', 'video', 'image'])

const isChatModel = (model: ModelsDevModel) =>
  model.type === undefined &&
  model.status !== 'deprecated' &&
  model.modalities.output.includes('text') &&
  !model.modalities.output.some((output) => mediaOutputs.has(output))

const toLlmModel = (provider: LlmProvider, model: ModelsDevModel) => {
  const reasoning = toReasoning(model)
  const price = toPrice(model)

  return LlmModel.make({
    provider,
    id: model.id,
    name: model.name,
    contextWindow: Math.round(model.limit.context),
    maxOutputTokens: Math.round(model.limit.output),
    inputModalities: model.modalities.input,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(price === undefined ? {} : { price }),
  })
}

export const toLlmModels = (catalog: ModelsDev): ReadonlyArray<LlmModel> =>
  catalogProviders.flatMap((provider) =>
    Option.match(decodeProvider(catalog[provider]), {
      onNone: () => [],
      onSome: ({ models }) =>
        Object.values(models).flatMap((entry) =>
          Option.match(decodeModel(entry), {
            onNone: () => [],
            onSome: (model) => (isChatModel(model) ? [toLlmModel(provider, model)] : []),
          }),
        ),
    }),
  )

export class ModelCatalog extends Context.Service<
  ModelCatalog,
  {
    readonly models: Effect.Effect<ReadonlyArray<LlmModel>>
    readonly find: (provider: LlmProvider, modelId: string) => Effect.Effect<LlmModel | undefined>
    readonly refresh: Effect.Effect<void>
  }
>()('wenbu/core/llm/ModelCatalog') {
  static readonly make = Effect.fn('ModelCatalog.make')(function* (options: {
    readonly snapshot: ReadonlyArray<LlmModel>
  }) {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    // oxlint-disable-next-line wenbu/no-schema-store -- a cache: a reset only downloads the catalog again.
    const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, CachedCatalog)
    const cached = yield* store.get(cacheKey).pipe(Effect.orElseSucceed(() => Option.none()))

    const current = yield* Ref.make(
      Option.match(cached, { onNone: () => options.snapshot, onSome: (entry) => entry.models }),
    )

    const refresh = Effect.gen(function* () {
      const response = yield* http.get(modelsDevUrl)
      const catalog = yield* HttpClientResponse.schemaBodyJson(ModelsDev)(response)
      const models = toLlmModels(catalog)

      yield* store.set(cacheKey, { fetchedAt: yield* DateTime.now, models })
      yield* Ref.set(current, models)
    }).pipe(
      Effect.timeout('30 seconds'),
      Effect.catchCause((cause) => Effect.logWarning('Could not refresh the model catalog', cause)),
      Effect.withSpan('ModelCatalog.refresh'),
    )

    const now = yield* DateTime.now

    const isFresh = Option.match(cached, {
      onNone: () => false,
      onSome: (entry) =>
        DateTime.toEpochMillis(now) - DateTime.toEpochMillis(entry.fetchedAt) <
        Duration.toMillis(refreshAfter),
    })

    if (!isFresh) {
      yield* Effect.forkScoped(refresh)
    }

    return ModelCatalog.of({
      models: Ref.get(current),
      find: (provider, modelId) =>
        Effect.map(Ref.get(current), (models) =>
          models.find((model) => model.provider === provider && model.id === modelId),
        ),
      refresh,
    })
  })

  static readonly layer = Layer.effect(
    ModelCatalog,
    Effect.gen(function* () {
      const snapshot = yield* Effect.orDie(
        Schema.decodeUnknownEffect(Schema.Array(LlmModel))(snapshotJson),
      )

      return yield* ModelCatalog.make({ snapshot })
    }),
  )
}
