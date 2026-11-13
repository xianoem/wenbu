import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { Base64 } from 'effect/encoding'
import { KeyProtection } from '#contract/Llm'

export class CredentialsError extends Schema.TaggedError<CredentialsError>()('CredentialsError', {
  message: Schema.String,
}) {}

const algorithm = 'AES-GCM'

const nonceLength = 12

const format = 'v1'

const unreadable = () =>
  new CredentialsError({ message: 'The saved API key cannot be read on this device.' })

export class Credentials extends Context.Service<
  Credentials,
  {
    readonly protection: KeyProtection
    readonly seal: (secret: Redacted.Redacted<string>) => Effect.Effect<string>
    readonly open: (sealed: string) => Effect.Effect<Redacted.Redacted<string>, CredentialsError>
  }
>()('wenbu/core/llm/Credentials') {
  static readonly make = Effect.fn('Credentials.make')(function* (options: {
    readonly key: Redacted.Redacted<string>
    readonly protection: KeyProtection
  }) {
    const rawKey = yield* Effect.orDie(
      Effect.fromResult(Base64.decode(Redacted.value(options.key))),
    )

    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey('raw', rawKey, algorithm, false, ['encrypt', 'decrypt']),
    )

    const seal = Effect.fn('Credentials.seal')(function* (secret: Redacted.Redacted<string>) {
      const nonce = crypto.getRandomValues(new Uint8Array(nonceLength))
      const plain = new TextEncoder().encode(Redacted.value(secret))

      const cipher = yield* Effect.promise(() =>
        crypto.subtle.encrypt({ name: algorithm, iv: nonce }, key, plain),
      )

      return [format, Base64.encode(nonce), Base64.encode(new Uint8Array(cipher))].join('.')
    })

    const open = Effect.fn('Credentials.open')(function* (sealed: string) {
      const [version, nonceText, cipherText] = sealed.split('.')

      if (version !== format || nonceText === undefined || cipherText === undefined) {
        return yield* unreadable()
      }

      const nonce = yield* Effect.mapError(Effect.fromResult(Base64.decode(nonceText)), unreadable)

      const cipher = yield* Effect.mapError(
        Effect.fromResult(Base64.decode(cipherText)),
        unreadable,
      )

      const plain = yield* Effect.tryPromise({
        try: () => crypto.subtle.decrypt({ name: algorithm, iv: nonce }, key, cipher),
        catch: unreadable,
      })

      return Redacted.make(new TextDecoder().decode(plain))
    })

    return Credentials.of({ protection: options.protection, seal, open })
  })

  static readonly layer = Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const key = yield* Config.Redacted('WENBU_CREDENTIAL_KEY')
      const protection = yield* Config.Literals(KeyProtection.literals, 'WENBU_KEY_PROTECTION')

      return yield* Credentials.make({ key, protection })
    }),
  )
}
