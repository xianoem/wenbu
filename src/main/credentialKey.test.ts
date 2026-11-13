import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, FileSystem, Redacted } from 'effect'
import { loadCredentialKey, type SecretProtector } from './credentialKey'

const reversingProtector = (available: boolean): SecretProtector => ({
  isAvailable: async () => available,
  encrypt: async (plain) => new TextEncoder().encode([...plain].toReversed().join('')),
  decrypt: async (cipher) => [...new TextDecoder().decode(cipher)].toReversed().join(''),
})

const brokenProtector: SecretProtector = {
  isAvailable: async () => true,
  encrypt: async (plain) => new TextEncoder().encode(plain),
  decrypt: () => Promise.reject(new Error('DPAPI refused')),
}

const withTempDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped()

    return yield* use(directory)
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe('loadCredentialKey', () => {
  it.effect('creates an OS-protected key and returns the same key next time', () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        const first = yield* loadCredentialKey(directory, reversingProtector(true))
        const second = yield* loadCredentialKey(directory, reversingProtector(true))

        assert.strictEqual(first.protection, 'os')
        assert.strictEqual(Redacted.value(first.key), Redacted.value(second.key))
      }),
    ),
  )

  it.effect('stores the key with reduced protection when the OS cannot protect it', () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        const loaded = yield* loadCredentialKey(directory, reversingProtector(false))

        assert.strictEqual(loaded.protection, 'reduced')
      }),
    ),
  )

  it.effect('replaces a key the OS can no longer decrypt and keeps a backup', () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const original = yield* loadCredentialKey(directory, brokenProtector)
        const replaced = yield* loadCredentialKey(directory, brokenProtector)

        assert.notStrictEqual(Redacted.value(original.key), Redacted.value(replaced.key))
        assert.isTrue(yield* fs.exists(`${directory}/credential-key.unreadable.json`))
      }),
    ),
  )
})
