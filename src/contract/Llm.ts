import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const LlmProvider = Schema.Literals([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshotai',
  'custom-openai-compatible',
])

export type LlmProvider = typeof LlmProvider.Type

export const providerLabels: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  'custom-openai-compatible': 'OpenAI-compatible',
}

export const Verification = Schema.Literals(['verified', 'inconclusive', 'failed'])

export type Verification = typeof Verification.Type

export const KeyProtection = Schema.Literals(['os', 'reduced'])

export type KeyProtection = typeof KeyProtection.Type

export class LlmConnection extends Schema.Class<LlmConnection>('LlmConnection')({
  id: Schema.String,
  name: Schema.String,
  provider: LlmProvider,
  apiUrl: Schema.optional(Schema.String),
  verification: Verification,
  verificationMessage: Schema.optional(Schema.String),
  verifiedAt: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export class LlmPreset extends Schema.Class<LlmPreset>('LlmPreset')({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  connectionId: Schema.String,
  modelId: Schema.String,
  temperature: Schema.Finite,
  topP: Schema.Finite,
  maxOutputTokens: Schema.Int,
  reasoning: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export const ModelReasoning = Schema.Struct({
  toggle: Schema.Boolean,
  efforts: Schema.Array(Schema.String),
  budget: Schema.optional(Schema.Struct({ min: Schema.Int, max: Schema.optional(Schema.Int) })),
})

export type ModelReasoning = typeof ModelReasoning.Type

export const ModelPrice = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cacheRead: Schema.optional(Schema.Finite),
})

export type ModelPrice = typeof ModelPrice.Type

export const UsageFeature = Schema.Literals([
  'rpg-translation',
  'line-review',
  'overlay',
  'subtitles',
  'game-guide',
  'manga',
  'manga-editor',
  'detections',
  'in-game-text',
  'details',
  'novels',
])

export type UsageFeature = typeof UsageFeature.Type

export class LlmModel extends Schema.Class<LlmModel>('LlmModel')({
  provider: LlmProvider,
  id: Schema.String,
  name: Schema.String,
  contextWindow: Schema.Int,
  maxOutputTokens: Schema.Int,
  inputModalities: Schema.Array(Schema.String),
  reasoning: Schema.optional(ModelReasoning),
  price: Schema.optional(ModelPrice),
}) {}

export const defaultReasoning = 'default'

const customModelReasoning = [defaultReasoning, 'off', 'low', 'medium', 'high']

export const reasoningChoices = (model: LlmModel | undefined): ReadonlyArray<string> => {
  if (model === undefined) {
    return customModelReasoning
  }

  if (model.reasoning === undefined) {
    return [defaultReasoning]
  }

  const { toggle, efforts, budget } = model.reasoning

  return [
    defaultReasoning,
    ...(toggle ? ['off'] : []),
    ...efforts,
    ...(budget === undefined ? [] : ['thinking']),
  ]
}

export class LlmSettings extends Schema.Class<LlmSettings>('LlmSettings')({
  connections: Schema.Array(LlmConnection),
  presets: Schema.Array(LlmPreset),
  keyProtection: KeyProtection,
}) {}

export const ConnectionDraft = Schema.Struct({
  name: Schema.String,
  provider: LlmProvider,
  apiUrl: Schema.optional(Schema.String),
})

export const CreateConnection = Schema.Struct({
  ...ConnectionDraft.fields,
  apiKey: Schema.String,
})

export type CreateConnection = typeof CreateConnection.Type

export const UpdateConnection = Schema.Struct({
  ...ConnectionDraft.fields,
  id: Schema.String,
  apiKey: Schema.optional(Schema.String),
})

export type UpdateConnection = typeof UpdateConnection.Type

export const PresetDraft = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  connectionId: Schema.String,
  modelId: Schema.String,
  temperature: Schema.Finite,
  topP: Schema.Finite,
  maxOutputTokens: Schema.Int,
  reasoning: Schema.String,
})

export type PresetDraft = typeof PresetDraft.Type

export const UpdatePreset = Schema.Struct({
  ...PresetDraft.fields,
  id: Schema.String,
})

export type UpdatePreset = typeof UpdatePreset.Type

export class LlmSettingsError extends Schema.TaggedError<LlmSettingsError>()('LlmSettingsError', {
  reason: Schema.Literals(['invalid', 'not-found', 'conflict', 'rejected']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

const ById = { id: Schema.String }

export const DeletionImpact = Schema.Struct({
  presets: Schema.Array(Schema.String),
  areas: Schema.Array(Schema.String),
})

export type DeletionImpact = typeof DeletionImpact.Type

export class LlmRpc extends RpcGroup.make(
  Rpc.make('getLlmSettings', { success: LlmSettings }),
  Rpc.make('getModelCatalog', { success: Schema.Array(LlmModel) }),
  Rpc.make('createConnection', {
    payload: CreateConnection,
    success: LlmConnection,
    error: LlmSettingsError,
  }),
  Rpc.make('updateConnection', {
    payload: UpdateConnection,
    success: LlmConnection,
    error: LlmSettingsError,
  }),
  Rpc.make('deleteConnection', { payload: ById, error: LlmSettingsError }),
  Rpc.make('verifyConnection', { payload: ById, success: LlmConnection, error: LlmSettingsError }),
  Rpc.make('createPreset', { payload: PresetDraft, success: LlmPreset, error: LlmSettingsError }),
  Rpc.make('updatePreset', { payload: UpdatePreset, success: LlmPreset, error: LlmSettingsError }),
  Rpc.make('deletePreset', { payload: ById, error: LlmSettingsError }),
  Rpc.make('describeDeletion', {
    payload: { kind: Schema.Literals(['connection', 'preset']), id: Schema.String },
    success: DeletionImpact,
    error: LlmSettingsError,
  }),
) {}
