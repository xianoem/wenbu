import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, FileSystem, Layer, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'
import { LlmModel } from '#contract/Llm'
import { ModelsDev, modelsDevUrl, toLlmModels } from '../src/core/llm/ModelCatalog.ts'

const snapshotPath = 'src/core/llm/modelCatalogSnapshot.json'

const ModelSnapshot = Schema.fromJsonString(Schema.Array(LlmModel))

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const response = yield* http.get(modelsDevUrl)
  const models = toLlmModels(yield* HttpClientResponse.schemaBodyJson(ModelsDev)(response))

  yield* fs.writeFileString(snapshotPath, `${yield* Schema.encodeEffect(ModelSnapshot)(models)}\n`)

  yield* Effect.logInfo('Wrote the model snapshot').pipe(
    Effect.annotateLogs({ models: models.length, path: snapshotPath }),
  )
})

NodeRuntime.runMain(
  program.pipe(Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer))),
)
