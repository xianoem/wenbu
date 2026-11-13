import { RuleTester } from 'vite-plus/lint/plugins-dev'
import { describe, it } from 'vite-plus/test'
import {
  logMessageLiteral,
  noChainedTypeAssertions,
  noManualTagComparison,
  noManualTaggedConstruction,
  noModuleMocking,
  noReexportOnlyModules,
  noRuntimeTypeof,
  noSchemaStore,
  noSwitch,
  noTryCatch,
  noUnknownParameters,
  requireBlankLines,
  requireSafetyComment,
} from './WenbuRules'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })

tester.run('wenbu/no-reexport-only-modules', noReexportOnlyModules, {
  valid: [
    "import { Effect } from 'effect'\nexport const run = Effect.void",
    "export { Appearance } from './Appearance'\nexport const theme = 'dark'",
    'export const value = 1',
  ],
  invalid: [
    { code: "export * from './Appearance'", errors: [{ messageId: 'reexportOnly' }] },
    {
      code: "export { Appearance } from './Appearance'\nexport type { Theme } from './Theme'",
      errors: [{ messageId: 'reexportOnly' }],
    },
  ],
})

tester.run('wenbu/no-try-catch', noTryCatch, {
  valid: ['Effect.try({ try: () => parse(text), catch: (cause) => new ParseError({ cause }) })'],
  invalid: [
    {
      code: 'try { parse(text) } catch (error) { report(error) }',
      errors: [{ messageId: 'tryCatch' }],
    },
  ],
})

tester.run('wenbu/no-switch', noSwitch, {
  valid: ["Match.value(theme).pipe(Match.when('dark', () => 1), Match.orElse(() => 0))"],
  invalid: [
    {
      code: "switch (theme) { case 'dark': break; default: break }",
      errors: [{ messageId: 'switch' }],
    },
  ],
})

tester.run('wenbu/no-module-mocking', noModuleMocking, {
  valid: ['const layer = Layer.succeed(Clock, testClock)', 'const spy = vi.fn()'],
  invalid: [
    { code: "vi.mock('./database')", errors: [{ messageId: 'moduleMocking' }] },
    { code: "vi.doMock('./database')", errors: [{ messageId: 'moduleMocking' }] },
    { code: "jest.mock('./database')", errors: [{ messageId: 'moduleMocking' }] },
  ],
})

tester.run('wenbu/no-schema-store', noSchemaStore, {
  valid: ['const store = SettingsStore.make(kv, Settings, defaultSettings)'],
  invalid: [
    {
      code: 'const store = KeyValueStore.toSchemaStore(kv, Settings)',
      errors: [{ messageId: 'schemaStore' }],
    },
  ],
})

tester.run('wenbu/no-chained-type-assertions', noChainedTypeAssertions, {
  valid: ['const port = value as Port', "const themes = ['dark'] as const"],
  invalid: [
    { code: 'const port = value as unknown as Port', errors: [{ messageId: 'chained' }] },
    { code: 'const port = <Port>(<unknown>value)', errors: [{ messageId: 'chained' }] },
  ],
})

tester.run('wenbu/require-safety-comment', requireSafetyComment, {
  valid: [
    '// SAFETY: only the RPC client writes to this port.\nconst request = frame as Request',
    'const request = handle(\n  // SAFETY: decoded by the frame schema above.\n  frame as Request,\n)',
    "const themes = ['dark'] as const",
    'const port = value satisfies Port',
  ],
  invalid: [
    { code: 'const request = frame as Request', errors: [{ messageId: 'missingSafety' }] },
    {
      code: '// Cast the frame.\nconst request = frame as Request',
      errors: [{ messageId: 'missingSafety' }],
    },
  ],
})

tester.run('wenbu/no-manual-tag-comparison', noManualTagComparison, {
  valid: ["Predicate.isTagged(error, 'NotFound')", "error.name === 'NotFound'"],
  invalid: [
    { code: "if (error._tag === 'NotFound') {}", errors: [{ messageId: 'tagComparison' }] },
    { code: "const other = error._tag !== 'NotFound'", errors: [{ messageId: 'tagComparison' }] },
  ],
})

