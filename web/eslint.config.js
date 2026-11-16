import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const NEUTRAL_MESSAGE =
  'src/anatomy/ is movement-neutral: take movement data as an argument, never import squat/, movements/ or utils/squatRoute.';
const ANATOMY_NEUTRAL = [
  { group: ['**/squat/**'], message: NEUTRAL_MESSAGE },
  { group: ['**/movements/**'], message: NEUTRAL_MESSAGE },
  { group: ['**/utils/squatRoute*'], message: NEUTRAL_MESSAGE },
];

export default [
  {
    // Mirrors of files authored in the claude.ai/design project (see
    // .design-sync/ownership.json). Committed verbatim so the repo copy matches
    // the project copy — linting or formatting them breaks the mirror, which is
    // exactly what the pre-commit hook did to splitiq-load.js (87 -> 232 lines).
    ignores: ['.design-sync/**'],
  },
  js.configs.recommended,
  {
    // Without a `files` glob here, ESLint 9 expands a directory argument
    // (`eslint src/`) to **/*.js only, so every non-test .jsx was silently
    // skipped and the lint gate reported green over ~14.5k unvisited lines.
    // The test/e2e blocks below match .jsx, which is why *those* were linted.
    files: ['**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        confirm: 'readonly',
        Image: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        DataView: 'readonly',
        ArrayBuffer: 'readonly',
        Uint8Array: 'readonly',
        TextDecoder: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '19.2' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // ignoreRestSiblings covers the deliberate omit-a-key idiom
      // (`const { _queuedAt, ...rest } = session`), which is a rest-spread
      // filter, not dead code. varsIgnorePattern extends the existing `_`
      // convention from arguments to variables so the two agree.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-console': 'off',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/immutability': 'warn',
      // Default forbids ' and " too, which fired 27 times purely on prose
      // ("Scott's", quoted coach notes). React renders those literally and
      // correctly; escaping them makes the copy unreadable for no safety gain.
      // > and } stay forbidden — those are the genuinely ambiguous ones.
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
    },
  },
  {
    // The public squat tool streams and gunzips its data in a worker, so it
    // touches browser APIs the dashboard never needed. Scoped to its subtree
    // rather than widened for the whole app.
    files: ['src/squat/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        self: 'readonly',
        globalThis: 'readonly',
        Worker: 'readonly',
        Response: 'readonly',
        ReadableStream: 'readonly',
        DecompressionStream: 'readonly',
        CompressionStream: 'readonly',
        Int8Array: 'readonly',
        Int16Array: 'readonly',
        Uint16Array: 'readonly',
        Uint32Array: 'readonly',
        Float32Array: 'readonly',
      },
    },
  },
  {
    // three.js is ~130 KB gzipped and belongs in one lazily loaded chunk. Only
    // the scene folder may import it; anywhere else it would be one stray
    // import away from the squat tool's first paint — or the dashboard's.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/anatomy/scene/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                'Import three.js only under src/anatomy/scene/ (loaded lazily via loadScene.js).',
            },
          ],
          patterns: [
            {
              group: ['three/*'],
              message:
                'Import three.js only under src/anatomy/scene/ (loaded lazily via loadScene.js).',
            },
          ],
        },
      ],
    },
  },
  {
    // The anatomy runtime is movement-neutral (R12): it is handed a movement's
    // data, it never reaches for one. Flat config replaces a rule's options
    // per block rather than merging them, so the three.js ban above is
    // restated here or this block would lift it.
    files: ['src/anatomy/**/*.{js,jsx}'],
    ignores: ['src/anatomy/scene/**', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                'Import three.js only under src/anatomy/scene/ (loaded lazily via loadScene.js).',
            },
          ],
          patterns: [
            {
              group: ['three/*'],
              message:
                'Import three.js only under src/anatomy/scene/ (loaded lazily via loadScene.js).',
            },
            ...ANATOMY_NEUTRAL,
          ],
        },
      ],
    },
  },
  {
    // The scene may import three.js, but it is movement-neutral too.
    files: ['src/anatomy/scene/**/*.{js,jsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ANATOMY_NEUTRAL }],
    },
  },
  {
    // The squat tool's tests read its committed data files from disk and
    // drive browser events jsdom provides beyond the app-wide list above.
    // The anatomy posing tests read the same files, and the movement config
    // tests read its doc.
    files: [
      'src/squat/__tests__/**/*.{js,jsx}',
      'src/anatomy/**/__tests__/**/*.{js,jsx}',
      'src/movements/**/__tests__/**/*.{js,jsx}',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        TextEncoder: 'readonly',
        Storage: 'readonly',
        HashChangeEvent: 'readonly',
      },
    },
  },
  {
    files: ['src/**/__tests__/**/*.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    files: ['e2e/**/*.{js,jsx}', 'playwright.config.js', 'vite.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    // Node build/CI scripts. They are in the lint scope because the design-sync
    // guard lives here and is CI-enforced — a gate that is itself ungated is how
    // the barrel broke in the first place. `.cjs` is in ESLint's default set
    // alongside `.mjs`; without it here, `process` is `no-undef` in a script.
    files: ['scripts/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // Vitest globals for the script tests. Flat config merges, so console and
    // process still come from the block above.
    files: ['scripts/**/__tests__/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
      },
    },
  },
];
