import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '.wrangler/**', 'node_modules/**', 'public/wasm/wasm_exec.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['public/wasm/flow-worker.js'],
    languageOptions: { globals: { ...globals.worker, ...globals.browser, importScripts: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
