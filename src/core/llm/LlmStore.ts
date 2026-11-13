import { Context, Crypto, DateTime, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  type DeletionImpact,
  type CreateConnection,
  LlmConnection,
  type LlmModel,
  LlmPreset,
  LlmProvider,
  LlmRpc,
  LlmSettings,
  LlmSettingsError,
  type PresetDraft,
  reasoningChoices,
  type UpdateConnection,
  type UpdatePreset,
  Verification,
} from '#contract/Llm'
import { ConnectionVerifier } from './ConnectionVerifier'
import { Credentials } from './Credentials'
import { ModelCatalog } from './ModelCatalog'
import { PresetReferences } from './PresetReferences'

export interface PresetRuntime {
  readonly preset: LlmPreset
  readonly connection: LlmConnection
  readonly apiKey: Redacted.Redacted<string>
  readonly model: LlmModel | undefined
}

const ConnectionRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  provider: LlmProvider,
  api_url: Schema.NullOr(Schema.String),
  api_key: Schema.String,
  verification: Verification,
  verification_message: Schema.NullOr(Schema.String),
  verified_at: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
})

type ConnectionRow = typeof ConnectionRow.Type

const PresetRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  connection_id: Schema.String,
  model_id: Schema.String,
  temperature: Schema.Finite,
  top_p: Schema.Finite,
  max_output_tokens: Schema.Int,
  reasoning: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
})

type PresetRow = typeof PresetRow.Type

const IdRow = Schema.Struct({ id: Schema.String })

const CountRow = Schema.Struct({ count: Schema.Int })

const toConnection = (row: ConnectionRow) =>
  LlmConnection.make({
    id: row.id,
    name: row.name,
    provider: row.provider,
    verification: row.verification,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.api_url === null ? {} : { apiUrl: row.api_url }),
    ...(row.verification_message === null ? {} : { verificationMessage: row.verification_message }),
    ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
  })

const toPreset = (row: PresetRow) =>
  LlmPreset.make({
    id: row.id,
    name: row.name,
    connectionId: row.connection_id,
    modelId: row.model_id,
    temperature: row.temperature,
    topP: row.top_p,
    maxOutputTokens: row.max_output_tokens,
    reasoning: row.reasoning,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.description === null ? {} : { description: row.description }),
  })

const invalid = (field: string, message: string) =>
  new LlmSettingsError({ reason: 'invalid', field, message })

const notFound = (message: string) => new LlmSettingsError({ reason: 'not-found', message })

const nameKey = (name: string) => name.toLocaleLowerCase()

const requireName = (name: string) => {
  const trimmed = name.trim()

  return trimmed === '' ? Effect.fail(invalid('name', 'Enter a name.')) : Effect.succeed(trimmed)
}

const connectionUrl = (provider: LlmProvider, apiUrl: string | undefined) => {
  if (provider !== 'custom-openai-compatible') {
    return Effect.succeed(undefined)
  }

  const trimmed = apiUrl?.trim() ?? ''

  if (trimmed === '') {
    return Effect.fail(invalid('apiUrl', 'Enter the API URL.'))
  }

  if (!URL.canParse(trimmed)) {
    return Effect.fail(invalid('apiUrl', 'Enter a full URL, like http://localhost:1234/v1.'))
  }

  return Effect.succeed(trimmed)
}

const verificationColumns = (
  result: { readonly verification: Verification; readonly message?: string },
  timestamp: string,
) => ({
  verification: result.verification,
  verification_message: result.message ?? null,
  verified_at: result.verification === 'verified' ? timestamp : null,
})

const orDie =
  <I, A, E, R>(query: (input: I) => Effect.Effect<A, E, R>) =>
  (input: I) =>
    Effect.orDie(query(input))

export class LlmStore extends Context.Service<
  LlmStore,
  {
    readonly settings: Effect.Effect<LlmSettings>
    readonly createConnection: (
      input: CreateConnection,
    ) => Effect.Effect<LlmConnection, LlmSettingsError>
    readonly updateConnection: (
      input: UpdateConnection,
    ) => Effect.Effect<LlmConnection, LlmSettingsError>
    readonly deleteConnection: (id: string) => Effect.Effect<void, LlmSettingsError>
    readonly verifyConnection: (id: string) => Effect.Effect<LlmConnection, LlmSettingsError>
    readonly markVerified: (id: string) => Effect.Effect<void>
    readonly createPreset: (input: PresetDraft) => Effect.Effect<LlmPreset, LlmSettingsError>
    readonly updatePreset: (input: UpdatePreset) => Effect.Effect<LlmPreset, LlmSettingsError>
    readonly deletePreset: (id: string) => Effect.Effect<void, LlmSettingsError>
    readonly describeDeletion: (
      kind: 'connection' | 'preset',
      id: string,
    ) => Effect.Effect<DeletionImpact, LlmSettingsError>
    readonly presetRuntime: (presetId: string) => Effect.Effect<PresetRuntime, LlmSettingsError>
  }
