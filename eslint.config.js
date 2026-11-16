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
    // PRD Part 3, 0.2: generators give byte-identical output in every JavaScript engine. Transcendental
    // functions come from core/math/dmath, randomness from the seeded Rng, and nothing reads the clock.
    files: ['packages/core/src/{anthro,face,sculpt,garment,population,photo}/**/*.ts', 'packages/core/src/math/{distributions,linalg}.ts', 'packages/core/src/determinism.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'sin', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'cos', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'tan', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'asin', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'acos', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'atan', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'atan2', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'exp', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'expm1', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'log', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'log2', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'log10', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'log1p', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'pow', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'cbrt', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'sinh', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'cosh', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'tanh', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'hypot', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Math', property: 'random', message: 'Generators must be bit-identical in every engine: use core/math/dmath (PRD Part 3, 0.2).' },
        { object: 'Date', property: 'now', message: 'Generators must not read the clock (PRD Part 3, 0.2).' },
        { object: 'performance', property: 'now', message: 'Generators must not read the clock (PRD Part 3, 0.2).' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'x ** y is not correctly rounded in every engine: multiply, or use dmath.pow (PRD Part 3, 0.2).' },
        { selector: "AssignmentExpression[operator='**=']", message: 'x **= y is not correctly rounded in every engine: multiply, or use dmath.pow (PRD Part 3, 0.2).' },
        { selector: "NewExpression[callee.name='Date']", message: 'Generators must not read the clock (PRD Part 3, 0.2).' },
      ],
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
