import { Effect, FileSystem, Option, Path, Redacted, Schema } from 'effect'
import { Base64 } from 'effect/encoding'
import { KeyProtection } from '#contract/Llm'

export interface SecretProtector {
  readonly isAvailable: () => Promise<boolean>
  readonly encrypt: (plain: string) => Promise<Uint8Array>
  readonly decrypt: (cipher: Uint8Array) => Promise<string>
}

export interface CredentialKey {
  readonly key: Redacted.Redacted<string>
  readonly protection: KeyProtection
}

const StoredKey = Schema.fromJsonString(
  Schema.Struct({ protection: KeyProtection, value: Schema.String }),
)

const keyBytes = 32

const readStoredKey = Effect.fn('readStoredKey')(function* (
  file: string,
  protector: SecretProtector,
) {
  const fs = yield* FileSystem.FileSystem

  if (!(yield* fs.exists(file))) {
    return Option.none<CredentialKey>()
  }

  const stored = yield* Schema.decodeUnknownEffect(StoredKey)(yield* fs.readFileString(file))

  if (stored.protection === 'reduced') {
    return Option.some({ key: Redacted.make(stored.value), protection: stored.protection })
  }

  const cipher = yield* Effect.fromResult(Base64.decode(stored.value))
  const key = yield* Effect.tryPromise(() => protector.decrypt(cipher))

  return Option.some({ key: Redacted.make(key), protection: stored.protection })
})

const createKey = Effect.fn('createKey')(function* (file: string, protector: SecretProtector) {
  const fs = yield* FileSystem.FileSystem
  const key = Base64.encode(crypto.getRandomValues(new Uint8Array(keyBytes)))

  const protection: KeyProtection = (yield* Effect.promise(() => protector.isAvailable()))
    ? 'os'
    : 'reduced'

  const value =
    protection === 'os' ? Base64.encode(yield* Effect.promise(() => protector.encrypt(key))) : key

  yield* fs.writeFileString(file, yield* Schema.encodeEffect(StoredKey)({ protection, value }))

  return { key: Redacted.make(key), protection }
})

export const loadCredentialKey = Effect.fn('loadCredentialKey')(function* (
  directory: string,
  protector: SecretProtector,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(directory, 'credential-key.json')

  yield* fs.makeDirectory(directory, { recursive: true })

  const stored = yield* readStoredKey(file, protector).pipe(
    Effect.catch(() =>
      Effect.as(
        fs.rename(file, path.join(directory, 'credential-key.unreadable.json')),
        Option.none<CredentialKey>(),
      ),
    ),
  )

  if (Option.isSome(stored)) {
    return stored.value
  }

  return yield* createKey(file, protector)
})
