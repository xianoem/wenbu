import { Effect, Option, Schema, Struct } from 'effect'
import { KeyValueStore } from 'effect/persistence'

interface ForgivingKeyLambda extends Struct.Lambda {
  <S extends Schema.Top>(self: S): Schema.optionalKey<S>
  readonly '~lambda.out': this['~lambda.in'] extends Schema.Top
    ? Schema.optionalKey<this['~lambda.in']>
    : never
}

const forgivingKey = Struct.lambda<ForgivingKeyLambda>((field) =>
  Schema.optionalKey(field.pipe(Schema.catchDecoding(() => Effect.succeedNone))),
)

/** Decoded field by field, so a field a later Wenbu changes doesn't reset every saved setting. */
export const make = <Fields extends Schema.Struct.Fields>(
  store: KeyValueStore.KeyValueStore,
  schema: Schema.Struct<Fields>,
  defaults: Schema.Struct<Fields>['Type'],
) => {
  const partial = KeyValueStore.toSchemaStore(store, schema.mapFields(Struct.map(forgivingKey)))
  const full = KeyValueStore.toSchemaStore(store, schema)

  return {
    get: (key: string) =>
      partial.get(key).pipe(
        Effect.catchTag('SchemaError', () =>
          Effect.logWarning('Stored settings were unreadable; using defaults').pipe(
            Effect.annotateLogs({ key }),
            Effect.as(Option.none()),
          ),
        ),
        Effect.tapError((error) =>
          Effect.logWarning('Stored settings could not be read', error).pipe(
            Effect.annotateLogs({ key }),
          ),
        ),
        Effect.map((saved) =>
          Option.match(saved, {
            onNone: () => defaults,
            onSome: (fields): Schema.Struct<Fields>['Type'] => ({ ...defaults, ...fields }),
          }),
        ),
      ),
    set: (key: string, value: Schema.Struct<Fields>['Type']) => full.set(key, value),
    remove: (key: string) => store.remove(key),
  }
}
