import { fileURLToPath } from 'node:url'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { loadTokenizer } from './Tokenizer'
import cases from './__fixtures__/tokens.json'

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

describe('Tokenizer', () => {
  layer(NodeServices.layer)((it) => {
    it.effect('decodes reader output like HuggingFace tokenizers', () =>
      Effect.gen(function* () {
        const tokenizer = yield* loadTokenizer(fixture('tokenizer.json'))

        expect(cases.map(({ ids }) => tokenizer.decode(ids))).toEqual(cases.map(({ text }) => text))
      }),
    )
  })
})
