import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Redacted } from 'effect'
import { Credentials } from './Credentials'

const keyA = Redacted.make('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
const keyB = Redacted.make('ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=')

describe('Credentials', () => {
  it.effect('seals a secret and opens it again', () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.make({ key: keyA, protection: 'os' })
      const sealed = yield* credentials.seal(Redacted.make('sk-live-secret'))

      assert.notInclude(sealed, 'sk-live-secret')

      const opened = yield* credentials.open(sealed)

      assert.strictEqual(Redacted.value(opened), 'sk-live-secret')
    }),
  )

  it.effect('uses a fresh nonce for every seal', () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.make({ key: keyA, protection: 'os' })
      const first = yield* credentials.seal(Redacted.make('same'))
      const second = yield* credentials.seal(Redacted.make('same'))

      assert.notStrictEqual(first, second)
    }),
  )

  it.effect('cannot open a secret sealed with another key', () =>
    Effect.gen(function* () {
      const sealer = yield* Credentials.make({ key: keyA, protection: 'os' })
      const other = yield* Credentials.make({ key: keyB, protection: 'os' })
      const sealed = yield* sealer.seal(Redacted.make('sk-live-secret'))
      const result = yield* Effect.exit(other.open(sealed))

      assert.isTrue(Exit.isFailure(result))
    }),
  )
})
