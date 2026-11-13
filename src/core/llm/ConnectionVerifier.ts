import { Context, Effect, Layer, Redacted, Schedule, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { type LlmProvider, LlmSettingsError } from '#contract/Llm'
import { apiRoot } from './Providers'

export interface ConnectionTarget {
  readonly provider: LlmProvider
  readonly apiUrl: string | undefined
  readonly apiKey: Redacted.Redacted<string>
}

export interface VerificationResult {
  readonly verification: 'verified' | 'inconclusive'
  readonly message?: string
}

class Unreachable extends Schema.TaggedError<Unreachable>()('Unreachable', {}) {}

const isUnreachable = Schema.is(Unreachable)

const verified: VerificationResult = { verification: 'verified' }

const inconclusive: VerificationResult = {
  verification: 'inconclusive',
  message: "Wenbu couldn't confirm this connection with the provider yet.",
}

const rejected = (message: string, field: 'apiKey' | 'apiUrl') =>
  new LlmSettingsError({ reason: 'rejected', message, field })

const modelsRequest = (target: ConnectionTarget, root: string) => {
  const request = HttpClientRequest.get(`${root}/models`)

  if (target.provider === 'anthropic') {
    return HttpClientRequest.setHeaders(request, {
      'x-api-key': Redacted.value(target.apiKey),
      'anthropic-version': '2023-06-01',
    })
  }

  return HttpClientRequest.bearerToken(request, target.apiKey)
}

export class ConnectionVerifier extends Context.Service<
  ConnectionVerifier,
  {
    readonly verify: (
      target: ConnectionTarget,
    ) => Effect.Effect<VerificationResult, LlmSettingsError>
  }
>()('wenbu/core/llm/ConnectionVerifier') {
  static readonly layer = Layer.effect(
    ConnectionVerifier,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient

      const attempt = Effect.fn('ConnectionVerifier.attempt')(function* (
        target: ConnectionTarget,
        root: string,
      ) {
        const response = yield* http.execute(modelsRequest(target, root)).pipe(
          Effect.timeout('10 seconds'),
          Effect.mapError(() => new Unreachable()),
        )

        const status = response.status

        if (status >= 200 && status < 300) {
          return verified
        }

        if (status === 401 || status === 403) {
          return yield* rejected('The provider rejected the API key.', 'apiKey')
        }

        if (status === 429 || status >= 500) {
          return yield* new Unreachable()
        }

        if (target.provider === 'custom-openai-compatible') {
          return inconclusive
        }

        if (status === 404) {
          return yield* rejected('The provider endpoint was not found.', 'apiUrl')
        }

        return yield* rejected(`The provider refused the check (HTTP ${status}).`, 'apiUrl')
      })

      const verify = Effect.fn('ConnectionVerifier.verify')(function* (target: ConnectionTarget) {
        const root = apiRoot(target.provider, target.apiUrl)

        if (root === undefined || root === '') {
          return yield* new LlmSettingsError({
            reason: 'invalid',
            message: 'Enter the API URL.',
            field: 'apiUrl',
          })
        }

        return yield* attempt(target, root).pipe(
          Effect.retry({
            schedule: Schedule.exponential('100 millis'),
            times: 2,
            while: isUnreachable,
          }),
          Effect.catchTag('Unreachable', () => Effect.succeed(inconclusive)),
        )
      })

      return ConnectionVerifier.of({ verify })
    }),
  )
}
