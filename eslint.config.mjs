import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Disable EVERYTHING from recommendedTypeChecked that isn't related to deprecations
      // by resetting to recommended but keeping type-checked infra enabled
      ...tseslint.configs.recommendedTypeChecked.reduce((acc, config) => ({ ...acc, ...config.rules }), {}),
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    // Turn off all the noisy rules manually since we want a "laser focused" linter
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      'no-control-regex': 'off',
    }
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'vitest.config.ts',
      'eslint.config.mjs',
      'scripts/**',
      '**/*.js'
    ],
  }
);
