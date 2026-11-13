import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'
import { LlmSettingsError } from '#contract/Llm'
import { ConnectionVerifier } from './ConnectionVerifier'

const apiKey = Redacted.make('sk-test')

const fakeHttp = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response | 'offline',
  requests: Array<HttpClientRequest.HttpClientRequest> = [],
) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      requests.push(request)

      const response = respond(request)

      if (response === 'offline') {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: 'offline' }),
          }),
        )
      }

      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )

const verify = (
  target: Parameters<ConnectionVerifier['Service']['verify']>[0],
  http: Layer.Layer<HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const verifier = yield* ConnectionVerifier

    return yield* verifier.verify(target)
  }).pipe(Effect.provide(ConnectionVerifier.layer.pipe(Layer.provide(http))))

describe('ConnectionVerifier', () => {
  it.live('verifies an OpenAI-compatible key against the models endpoint', () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = []

      const result = yield* verify(
        { provider: 'deepseek', apiUrl: undefined, apiKey },
        fakeHttp(() => Response.json({ data: [] }), requests),
      )

      assert.strictEqual(result.verification, 'verified')
      assert.strictEqual(requests[0]?.url, 'https://api.deepseek.com/models')
      assert.strictEqual(requests[0]?.headers['authorization'], 'Bearer sk-test')
    }),
  )

  it.live('uses the Anthropic models endpoint and key header', () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = []

      yield* verify(
        { provider: 'anthropic', apiUrl: undefined, apiKey },
        fakeHttp(() => Response.json({ data: [] }), requests),
      )

      assert.strictEqual(requests[0]?.url, 'https://api.anthropic.com/v1/models')
      assert.strictEqual(requests[0]?.headers['x-api-key'], 'sk-test')
    }),
  )

  it.live('rejects a key the provider refuses', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        verify(
          { provider: 'openai', apiUrl: undefined, apiKey },
          fakeHttp(() => new Response(null, { status: 401 })),
        ),
      )

      assert.deepStrictEqual(
        error,
        new LlmSettingsError({
          reason: 'rejected',
          message: 'The provider rejected the API key.',
          field: 'apiKey',
        }),
      )
    }),
  )

  it.live('retries server errors and then reports the result as inconclusive', () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = []

      const result = yield* verify(
        { provider: 'openai', apiUrl: undefined, apiKey },
        fakeHttp(() => new Response(null, { status: 503 }), requests),
      )

      assert.strictEqual(result.verification, 'inconclusive')
      assert.strictEqual(requests.length, 3)
    }),
  )

  it.live('reports an unreachable provider as inconclusive', () =>
    Effect.gen(function* () {
      const result = yield* verify(
        { provider: 'custom-openai-compatible', apiUrl: 'http://localhost:1234/v1/', apiKey },
        fakeHttp(() => 'offline'),
      )

      assert.strictEqual(result.verification, 'inconclusive')
    }),
  )
})
