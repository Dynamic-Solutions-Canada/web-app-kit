import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { backAwareModalLintConfig } from './src/eslint.ts'

// The shared flat-config skeleton (STYLE-3). react-refresh is left out: the kit is a library
// with no dev server, so there is no Fast Refresh boundary to protect.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // Nested git worktrees, each linted in its own checkout.
      '.worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler rules from eslint-plugin-react-hooks 7, all errors (STYLE-3). The kit's
      // latest-callback refs are stored after commit, so consumers can keep these as errors too.
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/purity': 'error',
      // Native alert, confirm and prompt bypass the Back-aware dialog (UI-9).
      'no-alert': 'error',
    },
  },
  // Accessibility baseline (UI-14): accessible names, valid ARIA, keyboard reach.
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['src/**/*.tsx'],
  },
  // The kit's own guard: nothing but BackAwareModal mounts Joy's Modal.
  {
    ...backAwareModalLintConfig,
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/BackAwareModal.tsx'],
  },
)
