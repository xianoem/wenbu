import { Effect, FileSystem, Schema } from 'effect'
import { MangaError } from '#contract/Manga'

/**
 * Decoding for the Hayai reader's byte-level BPE tokenizer (tokenizer.json, HuggingFace tokenizers):
 * special tokens are skipped, the rest map back from GPT-2's byte-to-character table to UTF-8.
 */

const TokenizerFile = Schema.Struct({
  model: Schema.Struct({ vocab: Schema.Record(Schema.String, Schema.Int) }),
  added_tokens: Schema.Array(
    Schema.Struct({ id: Schema.Int, content: Schema.String, special: Schema.Boolean }),
  ),
})

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(TokenizerFile))

/** GPT-2's bytes_to_unicode, reversed: each printable stand-in character back to its byte. */
const byteOfCharacter = (() => {
  const printable = (byte: number) =>
    (byte >= 0x21 && byte <= 0x7e) ||
    (byte >= 0xa1 && byte <= 0xac) ||
    (byte >= 0xae && byte <= 0xff)

  const table = new Map<string, number>()
  let shifted = 0

  for (let byte = 0; byte < 256; byte += 1) {
    if (printable(byte)) {
      table.set(String.fromCodePoint(byte), byte)
    } else {
      table.set(String.fromCodePoint(256 + shifted), byte)
      shifted += 1
    }
  }

  return table
})()

export interface Tokenizer {
  readonly decode: (ids: ReadonlyArray<number>) => string
}

export const tokenizerFrom = (file: typeof TokenizerFile.Type): Tokenizer => {
  const tokens = new Map<number, string>()
  const special = new Set<number>()

  for (const [token, id] of Object.entries(file.model.vocab)) {
    tokens.set(id, token)
  }

  for (const added of file.added_tokens) {
    tokens.set(added.id, added.content)

    if (added.special) {
      special.add(added.id)
    }
  }

  const utf8 = new TextDecoder('utf-8')

  return {
    decode: (ids) => {
      const bytes: Array<number> = []

      for (const id of ids) {
        if (special.has(id)) {
          continue
        }

        for (const character of tokens.get(id) ?? '') {
          const byte = byteOfCharacter.get(character)

          if (byte !== undefined) {
            bytes.push(byte)
          }
        }
      }

      return utf8.decode(Uint8Array.from(bytes))
    },
  }
}

export const loadTokenizer = Effect.fn('Tokenizer.load')(function* (file: string) {
  const fs = yield* FileSystem.FileSystem

  const text = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      () =>
        new MangaError({
          reason: 'failed',
          message: `The reader's tokenizer ${file} could not be read.`,
        }),
    ),
  )

  const parsed = yield* decodeFile(text).pipe(
    Effect.mapError(
      () =>
        new MangaError({
          reason: 'failed',
          message: `The reader's tokenizer ${file} is not valid.`,
        }),
    ),
  )

  return tokenizerFrom(parsed)
})