tester.run('wenbu/no-manual-tagged-construction', noManualTaggedConstruction, {
  valid: ['const error = new NotFound({ id })', "Match.when({ _tag: 'NotFound' }, () => 1)"],
  invalid: [
    {
      code: "const error = { _tag: 'NotFound', id }",
      errors: [{ messageId: 'taggedConstruction' }],
    },
  ],
})

tester.run('wenbu/no-runtime-typeof', noRuntimeTypeof, {
  valid: ['Predicate.isString(value)', 'type Value = typeof value'],
  invalid: [
    { code: "const text = typeof value === 'string'", errors: [{ messageId: 'typeof' }] },
    { code: "if (typeof value !== 'undefined') {}", errors: [{ messageId: 'typeof' }] },
  ],
})

tester.run('wenbu/no-unknown-parameters', noUnknownParameters, {
  valid: [
    'const fail = (cause: unknown) => cause',
    'const isPort = (value: unknown): value is Port => Predicate.isObject(value)',
    'const close = (port: Port) => port.close()',
  ],
  invalid: [
    { code: 'const read = (data: unknown) => data', errors: [{ messageId: 'unknownParameter' }] },
    {
      code: 'function read(data: string | unknown) {}',
      errors: [{ messageId: 'unknownParameter' }],
    },
  ],
})

tester.run('wenbu/require-blank-lines', requireBlankLines, {
  valid: [
    'const a = 1\nconst b = 2\n\nif (a) {\n  run(b)\n}',
    'function read() {\n  return 1\n}',
    "import { a } from 'a'\nimport { b } from 'b'",
    'function read() {\n  const a = 1\n\n  // Explain why.\n  return a\n}',
    'port.start()\nport.post(0)',
    'export const a = 1\nconst b = 2',
  ],
  invalid: [
    {
      code: 'const port = open()\nport.start()',
      output: 'const port = open()\n\nport.start()',
      errors: [{ messageId: 'blankLine' }],
    },
    {
      code: 'ports.set(id, port)\nconst stop = port.onClose(close)',
      output: 'ports.set(id, port)\n\nconst stop = port.onClose(close)',
      errors: [{ messageId: 'blankLine' }],
    },
    {
      code: 'const a = 1\nif (a) {\n  run()\n}',
      output: 'const a = 1\n\nif (a) {\n  run()\n}',
      errors: [{ messageId: 'blankLine' }],
    },
    {
      code: 'function read() {\n  const a = 1\n  return a\n}',
      output: 'function read() {\n  const a = 1\n\n  return a\n}',
      errors: [{ messageId: 'blankLine' }],
    },
    {
      code: "const handle = () =>\n  run()\nport.on('message', handle)",
      output: "const handle = () =>\n  run()\n\nport.on('message', handle)",
      errors: [{ messageId: 'blankLine' }],
    },
    {
      code: 'function read() {\n  const a = 1\n  // Explain why.\n  return a\n}',
      output: 'function read() {\n  const a = 1\n\n  // Explain why.\n  return a\n}',
      errors: [{ messageId: 'blankLine' }],
    },
  ],
})

tester.run('wenbu/log-message-literal', logMessageLiteral, {
  valid: [
    "Effect.logInfo('Game launched').pipe(Effect.annotateLogs({ game: id }))",
    "Effect.logWarning('Could not refresh the model catalog', cause)",
    "Effect.logWithLevel(level)('Overlay diagnostic')",
    "(failed ? Effect.logWarning : Effect.logInfo)('Run finished')",
    'Effect.logDebug(`Request finished`)',
    'logger.info(message)',
  ],
  invalid: [
    { code: 'Effect.logInfo(`Manga worker: ${message}`)', errors: [{ messageId: 'literal' }] },
    { code: 'Effect.logError(error.message)', errors: [{ messageId: 'literal' }] },
    { code: 'Effect.logWithLevel(level)(message)', errors: [{ messageId: 'literal' }] },
    {
      code: '(failed ? Effect.logWarning : Effect.logInfo)(text)',
      errors: [{ messageId: 'literal' }],
    },
    { code: 'Effect.log()', errors: [{ messageId: 'literal' }] },
  ],
})
