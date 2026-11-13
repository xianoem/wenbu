import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted, Ref } from 'effect'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import {
  type CreateConnection,
  LlmModel,
  LlmRpc,
  LlmSettingsError,
  type PresetDraft,
} from '#contract/Llm'
import * as Database from '../platform/Database'
import { ConnectionVerifier } from './ConnectionVerifier'
import { Credentials } from './Credentials'
import { LlmRpcLive, LlmStore } from './LlmStore'
import { ModelCatalog } from './ModelCatalog'
import { PresetReferences } from './PresetReferences'

const claude = LlmModel.make({
  provider: 'anthropic',
  id: 'claude-sonnet-5',
  name: 'Claude Sonnet 5',
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  inputModalities: ['text'],
  reasoning: { toggle: true, efforts: ['low', 'high'] },
  price: { input: 3, output: 15 },
})

const revokedKeys = new Set(['sk-bad'])

const VerifierFake = Layer.succeed(ConnectionVerifier)({
  verify: ({ apiKey }) => {
    if (revokedKeys.has(Redacted.value(apiKey))) {
      return Effect.fail(
        new LlmSettingsError({
          reason: 'rejected',
          message: 'The provider rejected the API key.',
          field: 'apiKey',
        }),
      )
    }

    return Effect.succeed({ verification: 'verified' })
  },
})

const CatalogFake = Layer.succeed(ModelCatalog)({
  models: Effect.succeed([claude]),
  find: (provider, modelId) =>
    Effect.succeed(provider === claude.provider && modelId === claude.id ? claude : undefined),
  refresh: Effect.void,
})

