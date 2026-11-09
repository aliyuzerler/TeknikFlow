// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/storybook-static/**',
      'infra/native/bin/**',
      'infra/native/.data/**',
      'infra/native/.state/**',
      'apps/api/prisma/migrations/**',
      'design/**',
      '**/*.min.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Project-aware linting: kurallar (ör. consistent-type-imports) en yakın
        // tsconfig'i okur ve NestJS'in emitDecoratorMetadata gereksinimini
        // bilir — DI için değer import'u yanlışlıkla type-import'a çevrilmez.
        projectService: {
          allowDefaultProject: ['*.config.ts'],
        },
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // Altyapı yardımcı betikleri ve seed'ler geliştirici konsolu çıktısı vermek zorundadır.
    files: ['infra/native/**/*.mjs', 'apps/*/prisma/**/*.ts', '**/*.config.{ts,mjs,js}'],
    rules: {
      'no-console': 'off',
    },
  },
);
