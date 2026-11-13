import * as AnthropicClient from '@effect/ai-anthropic/AnthropicClient'
import * as AnthropicLanguageModel from '@effect/ai-anthropic/AnthropicLanguageModel'
import * as OpenAiClient from '@effect/ai-openai-compat/OpenAiClient'
import * as OpenAiLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel'
import { Clock, Context, type Duration, Effect, Layer, Schema } from 'effect'
import { LanguageModel, type Prompt } from 'effect/ai'
import { HttpClient } from 'effect/http'
import type { LlmModel, LlmSettingsError, ModelPrice, UsageFeature } from '#contract/Llm'
import { LlmStore, type PresetRuntime } from './LlmStore'
import { apiRoot } from './Providers'
import { type UsageRecord, UsageLog } from './UsageLog'

export interface UsagePurpose {
  readonly feature: UsageFeature
  readonly gameId?: string | undefined
}

export interface CompletionRequest extends UsagePurpose {
  readonly presetId: string
  readonly system?: string
  readonly history?: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly text: string }>
  readonly prompt: string
  readonly timeout?: Duration.Input
}

export interface Completion {
  readonly text: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly costUsd: number | undefined
}

export interface PresetDescription {
  readonly presetName: string
  readonly modelName: string
  readonly maxOutputTokens?: number
  readonly contextWindow?: number
  readonly price?: ModelPrice
}

export interface PresetModel {
  readonly modelName: string
  readonly layer: Layer.Layer<LanguageModel.LanguageModel>
  readonly spend: (
    usage: Completion['usage'],
    cachedTokens: number,
  ) => Effect.Effect<number | undefined>
}

export class LlmClientError extends Schema.TaggedError<LlmClientError>()('LlmClientError', {
  message: Schema.String,
}) {}

const anthropicEfforts = ['low', 'medium', 'high'] as const

type AnthropicEffort = (typeof anthropicEfforts)[number]

const isAnthropicEffort = (value: string): value is AnthropicEffort =>
  anthropicEfforts.some((effort) => effort === value)

const thinkingBudget = (model: LlmModel | undefined, maxOutputTokens: number) => {
  const budget = model?.reasoning?.budget
  const half = Math.floor(maxOutputTokens / 2)

  return Math.min(Math.max(budget?.min ?? 1024, half), budget?.max ?? Number.POSITIVE_INFINITY)
}

// Anthropic rejects temperature and top P alongside thinking or effort.
const anthropicConfig = ({ preset, model }: PresetRuntime) => {
  const base = { max_tokens: preset.maxOutputTokens }
  const sampling = { temperature: preset.temperature, top_p: preset.topP }

  if (preset.reasoning === 'thinking') {
    return {
      ...base,
      thinking: {
        type: 'enabled' as const,
        budget_tokens: thinkingBudget(model, preset.maxOutputTokens),
      },
    }
  }

  if (preset.reasoning === 'off') {
    return { ...base, ...sampling, thinking: { type: 'disabled' as const } }
  }

  if (preset.reasoning === 'default') {
    return { ...base, ...sampling }
  }

  const effort = isAnthropicEffort(preset.reasoning) ? preset.reasoning : 'high'

  return { ...base, output_config: { effort } }
}

const reasoningEffort = (reasoning: string) => {
  if (reasoning === 'default') {
    return {}
  }

  if (reasoning === 'off') {
    return { reasoning_effort: 'none' }
  }

  if (reasoning === 'thinking') {
    return { reasoning_effort: 'medium' }
  }

  return { reasoning_effort: reasoning }
}

const languageModelFor = (runtime: PresetRuntime) => {
  const { preset, connection, apiKey } = runtime

  if (connection.provider === 'anthropic') {
    return AnthropicLanguageModel.layer({
      model: preset.modelId,
      config: anthropicConfig(runtime),
    }).pipe(Layer.provide(AnthropicClient.layer({ apiKey })))
  }

  return OpenAiLanguageModel.layer({
    model: preset.modelId,
    config: {
      temperature: preset.temperature,
      top_p: preset.topP,
      max_output_tokens: preset.maxOutputTokens,
      ...reasoningEffort(preset.reasoning),
    },
  }).pipe(
    Layer.provide(
      OpenAiClient.layer({ apiKey, apiUrl: apiRoot(connection.provider, connection.apiUrl) }),
    ),
  )
}

const toPrompt = (request: CompletionRequest): Prompt.RawInput => [
  ...(request.system === undefined ? [] : [{ role: 'system' as const, content: request.system }]),
  ...(request.history ?? []).map((message) => ({ role: message.role, content: message.text })),
  { role: 'user' as const, content: request.prompt },
]

const costOf = (model: LlmModel | undefined, usage: Completion['usage'], cachedTokens: number) => {
  const price = model?.price

  if (price === undefined) {
    return undefined
  }

  const cacheRate = price.cacheRead ?? price.input
  const uncachedTokens = usage.inputTokens - cachedTokens

  return (
    (uncachedTokens * price.input + cachedTokens * cacheRate + usage.outputTokens * price.output) /
    1_000_000
  )
}