const CredentialsTest = Layer.effect(
  Credentials,
  Credentials.make({
    key: Redacted.make('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
    protection: 'os',
  }),
)

const TestLayer = LlmRpcLive.pipe(
  Layer.provideMerge(LlmStore.layer),
  Layer.provideMerge(PresetReferences.layer),
  Layer.provideMerge(Database.layer(':memory:')),
  Layer.provide([VerifierFake, CatalogFake, CredentialsTest, NodeServices.layer]),
)

const anthropicConnection: CreateConnection = {
  name: 'Anthropic',
  provider: 'anthropic',
  apiKey: 'sk-good',
}

const presetFor = (connectionId: string, overrides: Partial<PresetDraft> = {}): PresetDraft => ({
  name: 'Game dialogue',
  connectionId,
  modelId: claude.id,
  temperature: 0.7,
  topP: 1,
  maxOutputTokens: 4096,
  reasoning: 'high',
  ...overrides,
})

const client = RpcTest.makeClient(LlmRpc)

const chooseIn = Effect.fnUntraced(function* (area: string, presetId: string) {
  const references = yield* PresetReferences
  const chosen = yield* Ref.make(presetId)

  yield* references.register({
    area,
    uses: (ids) => Effect.map(Ref.get(chosen), (id) => ids.has(id)),
    clear: (ids) => Ref.update(chosen, (id) => (ids.has(id) ? '' : id)),
  })

  return chosen
})

describe('LlmStore connections', () => {
  it.effect('creates a verified connection without exposing its key', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const created = yield* llm.createConnection(anthropicConnection)
      const settings = yield* llm.getLlmSettings()

      assert.strictEqual(created.verification, 'verified')

      assert.deepStrictEqual(
        settings.connections.map((connection) => connection.name),
        ['Anthropic'],
      )

      assert.notProperty(settings.connections[0], 'apiKey')
      assert.strictEqual(settings.keyProtection, 'os')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('stores the API key encrypted', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const sql = yield* SqlClient.SqlClient

      yield* llm.createConnection(anthropicConnection)

      const [row] = yield* sql<{ readonly api_key: string }>`SELECT api_key FROM llm_connections`

      assert.notInclude(row?.api_key ?? '', 'sk-good')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('refuses a key the provider rejects', () =>
    Effect.gen(function* () {
      const llm = yield* client

      const error = yield* Effect.flip(
        llm.createConnection({ ...anthropicConnection, apiKey: 'sk-bad' }),
      )

      assert.strictEqual(error.reason, 'rejected')
      assert.strictEqual(error.field, 'apiKey')
      assert.lengthOf((yield* llm.getLlmSettings()).connections, 0)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('requires an API URL for custom endpoints', () =>
    Effect.gen(function* () {
      const llm = yield* client

      const error = yield* Effect.flip(
        llm.createConnection({
          name: 'Local',
          provider: 'custom-openai-compatible',
          apiKey: 'sk-good',
        }),
      )

      assert.strictEqual(error.field, 'apiUrl')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('rejects a duplicate name regardless of case', () =>
    Effect.gen(function* () {
      const llm = yield* client

      yield* llm.createConnection(anthropicConnection)

      const error = yield* Effect.flip(
        llm.createConnection({ ...anthropicConnection, name: ' anthropic ' }),
      )

      assert.strictEqual(error.reason, 'conflict')
      assert.strictEqual(error.field, 'name')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('verifies a replaced key and keeps the old one when it is rejected', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const store = yield* LlmStore
      const created = yield* llm.createConnection(anthropicConnection)
      const preset = yield* llm.createPreset(presetFor(created.id))

      const error = yield* Effect.flip(
        llm.updateConnection({ ...anthropicConnection, id: created.id, apiKey: 'sk-bad' }),
      )

      assert.strictEqual(error.reason, 'rejected')

      const runtime = yield* store.presetRuntime(preset.id)

      assert.strictEqual(Redacted.value(runtime.apiKey), 'sk-good')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('keeps the provider while presets use the connection', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const created = yield* llm.createConnection(anthropicConnection)

      yield* llm.createPreset(presetFor(created.id))

      const error = yield* Effect.flip(
        llm.updateConnection({ ...anthropicConnection, id: created.id, provider: 'openai' }),
      )

      assert.strictEqual(error.reason, 'conflict')
      assert.strictEqual(error.field, 'provider')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('records a key the provider has since revoked as failed', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const created = yield* llm.createConnection({ ...anthropicConnection, apiKey: 'sk-revoked' })

      revokedKeys.add('sk-revoked')

      const verified = yield* llm.verifyConnection({ id: created.id })

      assert.strictEqual(verified.verification, 'failed')
      assert.strictEqual(verified.verificationMessage, 'The provider rejected the API key.')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('deletes a connection with its presets, clearing where they were chosen', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const created = yield* llm.createConnection(anthropicConnection)
      const preset = yield* llm.createPreset(presetFor(created.id))
      const chosen = yield* chooseIn('Detections', preset.id)

      const impact = yield* llm.describeDeletion({ kind: 'connection', id: created.id })

      yield* llm.deleteConnection({ id: created.id })

      const settings = yield* llm.getLlmSettings()

      assert.deepStrictEqual(impact, { presets: ['Game dialogue'], areas: ['Detections'] })
      assert.lengthOf(settings.connections, 0)
      assert.lengthOf(settings.presets, 0)
      assert.strictEqual(yield* Ref.get(chosen), '')
    }).pipe(Effect.provide(TestLayer)),
  )
})

describe('LlmStore presets', () => {
  it.effect('creates a preset with a reasoning level the model supports', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const connection = yield* llm.createConnection(anthropicConnection)
      const preset = yield* llm.createPreset(presetFor(connection.id))

      assert.strictEqual(preset.reasoning, 'high')
      assert.lengthOf((yield* llm.getLlmSettings()).presets, 1)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('rejects a reasoning level the model does not offer', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const connection = yield* llm.createConnection(anthropicConnection)

      const error = yield* Effect.flip(
        llm.createPreset(presetFor(connection.id, { reasoning: 'max' })),
      )

      assert.strictEqual(error.field, 'reasoning')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('rejects more output tokens than the model allows', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const connection = yield* llm.createConnection(anthropicConnection)

      const error = yield* Effect.flip(
        llm.createPreset(presetFor(connection.id, { maxOutputTokens: 100_000 })),
      )

      assert.strictEqual(error.field, 'maxOutputTokens')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('accepts a model that is not in the catalog', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const connection = yield* llm.createConnection(anthropicConnection)

      const preset = yield* llm.createPreset(
        presetFor(connection.id, { modelId: 'claude-next-preview', reasoning: 'medium' }),
      )

      assert.strictEqual(preset.modelId, 'claude-next-preview')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('deletes a preset and clears it only where it was chosen', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const created = yield* llm.createConnection(anthropicConnection)
      const deleted = yield* llm.createPreset(presetFor(created.id))
      const kept = yield* llm.createPreset(presetFor(created.id, { name: 'Menus' }))
      const games = yield* chooseIn('Game translation', deleted.id)
      const detections = yield* chooseIn('Detections', kept.id)

      const impact = yield* llm.describeDeletion({ kind: 'preset', id: deleted.id })

      yield* llm.deletePreset({ id: deleted.id })

      assert.deepStrictEqual(impact, { presets: ['Game dialogue'], areas: ['Game translation'] })

      assert.deepStrictEqual(
        (yield* llm.getLlmSettings()).presets.map((preset) => preset.name),
        ['Menus'],
      )

      assert.strictEqual(yield* Ref.get(games), '')
      assert.strictEqual(yield* Ref.get(detections), kept.id)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('updates a preset', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const connection = yield* llm.createConnection(anthropicConnection)
      const preset = yield* llm.createPreset(presetFor(connection.id))

      const updated = yield* llm.updatePreset({
        ...presetFor(connection.id, { name: 'Overlay', temperature: 0.2 }),
        id: preset.id,
      })

      assert.strictEqual(updated.name, 'Overlay')
      assert.strictEqual(updated.temperature, 0.2)
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('gives callers the decrypted key and model for a preset', () =>
    Effect.gen(function* () {
      const llm = yield* client
      const store = yield* LlmStore
      const connection = yield* llm.createConnection(anthropicConnection)
      const preset = yield* llm.createPreset(presetFor(connection.id))
      const runtime = yield* store.presetRuntime(preset.id)

      assert.strictEqual(Redacted.value(runtime.apiKey), 'sk-good')
      assert.strictEqual(runtime.model?.id, claude.id)
      assert.strictEqual(runtime.connection.provider, 'anthropic')
    }).pipe(Effect.provide(TestLayer)),
  )
})
