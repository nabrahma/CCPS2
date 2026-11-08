// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'app/build/**',
      'app/frontend/src/wailsjs/**',
      'assets/**',
      'tools/asset-compiler/.cache/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // The engine must stay free of DOM, Three.js and Wails (PRD 8.3).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'packages/core must not import Three.js' },
            { group: ['**/wailsjs/**'], message: 'packages/core must not import Wails bindings' },
            { group: ['react', 'react-dom'], message: 'packages/core must not import React' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator'],
    },
  },
  {
    files: ['app/frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Node scripts (build and test runners).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
);
