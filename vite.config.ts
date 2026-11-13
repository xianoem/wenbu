import { defineConfig } from 'vite-plus'

const noEffectBarrels = {
  regex: '^@effect/(platform-[a-z]+|sql-[a-z-]+)$',
  message:
    'Import the module subpath (@effect/platform-node/NodeRuntime). Package barrels load optional peers such as redis.',
}

type ImportPattern = { regex: string; message: string }

const restrictImports = (
  ...patterns: Array<ImportPattern>
): ['error', { patterns: Array<ImportPattern> }] => [
  'error',
  { patterns: [noEffectBarrels, ...patterns] },
]

export default defineConfig({
  fmt: {
    ignorePatterns: ['out/**', 'repos/**', 'pnpm-lock.yaml', '**/__fixtures__/*.html'],
    semi: false,
    singleQuote: true,
    printWidth: 100,
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: ['out/**', 'repos/**', '.claude/**', '.agents/**'],
    plugins: ['typescript', 'import', 'oxc', 'eslint', 'unicorn', 'react'],
    jsPlugins: ['./tools/oxlint/WenbuRules.ts'],
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    },
    rules: {
      'eslint/no-console': 'error',
      'eslint/no-var': 'error',
      'eslint/no-useless-constructor': 'error',
      'eslint/no-unneeded-ternary': 'error',
      'eslint/no-shadow': 'off',
      'eslint/require-yield': 'off',
      'eslint/no-restricted-imports': restrictImports(),
      'typescript/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'typescript/no-import-type-side-effects': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
      'import/no-duplicates': 'error',
      'import/no-self-import': 'error',
      'import/no-cycle': 'error',
      'react/react-in-jsx-scope': 'off',
      'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/consistent-function-scoping': 'off',
      'oxc/no-accumulating-spread': 'error',
      'oxc/no-map-spread': 'off',
      'eslint/curly': ['error', 'all'],
      'wenbu/no-reexport-only-modules': 'error',
      'wenbu/no-try-catch': 'error',
      'wenbu/log-message-literal': 'error',
      'wenbu/no-switch': 'error',
      'wenbu/no-module-mocking': 'error',
      'wenbu/no-schema-store': 'error',
      'wenbu/no-chained-type-assertions': 'error',
      'wenbu/require-safety-comment': 'error',
      'wenbu/no-manual-tag-comparison': 'error',
      'wenbu/no-manual-tagged-construction': 'error',
      'wenbu/no-runtime-typeof': 'error',
      'wenbu/no-unknown-parameters': 'error',
      'wenbu/require-blank-lines': 'error',
    },
    overrides: [
      {
        // Code Wenbu evaluates inside MV and MZ games: ES5 for their Chromium 41, without Effect.
        files: ['src/core/livecontrols/game/*.js'],
        rules: {
          'eslint/no-var': 'off',
          'eslint/no-unused-vars': 'off',
          'eslint/no-underscore-dangle': 'off',
          'wenbu/no-try-catch': 'off',
          'wenbu/no-runtime-typeof': 'off',
        },
      },
      {
        files: ['src/core/platform/SettingsStore.ts', 'src/**/*.test.ts'],
        rules: { 'wenbu/no-schema-store': 'off' },
      },
      {
        files: ['src/renderer/ui/**'],
        rules: {
          'react/jsx-no-constructed-context-values': 'off',
          'react/no-array-index-key': 'off',
          'typescript/no-import-type-side-effects': 'off',
          'eslint/curly': 'off',
          'wenbu/require-safety-comment': 'off',
          'wenbu/require-blank-lines': 'off',
        },
      },
      {
        files: ['src/contract/**'],
        rules: {
          'eslint/no-restricted-imports': restrictImports({
            regex: '^(?!effect(/|$)).+',
            message: 'Contracts are shared by core and the renderer: import only from effect.',
          }),
        },
      },
      {
        files: ['src/renderer/**'],
        rules: {
          'eslint/no-restricted-imports': restrictImports(
            {
              regex: '(^|/)(core|main|preload)/',
              message: 'The renderer talks to core only through #contract and the RPC client.',
            },
            { regex: '^electron$', message: 'The renderer never imports electron.' },
            { regex: '^node:', message: 'The renderer never imports Node built-ins.' },
          ),
        },
      },
      {
        files: ['src/core/**'],
        rules: {
          'eslint/no-restricted-imports': restrictImports(
            {
              regex: '^electron$',
              message: 'Core runs in a utilityProcess and must not import electron.',
            },
            {
              regex: '(^|/)(main|preload|renderer)/',
              message: 'Core depends only on #contract.',
            },
          ),
        },
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/oxlint/**/*.test.ts'],
    environment: 'node',
  },
})
