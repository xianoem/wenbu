import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it, layer } from '@effect/vitest'
import { Effect } from 'effect'
import { fixBrackets, isValuableText, loadLanguageId } from './TextFilter'
import languages from './__fixtures__/langid.json'
import cases from './__fixtures__/text-filter.json'

// The exported langid model is a download, not part of the repository.
// @effect-diagnostics-next-line processEnv:off
const model = process.env['WENBU_LANGID_MODEL'] ?? ''

describe('TextFilter', () => {
  it('fixes brackets and judges value like the plugin', () => {
    expect(cases.map(({ text }) => [fixBrackets(text), isValuableText(fixBrackets(text))])).toEqual(
      cases.map(({ fixed, valuable }) => [fixed, valuable]),
    )
  })

  layer(NodeServices.layer)((it) => {
    it.effect.skipIf(model === '')('classifies languages like py3langid', () =>
      Effect.gen(function* () {
        const languageId = yield* loadLanguageId(model)

        expect(languages.map(({ text }) => languageId.classify(text))).toEqual(
          languages.map(({ lang }) => lang),
        )
      }),
    )
  })
})