>()('wenbu/core/llm/LlmStore') {
  static readonly layer = Layer.effect(
    LlmStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const references = yield* PresetReferences
      const credentials = yield* Credentials
      const verifier = yield* ConnectionVerifier
      const catalog = yield* ModelCatalog
      const crypto = yield* Crypto.Crypto

      const newId = Effect.orDie(crypto.randomUUIDv7())

      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const allConnections = orDie(
        SqlSchema.findAll({
          Request: Schema.Void,
          Result: ConnectionRow,
          execute: () => sql`SELECT * FROM llm_connections ORDER BY created_at, id`,
        }),
      )

      const findConnection = orDie(
        SqlSchema.findOneOption({
          Request: Schema.String,
          Result: ConnectionRow,
          execute: (id) => sql`SELECT * FROM llm_connections WHERE id = ${id}`,
        }),
      )

      const findConnectionNamed = orDie(
        SqlSchema.findOneOption({
          Request: Schema.String,
          Result: IdRow,
          execute: (key) => sql`SELECT id FROM llm_connections WHERE name_key = ${key}`,
        }),
      )

      const allPresets = orDie(
        SqlSchema.findAll({
          Request: Schema.Void,
          Result: PresetRow,
          execute: () => sql`SELECT * FROM llm_presets ORDER BY created_at, id`,
        }),
      )

      const findPreset = orDie(
        SqlSchema.findOneOption({
          Request: Schema.String,
          Result: PresetRow,
          execute: (id) => sql`SELECT * FROM llm_presets WHERE id = ${id}`,
        }),
      )

      const findPresetNamed = orDie(
        SqlSchema.findOneOption({
          Request: Schema.String,
          Result: IdRow,
          execute: (key) => sql`SELECT id FROM llm_presets WHERE name_key = ${key}`,
        }),
      )

      const countPresetsUsing = orDie(
        SqlSchema.findOne({
          Request: Schema.String,
          Result: CountRow,
          execute: (id) =>
            sql`SELECT COUNT(*) AS count FROM llm_presets WHERE connection_id = ${id}`,
        }),
      )

      const getConnectionRow = Effect.fn('LlmStore.getConnectionRow')(function* (id: string) {
        const row = yield* findConnection(id)

        if (Option.isNone(row)) {
          return yield* notFound('This connection no longer exists.')
        }

        return row.value
      })

      const getPresetRow = Effect.fn('LlmStore.getPresetRow')(function* (id: string) {
        const row = yield* findPreset(id)

        if (Option.isNone(row)) {
          return yield* notFound('This preset no longer exists.')
        }

        return row.value
      })

      const ensureUniqueName = Effect.fn('LlmStore.ensureUniqueName')(function* (
        existing: Option.Option<typeof IdRow.Type>,
        id: string | undefined,
        message: string,
      ) {
        if (Option.isSome(existing) && existing.value.id !== id) {
          return yield* new LlmSettingsError({ reason: 'conflict', field: 'name', message })
        }
      })

      const openKey = (row: ConnectionRow) =>
        credentials
          .open(row.api_key)
          .pipe(
            Effect.mapError(() =>
              invalid('apiKey', "The saved API key can't be read on this device. Enter it again."),
            ),
          )

      const settings = Effect.gen(function* () {
        const connections = yield* allConnections()
        const presets = yield* allPresets()

        return LlmSettings.make({
          connections: connections.map(toConnection),
          presets: presets.map(toPreset),
          keyProtection: credentials.protection,
        })
      }).pipe(Effect.orDie, Effect.withSpan('LlmStore.settings'))

      const createConnection = Effect.fn('LlmStore.createConnection')(function* (
        input: CreateConnection,
      ) {
        const name = yield* requireName(input.name)

        yield* ensureUniqueName(
          yield* findConnectionNamed(nameKey(name)),
          undefined,
          `A connection named “${name}” already exists.`,
        )

        const apiUrl = yield* connectionUrl(input.provider, input.apiUrl)
        const apiKeyText = input.apiKey.trim()

        if (apiKeyText === '') {
          return yield* invalid('apiKey', 'Enter the API key.')
        }

        const apiKey = Redacted.make(apiKeyText)
        const result = yield* verifier.verify({ provider: input.provider, apiUrl, apiKey })
        const id = yield* newId
        const timestamp = yield* now

        yield* Effect.orDie(
          sql`INSERT INTO llm_connections ${sql.insert({
            id,
            name,
            name_key: nameKey(name),
            provider: input.provider,
            api_url: apiUrl ?? null,
            api_key: yield* credentials.seal(apiKey),
            ...verificationColumns(result, timestamp),
            created_at: timestamp,
            updated_at: timestamp,
          })}`,
        )

        return toConnection(yield* getConnectionRow(id))
      })

      const updateConnection = Effect.fn('LlmStore.updateConnection')(function* (
        input: UpdateConnection,
      ) {
        const existing = yield* getConnectionRow(input.id)
        const name = yield* requireName(input.name)

        yield* ensureUniqueName(
          yield* findConnectionNamed(nameKey(name)),
          input.id,
          `A connection named “${name}” already exists.`,
        )

        const apiUrl = yield* connectionUrl(input.provider, input.apiUrl)
        const providerChanged = input.provider !== existing.provider

        if (providerChanged && (yield* countPresetsUsing(input.id)).count > 0) {
          return yield* new LlmSettingsError({
            reason: 'conflict',
            field: 'provider',
            message:
              'Presets use this connection. Change or delete them before switching provider.',
          })
        }

        const newKeyText = input.apiKey?.trim() ?? ''
        const newKey = newKeyText === '' ? undefined : Redacted.make(newKeyText)
        const urlChanged = (apiUrl ?? null) !== existing.api_url
        const timestamp = yield* now

        const verification =
          newKey === undefined && !providerChanged && !urlChanged
            ? {}
            : verificationColumns(
                yield* verifier.verify({
                  provider: input.provider,
                  apiUrl,
                  apiKey: newKey ?? (yield* openKey(existing)),
                }),
                timestamp,
              )

        yield* Effect.orDie(
          sql`UPDATE llm_connections SET ${sql.update({
            name,
            name_key: nameKey(name),
            provider: input.provider,
            api_url: apiUrl ?? null,
            api_key: newKey === undefined ? existing.api_key : yield* credentials.seal(newKey),
            ...verification,
            updated_at: timestamp,
          })} WHERE id = ${input.id}`,
        )

        return toConnection(yield* getConnectionRow(input.id))
      })

      const presetsOf = (connectionId: string) =>
        Effect.orDie(
          sql<{
            readonly id: string
            readonly name: string
          }>`SELECT id, name FROM llm_presets WHERE connection_id = ${connectionId} ORDER BY name`,
        )

      const deleteConnection = Effect.fn('LlmStore.deleteConnection')(function* (id: string) {
        yield* getConnectionRow(id)

        const presets = yield* presetsOf(id)

        yield* Effect.orDie(
          sql.withTransaction(
            Effect.andThen(
              sql`DELETE FROM llm_presets WHERE connection_id = ${id}`,
              sql`DELETE FROM llm_connections WHERE id = ${id}`,
            ),
          ),
        )

        yield* references.clear(new Set(presets.map((preset) => preset.id)))
      })

      const verifyConnection = Effect.fn('LlmStore.verifyConnection')(function* (id: string) {
        const existing = yield* getConnectionRow(id)

        const result = yield* verifier
          .verify({
            provider: existing.provider,
            apiUrl: existing.api_url ?? undefined,
            apiKey: yield* openKey(existing),
          })
          .pipe(
            Effect.catchTag('LlmSettingsError', (error) =>
              error.reason === 'rejected'
                ? Effect.succeed({
                    verification: 'failed' as const,
                    message: error.message,
                  })
                : Effect.fail(error),
            ),
          )

        const timestamp = yield* now

        yield* Effect.orDie(
          sql`UPDATE llm_connections SET ${sql.update({
            ...verificationColumns(result, timestamp),
            updated_at: timestamp,
          })} WHERE id = ${id}`,
        )

        return toConnection(yield* getConnectionRow(id))
      })

      const markVerified = Effect.fn('LlmStore.markVerified')(function* (id: string) {
        const timestamp = yield* now

        yield* Effect.orDie(
          sql`UPDATE llm_connections SET ${sql.update({
            verification: 'verified',
            verification_message: null,
            verified_at: timestamp,
          })} WHERE id = ${id} AND verification <> 'verified'`,
        )
      }, Effect.orDie)

      const validatePreset = Effect.fn('LlmStore.validatePreset')(function* (
        draft: PresetDraft,
        id: string | undefined,
      ) {
        const name = yield* requireName(draft.name)

        yield* ensureUniqueName(
          yield* findPresetNamed(nameKey(name)),
          id,
          `A preset named “${name}” already exists.`,
        )

        const connection = yield* findConnection(draft.connectionId)

        if (Option.isNone(connection)) {
          return yield* invalid('connectionId', 'Choose a connection.')
        }

        const modelId = draft.modelId.trim()

        if (modelId === '') {
          return yield* invalid('modelId', 'Choose or enter a model.')
        }

        const model = yield* catalog.find(connection.value.provider, modelId)

        if (draft.temperature < 0 || draft.temperature > 2) {
          return yield* invalid('temperature', 'Use a temperature between 0 and 2.')
        }

        if (draft.topP <= 0 || draft.topP > 1) {
          return yield* invalid('topP', 'Use a top P above 0 and at most 1.')
        }

        if (draft.maxOutputTokens < 1) {
          return yield* invalid('maxOutputTokens', 'Allow at least 1 output token.')
        }

        if (model !== undefined && draft.maxOutputTokens > model.maxOutputTokens) {
          return yield* invalid(
            'maxOutputTokens',
            `${model.name} writes at most ${model.maxOutputTokens.toLocaleString('en-US')} tokens.`,
          )
        }

        if (!reasoningChoices(model).includes(draft.reasoning)) {
          return yield* invalid('reasoning', 'Choose a reasoning level this model supports.')
        }

        const description = draft.description?.trim() ?? ''

        return {
          name,
          name_key: nameKey(name),
          description: description === '' ? null : description,
          connection_id: connection.value.id,
          model_id: modelId,
          temperature: draft.temperature,
          top_p: draft.topP,
          max_output_tokens: draft.maxOutputTokens,
          reasoning: draft.reasoning,
        }
      })

      const createPreset = Effect.fn('LlmStore.createPreset')(function* (input: PresetDraft) {
        const columns = yield* validatePreset(input, undefined)
        const id = yield* newId
        const timestamp = yield* now

        yield* Effect.orDie(
          sql`INSERT INTO llm_presets ${sql.insert({
            id,
            ...columns,
            created_at: timestamp,
            updated_at: timestamp,
          })}`,
        )

        return toPreset(yield* getPresetRow(id))
      })

      const updatePreset = Effect.fn('LlmStore.updatePreset')(function* (input: UpdatePreset) {
        yield* getPresetRow(input.id)

        const columns = yield* validatePreset(input, input.id)

        yield* Effect.orDie(
          sql`UPDATE llm_presets SET ${sql.update({
            ...columns,
            updated_at: yield* now,
          })} WHERE id = ${input.id}`,
        )

        return toPreset(yield* getPresetRow(input.id))
      })

      const deletePreset = Effect.fn('LlmStore.deletePreset')(function* (id: string) {
        yield* getPresetRow(id)
        yield* Effect.orDie(sql`DELETE FROM llm_presets WHERE id = ${id}`)
        yield* references.clear(new Set([id]))
      })

      const describeDeletion = Effect.fn('LlmStore.describeDeletion')(function* (
        kind: 'connection' | 'preset',
        id: string,
      ) {
        const presets =
          kind === 'connection'
            ? yield* Effect.andThen(getConnectionRow(id), presetsOf(id))
            : [yield* getPresetRow(id)]

        return {
          presets: presets.map((preset) => preset.name),
          areas: yield* references.areasUsing(new Set(presets.map((preset) => preset.id))),
        }
      })

      const presetRuntime = Effect.fn('LlmStore.presetRuntime')(function* (presetId: string) {
        const preset = yield* getPresetRow(presetId)
        const connection = yield* getConnectionRow(preset.connection_id)

        return {
          preset: toPreset(preset),
          connection: toConnection(connection),
          apiKey: yield* openKey(connection),
          model: yield* catalog.find(connection.provider, preset.model_id),
        }
      })

      return LlmStore.of({
        settings,
        createConnection,
        updateConnection,
        deleteConnection,
        verifyConnection,
        markVerified,
        createPreset,
        updatePreset,
        deletePreset,
        describeDeletion,
        presetRuntime,
      })
    }),
  )
}

export const LlmRpcLive = LlmRpc.toLayer(
  Effect.gen(function* () {
    const store = yield* LlmStore
    const catalog = yield* ModelCatalog

    return LlmRpc.of({
      getLlmSettings: () => store.settings,
      getModelCatalog: () => catalog.models,
      createConnection: (input) => store.createConnection(input),
      updateConnection: (input) => store.updateConnection(input),
      deleteConnection: ({ id }) => store.deleteConnection(id),
      verifyConnection: ({ id }) => store.verifyConnection(id),
      createPreset: (input) => store.createPreset(input),
      updatePreset: (input) => store.updatePreset(input),
      deletePreset: ({ id }) => store.deletePreset(id),
      describeDeletion: ({ kind, id }) => store.describeDeletion(kind, id),
    })
  }),
)
