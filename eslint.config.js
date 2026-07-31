import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Flat config. `npm run lint` targets src/ only; the ignores and the JS block
// below exist so that a bare `eslint .` (editors, pre-commit hooks) also does
// something sensible on the build scripts.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/**'],
  },

  js.configs.recommended,

  // Build tooling: plain ESM running on Node.
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // These are CLIs, so reporting to the operator is part of the job —
      // but chatty progress logging still deserves a second look.
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },

  // The card itself: TypeScript + Lit decorators, running in the browser.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        // Mirrors tsconfig.json; no type-aware rules are enabled, so the
        // parser does not need a project reference.
        ecmaFeatures: { decorators: true },
      },
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // tsc already enforces these with noUnusedLocals / noUnusedParameters,
      // and it understands decorators and parameter properties better than
      // the lint rule does. Keeping both only produces duplicate noise.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // The card talks to Home Assistant's `hass` object and to Lit internals,
      // neither of which ships types we control. `any` is a deliberate escape
      // hatch at those boundaries rather than an accident.
      '@typescript-eslint/no-explicit-any': 'off',

      // A custom card has no console in normal operation; anything logged is
      // either debug residue or belongs in a thrown error.
      'no-console': 'warn',
    },
  },
];