export class LlmClient extends Context.Service<
  LlmClient,
  {
    readonly complete: (
      request: CompletionRequest,
    ) => Effect.Effect<Completion, LlmClientError | LlmSettingsError>
    readonly describe: (presetId: string) => Effect.Effect<PresetDescription, LlmSettingsError>
    readonly model: (
      presetId: string,
      purpose: UsagePurpose,
    ) => Effect.Effect<PresetModel, LlmSettingsError>
  }
>()('wenbu/core/llm/LlmClient') {
  static readonly make = Effect.fn('LlmClient.make')(function* (options: {
    readonly presetRuntime: (presetId: string) => Effect.Effect<PresetRuntime, LlmSettingsError>
    readonly markVerified?: (connectionId: string) => Effect.Effect<void>
    readonly record?: (usage: UsageRecord) => Effect.Effect<void>
  }) {
    const http = yield* HttpClient.HttpClient

    const spend = Effect.fnUntraced(function* (
      runtime: PresetRuntime,
      purpose: UsagePurpose,
      usage: Completion['usage'],
      cachedTokens: number,
    ) {
      const costUsd = costOf(runtime.model, usage, cachedTokens)

      if (options.record !== undefined) {
        yield* options.record({
          feature: purpose.feature,
          gameId: purpose.gameId,
          presetId: runtime.preset.id,
          presetName: runtime.preset.name,
          modelId: runtime.preset.modelId,
          inputTokens: usage.inputTokens,
          cachedTokens,
          outputTokens: usage.outputTokens,
          costUsd,
        })
      }

      return costUsd
    })

    const complete = Effect.fn('LlmClient.complete')(function* (request: CompletionRequest) {
      const runtime = yield* options.presetRuntime(request.presetId)
      const modelName = runtime.model?.name ?? runtime.preset.modelId
      const timeout = request.timeout ?? '2 minutes'
      const startedAt = yield* Clock.currentTimeMillis

      const requestFields = {
        provider: runtime.connection.provider,
        model: runtime.preset.modelId,
      }

      const elapsed = Effect.map(Clock.currentTimeMillis, (now) => now - startedAt)

      const response = yield* LanguageModel.generateText({ prompt: toPrompt(request) }).pipe(
        Effect.provide(languageModelFor(runtime)),
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) => new LlmClientError({ message: error.message })),
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(new LlmClientError({ message: `${modelName} didn't answer in time.` })),
        }),
        Effect.tapError((error) =>
          Effect.flatMap(elapsed, (ms) =>
            Effect.logWarning('LLM request failed').pipe(
              Effect.annotateLogs({ ...requestFields, ms, error: error.message.slice(0, 300) }),
            ),
          ),
        ),
      )

      const text = response.text.trim()

      if (text === '') {
        return yield* new LlmClientError({
          message: `${modelName} returned no text. If it is a reasoning model, lower the reasoning level or raise the output limit.`,
        })
      }

      const usage = {
        inputTokens: response.usage.inputTokens.total ?? 0,
        outputTokens: response.usage.outputTokens.total ?? 0,
      }

      yield* Effect.logDebug('LLM request finished').pipe(
        Effect.annotateLogs({ ...requestFields, ms: yield* elapsed, ...usage }),
      )

      if (options.markVerified !== undefined) {
        yield* options.markVerified(runtime.connection.id)
      }

      return {
        text,
        usage,
        costUsd: yield* spend(runtime, request, usage, response.usage.inputTokens.cacheRead ?? 0),
      }
    })

    const describe = Effect.fn('LlmClient.describe')(function* (presetId: string) {
      const runtime = yield* options.presetRuntime(presetId)

      const { model } = runtime

      return {
        presetName: runtime.preset.name,
        modelName: model?.name ?? runtime.preset.modelId,
        maxOutputTokens: runtime.preset.maxOutputTokens,
        ...(model === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model?.price === undefined ? {} : { price: model.price }),
      } satisfies PresetDescription
    })

    const model = Effect.fn('LlmClient.model')(function* (presetId: string, purpose: UsagePurpose) {
      const runtime = yield* options.presetRuntime(presetId)

      return {
        modelName: runtime.model?.name ?? runtime.preset.modelId,
        layer: languageModelFor(runtime).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
        ),
        spend: (usage, cachedTokens) => spend(runtime, purpose, usage, cachedTokens),
      } satisfies PresetModel
    })

    return LlmClient.of({ complete, describe, model })
  })

  static readonly layer = Layer.effect(
    LlmClient,
    Effect.gen(function* () {
      const store = yield* LlmStore
      const usage = yield* UsageLog

      return yield* LlmClient.make({
        presetRuntime: store.presetRuntime,
        markVerified: store.markVerified,
        record: usage.record,
      })
    }),
  )
}
